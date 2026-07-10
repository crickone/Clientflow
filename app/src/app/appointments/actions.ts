"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  appointments,
  giftVouchers,
  packages,
  payments,
  sessions,
  therapies,
} from "@/lib/db/schema";
import { logActivity } from "@/lib/queries";
import {
  onAppointmentBooked,
  onAppointmentStatus,
  onPaymentRecorded,
} from "@/lib/pipeline/stage";

const bookSchema = z.object({
  clientId: z.coerce.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.coerce.number().int().positive(),
  therapyIds: z.array(z.coerce.number().int().positive()).min(1),
  totalPriceEur: z.coerce.number().nonnegative(),
  paymentMethod: z.enum(["cash", "card", "package", "voucher", "bank_transfer"]),
  packageId: z.coerce.number().int().positive().optional(),
  voucherCode: z.string().optional(),
  notes: z.string().optional(),
  status: z
    .enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"])
    .default("scheduled"),
});

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export async function createAppointmentAction(formData: FormData) {
  await requireUser();
  const therapyIds = formData
    .getAll("therapyIds")
    .map((v) => Number(v))
    .filter(Boolean);

  const parsed = bookSchema.parse({
    clientId: formData.get("clientId"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    durationMinutes: formData.get("durationMinutes"),
    therapyIds,
    totalPriceEur: formData.get("totalPriceEur"),
    paymentMethod: formData.get("paymentMethod"),
    packageId: formData.get("packageId") || undefined,
    voucherCode: formData.get("voucherCode") || undefined,
    notes: formData.get("notes") || undefined,
    status: (formData.get("status") as string) || "scheduled",
  });

  const endTime = addMinutes(parsed.startTime, parsed.durationMinutes);
  const appt = db
    .insert(appointments)
    .values({
      clientId: parsed.clientId,
      date: parsed.date,
      startTime: parsed.startTime,
      endTime,
      status: parsed.status,
      therapyIds: JSON.stringify(parsed.therapyIds),
      totalPriceEur: parsed.totalPriceEur,
      notes: parsed.notes ?? null,
    })
    .returning({ id: appointments.id })
    .all();
  const apptId = appt[0].id;

  // Record payment
  if (parsed.totalPriceEur > 0 || parsed.paymentMethod === "package") {
    let voucherId: number | undefined;
    if (parsed.paymentMethod === "voucher" && parsed.voucherCode) {
      const v = db
        .select()
        .from(giftVouchers)
        .where(eq(giftVouchers.code, parsed.voucherCode.trim()))
        .get();
      if (v && !v.isRedeemed) {
        voucherId = v.id;
        db.update(giftVouchers)
          .set({
            isRedeemed: true,
            redeemedByClientId: parsed.clientId,
            redeemedAt: new Date(),
          })
          .where(eq(giftVouchers.id, v.id))
          .run();
      }
    }

    db.insert(payments)
      .values({
        clientId: parsed.clientId,
        appointmentId: apptId,
        packageId: parsed.packageId ?? null,
        voucherId: voucherId ?? null,
        amountEur:
          parsed.paymentMethod === "package" ? 0 : parsed.totalPriceEur,
        paymentMethod: parsed.paymentMethod,
        notes: null,
      })
      .run();
  }

  await logActivity(
    "appointment.new",
    `Appointment booked for ${parsed.date} ${parsed.startTime}`,
    { appointmentId: apptId, clientId: parsed.clientId },
  );

  try {
    onAppointmentBooked(parsed.clientId, parsed.status);
    onPaymentRecorded(parsed.clientId);
  } catch (err) {
    console.error("[pipeline] booking action hook failed:", err);
  }

  revalidatePath("/appointments");
  revalidatePath("/dashboard");
  redirect(`/appointments/${apptId}`);
}

export async function updateStatusAction(
  id: number,
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show",
) {
  await requireUser();
  db.update(appointments)
    .set({ status, updatedAt: new Date() })
    .where(eq(appointments.id, id))
    .run();
  await logActivity(
    `appointment.${status}`,
    `Appointment #${id} marked ${status}`,
    { appointmentId: id },
  );
  try {
    onAppointmentStatus(id, status);
  } catch (err) {
    console.error("[pipeline] status hook failed:", err);
  }
  revalidatePath(`/appointments/${id}`);
  revalidatePath("/appointments");
  revalidatePath("/dashboard");
}

const completeSchema = z.object({
  appointmentId: z.coerce.number().int().positive(),
  outcomeRating: z.coerce.number().int().min(1).max(5).optional(),
  therapistNotes: z.string().optional(),
  packageId: z.coerce.number().int().positive().optional(),
});

export async function completeAppointmentAction(formData: FormData) {
  await requireUser();
  const parsed = completeSchema.parse({
    appointmentId: formData.get("appointmentId"),
    outcomeRating: formData.get("outcomeRating") || undefined,
    therapistNotes: formData.get("therapistNotes") || undefined,
    packageId: formData.get("packageId") || undefined,
  });

  const appt = db
    .select()
    .from(appointments)
    .where(eq(appointments.id, parsed.appointmentId))
    .get();
  if (!appt) throw new Error("Appointment not found");

  const therapyIds: number[] = JSON.parse(appt.therapyIds || "[]");
  const ts = db
    .select()
    .from(therapies)
    .where(sql`${therapies.id} IN (${sql.join(
      therapyIds.map((id) => sql`${id}`),
      sql`,`,
    )})`)
    .all();
  // Per-therapy duration distribution: divide total appointment minutes evenly
  const totalMins =
    minutesBetween(appt.startTime, appt.endTime) || (ts[0]?.defaultDurationMinutes ?? 30);
  const perTherapy = Math.max(
    1,
    Math.round(totalMins / Math.max(1, therapyIds.length)),
  );

  for (const tid of therapyIds) {
    db.insert(sessions)
      .values({
        appointmentId: appt.id,
        clientId: appt.clientId,
        therapyId: tid,
        date: appt.date,
        durationMinutes: perTherapy,
        therapistNotes: parsed.therapistNotes ?? null,
        outcomeRating: parsed.outcomeRating ?? null,
        packageId: parsed.packageId ?? null,
      })
      .run();
  }

  // Decrement package credit if attached
  if (parsed.packageId) {
    db.update(packages)
      .set({ sessionsUsed: sql`${packages.sessionsUsed} + 1` })
      .where(eq(packages.id, parsed.packageId))
      .run();
  }

  db.update(appointments)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(appointments.id, appt.id))
    .run();

  await logActivity(
    "session.complete",
    `Session completed for appointment #${appt.id}`,
    { appointmentId: appt.id },
  );
  try {
    onAppointmentStatus(appt.id, "completed");
  } catch (err) {
    console.error("[pipeline] complete hook failed:", err);
  }

  revalidatePath(`/appointments/${appt.id}`);
  revalidatePath("/appointments");
  revalidatePath(`/clients/${appt.clientId}`);
  revalidatePath("/dashboard");
}

export async function uncompleteAppointmentAction(id: number) {
  await requireUser();
  const appt = db
    .select()
    .from(appointments)
    .where(eq(appointments.id, id))
    .get();
  if (!appt) throw new Error("Appointment not found");
  if (appt.status !== "completed") {
    throw new Error("Appointment is not marked completed.");
  }

  // Refund any package credits used at completion, then remove the session
  // rows the completion created, then drop the appointment back to scheduled.
  const apptSessions = db
    .select()
    .from(sessions)
    .where(eq(sessions.appointmentId, id))
    .all();

  for (const s of apptSessions) {
    if (s.packageId != null) {
      db.update(packages)
        .set({
          sessionsUsed: sql`MAX(0, ${packages.sessionsUsed} - 1)`,
        })
        .where(eq(packages.id, s.packageId))
        .run();
    }
  }

  db.delete(sessions).where(eq(sessions.appointmentId, id)).run();

  db.update(appointments)
    .set({ status: "scheduled", updatedAt: new Date() })
    .where(eq(appointments.id, id))
    .run();

  await logActivity(
    "appointment.uncompleted",
    `Appointment #${id} reverted from completed`,
    { appointmentId: id },
  );

  revalidatePath(`/appointments/${id}`);
  revalidatePath("/appointments");
  revalidatePath(`/clients/${appt.clientId}`);
  revalidatePath("/dashboard");
}

export async function deleteAppointmentAction(id: number) {
  await requireUser();
  // Detach payments so the financial record survives the appointment delete.
  // sessions cascade automatically via FK.
  db.update(payments)
    .set({ appointmentId: null })
    .where(eq(payments.appointmentId, id))
    .run();
  db.delete(appointments).where(eq(appointments.id, id)).run();
  revalidatePath("/appointments");
  redirect("/appointments");
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}
