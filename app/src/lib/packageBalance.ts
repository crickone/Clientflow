import "server-only";

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { appointments, payments } from "@/lib/db/schema";

/**
 * Sessions booked on each package that haven't happened yet (scheduled or
 * confirmed). A booking paid by package writes a payment row carrying the
 * package id; the session only counts as used when it is completed.
 */
export function bookedByPackage(packageIds: number[], excludeAppointmentId?: number): Map<number, number> {
  const out = new Map<number, number>();
  if (packageIds.length === 0) return out;
  const rows = db
    .select({ packageId: payments.packageId, appointmentId: payments.appointmentId })
    .from(payments)
    .innerJoin(appointments, eq(appointments.id, payments.appointmentId))
    .where(and(inArray(payments.packageId, packageIds), isNotNull(payments.appointmentId), inArray(appointments.status, ["scheduled", "confirmed"])))
    .all();
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.packageId == null || r.appointmentId === excludeAppointmentId) continue;
    const key = `${r.packageId}:${r.appointmentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.set(r.packageId, (out.get(r.packageId) ?? 0) + 1);
  }
  return out;
}
