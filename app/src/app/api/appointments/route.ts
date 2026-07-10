import { guard } from "@/lib/api/guard";
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  appointments,
  clients,
  giftVouchers,
  packages,
  packageTemplates,
  payments,
} from "@/lib/db/schema";
import { logActivity } from "@/lib/queries";
import { checkBookingSlot } from "@/lib/schedule";
import { onAppointmentBooked, onPaymentRecorded } from "@/lib/pipeline/stage";
import { createPackage, expiryFromMonths } from "@/lib/packages";

export const dynamic = "force-dynamic";

const bookSchema = z.object({
  // Either an existing client ID, or walk-in name fields below.
  clientId: z.coerce.number().int().positive().optional(),
  walkInFirstName: z.string().optional(),
  walkInLastName: z.string().optional(),
  walkInEmail: z.string().email().optional().or(z.literal("")),
  walkInPhone: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.coerce.number().int().positive(),
  totalPriceEur: z.coerce.number().nonnegative(),
  paymentMethod: z.enum(["cash", "card", "package", "voucher", "bank_transfer"]),
});

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  try {
    const fd = await req.formData();
    const therapyIds = fd
      .getAll("therapyIds")
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (therapyIds.length === 0) {
      return NextResponse.json({ ok: false, error: "Select at least one therapy." }, { status: 400 });
    }

    const parsed = bookSchema.parse({
      clientId: fd.get("clientId") || undefined,
      walkInFirstName: fd.get("walkInFirstName") || undefined,
      walkInLastName: fd.get("walkInLastName") || undefined,
      walkInEmail: fd.get("walkInEmail") || undefined,
      walkInPhone: fd.get("walkInPhone") || undefined,
      date: fd.get("date"),
      startTime: fd.get("startTime"),
      durationMinutes: fd.get("durationMinutes"),
      totalPriceEur: fd.get("totalPriceEur"),
      paymentMethod: fd.get("paymentMethod"),
    });

    // Validate that we have *some* way to identify the client.
    if (!parsed.clientId && !parsed.walkInFirstName) {
      return NextResponse.json(
        { ok: false, error: "Pick a client or enter a walk-in name." },
        { status: 400 },
      );
    }

    const notes = (fd.get("notes") as string) || null;
    const status = ((fd.get("status") as string) || "scheduled") as
      | "scheduled"
      | "confirmed"
      | "completed"
      | "cancelled"
      | "no_show";
    const packageIdRaw = fd.get("packageId");
    let packageId = packageIdRaw ? Number(packageIdRaw) : null;
    const voucherCode = (fd.get("voucherCode") as string) || "";

    // "Sign up for a new package" at booking.
    const packageMode = (fd.get("packageMode") as string) || "existing";
    const newPackageTemplateId = Number(fd.get("newPackageTemplateId")) || 0;
    const newPackageName = ((fd.get("newPackageName") as string) || "").trim();
    const newPackageSessions = Number(fd.get("newPackageSessions")) || 0;
    const newPackagePriceEur = Number(fd.get("newPackagePriceEur")) || 0;
    const newPackageExpiry = (fd.get("newPackageExpiry") as string) || "";
    const newPackagePaymentMethod = ((fd.get("newPackagePaymentMethod") as string) ||
      "card") as "cash" | "card" | "bank_transfer";

    const endTime = addMinutes(parsed.startTime, parsed.durationMinutes);

    // Slot check before any DB writes — saves us from rolling back a fresh
    // walk-in client if the time happens to be invalid.
    const check = checkBookingSlot(
      parsed.date,
      parsed.startTime,
      parsed.durationMinutes,
      therapyIds,
    );
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: check.reason }, { status: 409 });
    }

    // Resolve client (existing or walk-in) only after the slot is valid.
    let resolvedClientId: number;
    let createdWalkInId: number | null = null;
    let createdPackageId: number | null = null;
    if (parsed.clientId) {
      resolvedClientId = parsed.clientId;
    } else {
      const inserted = db
        .insert(clients)
        .values({
          firstName: parsed.walkInFirstName!.trim(),
          lastName: (parsed.walkInLastName ?? "").trim() || "—",
          email: (parsed.walkInEmail ?? "").trim() || null,
          phone: (parsed.walkInPhone ?? "").trim() || "—",
        })
        .returning({ id: clients.id })
        .all();
      resolvedClientId = inserted[0].id;
      createdWalkInId = resolvedClientId;
    }

    // Helper: tear down everything we wrote so far + return an error.
    const rollback = (apptId: number | null, error: string, status = 400) => {
      if (apptId != null) {
        db.delete(payments).where(eq(payments.appointmentId, apptId)).run();
        db.delete(appointments).where(eq(appointments.id, apptId)).run();
      }
      if (createdPackageId != null) {
        db.delete(packages).where(eq(packages.id, createdPackageId)).run();
      }
      if (createdWalkInId != null) {
        db.delete(clients).where(eq(clients.id, createdWalkInId)).run();
      }
      return NextResponse.json({ ok: false, error }, { status });
    };

    const insert = db
      .insert(appointments)
      .values({
        clientId: resolvedClientId,
        date: parsed.date,
        startTime: parsed.startTime,
        endTime,
        status,
        therapyIds: JSON.stringify(therapyIds),
        totalPriceEur: parsed.totalPriceEur,
        notes,
      })
      .returning({ id: appointments.id })
      .all();
    const apptId = insert[0].id;

    // Sign up for a NEW package as part of this booking: create the package +
    // record the sale, then attach it to this appointment so the session books
    // at €0 and the credit decrements on completion (like redeeming one).
    if (parsed.paymentMethod === "package" && packageMode === "new") {
      let pkgName: string;
      let pkgSessions: number;
      let pkgPrice: number;
      let pkgExpiry: string;
      if (newPackageTemplateId) {
        const tpl = db
          .select()
          .from(packageTemplates)
          .where(eq(packageTemplates.id, newPackageTemplateId))
          .get();
        if (!tpl) return rollback(apptId, "Package template not found.");
        pkgName = tpl.name;
        pkgSessions = tpl.totalSessions;
        pkgPrice = tpl.priceEur;
        pkgExpiry = expiryFromMonths(tpl.validityMonths);
      } else {
        if (!newPackageName || newPackageSessions <= 0 || !newPackageExpiry) {
          return rollback(apptId, "Fill in the new package's name, sessions and expiry.");
        }
        pkgName = newPackageName;
        pkgSessions = newPackageSessions;
        pkgPrice = newPackagePriceEur;
        pkgExpiry = newPackageExpiry;
      }
      createdPackageId = createPackage({
        clientId: resolvedClientId,
        therapyId: therapyIds[0],
        packageName: pkgName,
        totalSessions: pkgSessions,
        pricePaidEur: pkgPrice,
        expiryDate: pkgExpiry,
      });
      packageId = createdPackageId; // this session attaches to the new package
      // Record the package sale (the revenue). Trips the `sale` pipeline stage.
      db.insert(payments)
        .values({
          clientId: resolvedClientId,
          appointmentId: apptId,
          packageId: createdPackageId,
          voucherId: null,
          amountEur: pkgPrice,
          paymentMethod: newPackagePaymentMethod,
          notes: `Package signup at booking: ${pkgName}`,
        })
        .run();
    }

    let voucherId: number | null = null;
    let voucherDeducted = 0;
    if (parsed.paymentMethod === "voucher" && voucherCode) {
      const v = db
        .select()
        .from(giftVouchers)
        .where(eq(giftVouchers.code, voucherCode.trim()))
        .get();
      const today = new Date().toISOString().slice(0, 10);
      if (!v) return rollback(apptId, "Voucher not found.");
      if (v.expiryDate < today) return rollback(apptId, "Voucher has expired.");
      const balance = v.balanceEur ?? v.valueEur;
      const secondaryMethod = (fd.get("secondaryPaymentMethod") as string) || "";
      if (balance < parsed.totalPriceEur) {
        // Need to split: voucher covers the balance, the rest comes from a
        // secondary method (cash / card / bank_transfer).
        const allowed = ["cash", "card", "bank_transfer"];
        if (!allowed.includes(secondaryMethod)) {
          return rollback(
            apptId,
            `Voucher balance €${balance.toFixed(2)} doesn't cover the €${parsed.totalPriceEur.toFixed(2)} session — choose a method for the €${(parsed.totalPriceEur - balance).toFixed(2)} remainder.`,
          );
        }
      }
      voucherId = v.id;
      voucherDeducted = Math.min(balance, parsed.totalPriceEur);
      const newBalance = balance - voucherDeducted;
      db.update(giftVouchers)
        .set({
          balanceEur: newBalance,
          isRedeemed: newBalance <= 0.01 ? true : false,
          redeemedByClientId: resolvedClientId,
          redeemedAt: new Date(),
        })
        .where(eq(giftVouchers.id, v.id))
        .run();

      // Voucher portion of the payment.
      db.insert(payments)
        .values({
          clientId: resolvedClientId,
          appointmentId: apptId,
          packageId: null,
          voucherId,
          amountEur: voucherDeducted,
          paymentMethod: "voucher",
          notes: null,
        })
        .run();

      // Remainder, if any, by the secondary method.
      const remainder = parsed.totalPriceEur - voucherDeducted;
      if (remainder > 0.01) {
        db.insert(payments)
          .values({
            clientId: resolvedClientId,
            appointmentId: apptId,
            packageId: null,
            voucherId: null,
            amountEur: remainder,
            paymentMethod: secondaryMethod as
              | "cash"
              | "card"
              | "bank_transfer",
            notes: `Top-up after voucher ${v.code}`,
          })
          .run();
      }
    } else {
      // No voucher — single payment row for the full session.
      db.insert(payments)
        .values({
          clientId: resolvedClientId,
          appointmentId: apptId,
          packageId,
          voucherId: null,
          amountEur:
            parsed.paymentMethod === "package" ? 0 : parsed.totalPriceEur,
          paymentMethod: parsed.paymentMethod,
          notes: null,
        })
        .run();
    }

    if (createdWalkInId != null) {
      await logActivity(
        "client.new",
        `Walk-in added during booking: ${parsed.walkInFirstName} ${parsed.walkInLastName ?? ""}`.trim(),
        { clientId: createdWalkInId, walkIn: true },
      );
    }
    await logActivity(
      "appointment.new",
      `Appointment booked for ${parsed.date} ${parsed.startTime}`,
      { appointmentId: apptId, clientId: resolvedClientId },
    );

    // Pipeline: advance the originating lead (no-op for walk-ins / non-lead clients).
    try {
      onAppointmentBooked(resolvedClientId, status);
      onPaymentRecorded(resolvedClientId);
    } catch (err) {
      console.error("[pipeline] booking hook failed:", err);
    }

    return NextResponse.json({ ok: true, id: apptId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Booking failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
