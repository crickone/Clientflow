import "server-only";

import type { TenantDb } from "@/lib/db/tenant";
import { getCurrentTenantDb } from "@/lib/db/tenant";
import type { CallFlowConfig } from "./flow";

/**
 * The dialler's work list. Who the call flow intends to phone, and when.
 *
 * Persisted rather than held in memory because the process restarts on every
 * deploy, and a call queued for 10 minutes' time must survive that. It is also
 * the honest answer to "who is this thing about to ring?", which an operator
 * is entitled to be able to see.
 *
 * Enrolment is deliberately conservative:
 *   - ONE pending row per lead, enforced by a partial unique index rather than
 *     a read-then-write check, so two lead-created events for the same person
 *     (a re-submitted form, a Make.com retry) cannot queue two calls;
 *   - enrolment only ever happens while the flow is armed, so disarming stops
 *     new work immediately;
 *   - `attempt` counts calls ALREADY made, so the flow's maxAttempts reads as
 *     `attempt >= maxAttempts -> stop` with no off-by-one to get wrong.
 */

export type QueueStatus = "pending" | "done" | "cancelled" | "exhausted";

export interface QueueItem {
  id: number;
  leadId: number;
  dueAt: number;
  attempt: number;
  status: QueueStatus;
  lastError: string | null;
}

type Raw = {
  id: number;
  lead_id: number;
  due_at: number;
  attempt: number;
  status: string;
  last_error: string | null;
};

const toItem = (r: Raw): QueueItem => ({
  id: r.id,
  leadId: r.lead_id,
  dueAt: r.due_at,
  attempt: r.attempt,
  status: r.status as QueueStatus,
  lastError: r.last_error,
});

function conn(tdb: TenantDb) {
  return (tdb as unknown as { $client: import("better-sqlite3").Database }).$client;
}

/**
 * Enrol a lead for a first call at `dueAt`. A no-op if that lead already has a
 * pending row — the partial unique index does the deciding, so a race between
 * two inbound webhooks can't double-enrol. Returns whether a row was added.
 */
export function enqueueCall(tdb: TenantDb, leadId: number, dueAt: number): boolean {
  const res = conn(tdb)
    .prepare(
      `INSERT INTO voice_call_queue (lead_id, due_at) VALUES (?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(leadId, dueAt);
  return res.changes > 0;
}

/** Everything due at or before `now`, oldest first. */
export function dueItems(tdb: TenantDb, now: number, limit = 25): QueueItem[] {
  const rows = conn(tdb)
    .prepare(
      "SELECT id, lead_id, due_at, attempt, status, last_error FROM voice_call_queue WHERE status = 'pending' AND due_at <= ? ORDER BY due_at LIMIT ?",
    )
    .all(now, limit) as Raw[];
  return rows.map(toItem);
}

/** Pending work, soonest first — what the UI shows as "up next". */
export function listPending(tdb?: TenantDb, limit = 20): QueueItem[] {
  const rows = conn(tdb ?? getCurrentTenantDb())
    .prepare(
      "SELECT id, lead_id, due_at, attempt, status, last_error FROM voice_call_queue WHERE status = 'pending' ORDER BY due_at LIMIT ?",
    )
    .all(limit) as Raw[];
  return rows.map(toItem);
}

/**
 * Push an item into the future without consuming an attempt — used when the
 * calling window is shut. Deferring is NOT a failed attempt: a lead queued at
 * 2am must still get its full three tries during business hours.
 */
export function deferItem(tdb: TenantDb, id: number, dueAt: number): void {
  conn(tdb)
    .prepare("UPDATE voice_call_queue SET due_at = ?, updated_at = unixepoch() * 1000 WHERE id = ? AND status = 'pending'")
    .run(dueAt, id);
}

/**
 * Record that an attempt was MADE and schedule the next one, or stop.
 *
 * Called after a dial is placed, not after it is answered — the outcome
 * arrives later on the webhook, and a lead that answered is cancelled from the
 * queue there. Counting at dial time is what makes maxAttempts a real cap even
 * if every webhook is lost.
 */
export function recordAttempt(
  tdb: TenantDb,
  item: QueueItem,
  flow: CallFlowConfig,
  nextDueAt: number,
  error?: string | null,
): void {
  const attempt = item.attempt + 1;
  const exhausted = attempt >= flow.maxAttempts;
  conn(tdb)
    .prepare(
      `UPDATE voice_call_queue
       SET attempt = ?, status = ?, due_at = ?, last_error = ?, updated_at = unixepoch() * 1000
       WHERE id = ?`,
    )
    .run(attempt, exhausted ? "exhausted" : "pending", nextDueAt, error ?? null, item.id);
}

/**
 * Take a lead off the queue. Called when they answer, when they're marked
 * do-not-call, or when an operator calls them by hand — in every case the flow
 * has no further business phoning them unprompted.
 */
export function cancelForLead(tdb: TenantDb, leadId: number, reason: string): void {
  conn(tdb)
    .prepare(
      "UPDATE voice_call_queue SET status = 'cancelled', last_error = ?, updated_at = unixepoch() * 1000 WHERE lead_id = ? AND status = 'pending'",
    )
    .run(reason.slice(0, 200), leadId);
}

/** Mark a lead's pending call finished (they were reached). */
export function completeForLead(tdb: TenantDb, leadId: number): void {
  conn(tdb)
    .prepare(
      "UPDATE voice_call_queue SET status = 'done', updated_at = unixepoch() * 1000 WHERE lead_id = ? AND status = 'pending'",
    )
    .run(leadId);
}
