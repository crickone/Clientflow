import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { appointments, clients, leads } from "@/lib/db/schema";
import { checkBookingSlot } from "@/lib/schedule";
import { onAppointmentBooked } from "@/lib/pipeline/stage";
import { consultationConfig } from "./availability";
import { hmToMin, minToHm } from "./freeSlots";

/**
 * Put a lead in the diary.
 *
 * Three things have to happen together or not at all: the lead becomes a
 * client, the appointment exists, and the lead is linked to that client. Doing
 * them in sequence outside a transaction is how you end up with a client
 * record for someone who never got an appointment, so the whole thing runs in
 * one `db.transaction` and the slot is re-checked INSIDE it.
 *
 * That re-check is the double-booking guard. Slots are offered minutes or days
 * before they are accepted, and two leads can be offered the same Thursday at
 * 18:30 within seconds of each other. Whoever's write commits first wins; the
 * second gets a clean `slot_taken` and the agent offers alternatives. There is
 * deliberately no soft-hold on an offered slot: holding a slot for a lead who
 * may never reply costs the business a real booking, and the apology is rarer
 * than the empty diary would be.
 */

export type BookResult =
  | { ok: true; appointmentId: number; clientId: number; date: string; startTime: string; endTime: string }
  | { ok: false; error: "lead_not_found" | "already_client" | "no_contact" | "slot_taken" | "opted_out"; reason: string };

export interface BookInput {
  leadId: number;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** "HH:mm", Europe/Dublin. */
  startTime: string;
  /** Overrides the tenant's configured consultation length. */
  durationMinutes?: number;
  notes?: string;
}

export function bookConsultation(input: BookInput): BookResult {
  const config = consultationConfig();
  const durationMinutes = input.durationMinutes ?? config.durationMinutes;
  const endTime = minToHm(hmToMin(input.startTime) + durationMinutes);

  const lead = db.select().from(leads).where(eq(leads.id, input.leadId)).get();
  if (!lead) return { ok: false, error: "lead_not_found", reason: "No lead with that id." };
  if (lead.doNotCall) {
    return { ok: false, error: "opted_out", reason: "This lead has opted out. Nothing may be sent or booked for them." };
  }
  // A lead with no way to be contacted can still be booked by the owner by
  // hand, but the agent must not: it would have no way to confirm or remind.
  if (!lead.phone && !lead.email) {
    return { ok: false, error: "no_contact", reason: "Lead has neither a phone number nor an email address." };
  }

  let result: BookResult;
  try {
    result = db.transaction((tx) => {
      // Re-validate against the live diary, inside the transaction.
      const check = checkBookingSlot(input.date, input.startTime, durationMinutes, config.therapyIds);
      if (!check.ok) {
        // Roll back rather than leave a half-converted lead behind.
        throw new SlotTaken(check.reason ?? "That time is no longer free.");
      }

      // Convert, or reuse the client this lead already became.
      let clientId = lead.clientId ?? null;
      if (clientId == null) {
        const inserted = tx
          .insert(clients)
          .values({
            firstName: (lead.firstName ?? "").trim() || "Unknown",
            // clients.lastName is NOT NULL and a lead form often has only a
            // first name; the rest of the app uses "—" for this.
            lastName: (lead.lastName ?? "").trim() || "—",
            email: (lead.email ?? "").trim() || null,
            phone: (lead.phone ?? "").trim() || "—",
          })
          .returning({ id: clients.id })
          .all();
        clientId = inserted[0]!.id;
        tx.update(leads).set({ clientId, updatedAt: new Date() }).where(eq(leads.id, lead.id)).run();
      }

      const appt = tx
        .insert(appointments)
        .values({
          clientId,
          date: input.date,
          startTime: input.startTime,
          endTime,
          status: "scheduled",
          therapyIds: JSON.stringify(config.therapyIds),
          totalPriceEur: 0,
          notes: input.notes ?? `Consultation booked from lead #${lead.id}.`,
        })
        .returning({ id: appointments.id })
        .all();

      return {
        ok: true as const,
        appointmentId: appt[0]!.id,
        clientId,
        date: input.date,
        startTime: input.startTime,
        endTime,
      };
    });
  } catch (err) {
    if (err instanceof SlotTaken) return { ok: false, error: "slot_taken", reason: err.message };
    throw err;
  }

  // Stage advancement runs OUTSIDE the transaction, and ONLY on success: it
  // reads and writes the pipeline tables through its own helpers, and a
  // failure to move a card must never roll back a booking the client has
  // already been told about. Moving a lead to Booked when the slot was taken
  // would be the worse bug, so this sits after the success check rather than
  // in a `finally`.
  if (result.ok) {
    try {
      onAppointmentBooked(result.clientId, "scheduled");
    } catch {
      // Best-effort. The appointment is the thing that matters.
    }
  }
  return result;
}

/** Internal signal, so the transaction rolls back without inventing an error shape. */
class SlotTaken extends Error {}
