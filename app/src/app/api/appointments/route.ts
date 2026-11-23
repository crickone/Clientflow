import { guard } from "@/lib/api/guard";
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  appointments,
  clients,
  packages,
  packageTemplates,
  payments,
} from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { redeemAtBooking } from "@/lib/vouchers/redeem";
import { logActivity } from "@/lib/queries";
import { appointmentStatusDates } from "@/lib/statusDates";
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
        ...appointmentStatusDates(null, status, new Date()),
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

    if (parsed.paymentMethod === "voucher" && voucherCode.trim()) {
      // The voucher pays what it can and any rest is a second payment, with
      // one voucher_redemptions row and the new balance (lib/vouchers/redeem).
      // An expired voucher is still taken: staff saw the warning on the form.
      const staff = await getSessionUser();
      const used = redeemAtBooking({
        code: voucherCode,
        clientId: resolvedClientId,
        appointmentId: apptId,
        priceEur: parsed.totalPriceEur,
        therapyIds,
        secondaryMethod: (fd.get("secondaryPaymentMethod") as string) || null,
        userId: staff?.id ?? null,
      });
      if (!used.ok) return rollback(apptId, used.error);
    } else {
      // No voucher, or a paper voucher with no code (the old desk path): a
      // single payment row for the full session.
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
