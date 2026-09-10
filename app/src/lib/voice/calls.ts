import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getCurrentTenantDb, type TenantDb } from "@/lib/db/tenant";

/**
 * Voice call records: the tenant-DB row per call, plus the control-plane index
 * that lets a webhook find it again.
 *
 * The split exists because the post-call webhook is a server-to-server
 * callback with NO session cookie — the tenant cannot be resolved from the
 * request. `voice_call_index` (control plane) maps the provider's conversation
 * id to a (tenant, call) pair, written in the same request that dials. An
 * unknown conversation id resolves to nothing and the webhook ignores it: fail
 * CLOSED, never a default-tenant shortcut, which is what the 2026-08
 * multi-tenancy pass removed everywhere else.
 *
 * A call row is created BEFORE the provider is asked to dial, so a call that
 * never connects, or whose webhook is lost, is still visible as 'dialling'
 * rather than disappearing.
 */

export type VoiceCallStatus = "dialling" | "completed" | "failed" | "no_answer";

export interface VoiceCallRow {
  id: number;
  leadId: number | null;
  direction: string;
  status: VoiceCallStatus;
  toNumber: string | null;
  providerCallId: string | null;
  durationSeconds: number;
  billedMinutes: number;
  costCents: number;
  outcome: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  error: string | null;
  startedBy: string | null;
  createdAt: number;
  endedAt: number | null;
}

type Raw = {
  id: number;
  lead_id: number | null;
  direction: string;
  status: string;
  to_number: string | null;
  provider_call_id: string | null;
  duration_seconds: number;
  billed_minutes: number;
  cost_cents: number;
  outcome: string | null;
  transcript: string | null;
  recording_url: string | null;
  error: string | null;
  started_by: string | null;
  created_at: number;
  ended_at: number | null;
};

const toRow = (r: Raw): VoiceCallRow => ({
  id: r.id,
  leadId: r.lead_id,
  direction: r.direction,
  status: r.status as VoiceCallStatus,
  toNumber: r.to_number,
  providerCallId: r.provider_call_id,
  durationSeconds: r.duration_seconds,
  billedMinutes: r.billed_minutes,
  costCents: r.cost_cents,
  outcome: r.outcome,
  transcript: r.transcript,
  recordingUrl: r.recording_url,
  error: r.error,
  startedBy: r.started_by,
  createdAt: r.created_at,
  endedAt: r.ended_at,
});

/** The raw better-sqlite3 handle behind a drizzle tenant db — these are hand-written SQL statements against a table drizzle has no model for. */
function conn(tdb: TenantDb) {
  return (tdb as unknown as { $client: import("better-sqlite3").Database }).$client;
}

export function createCall(
  tdb: TenantDb,
  input: { leadId: number | null; toNumber: string; startedBy: string; direction?: "outbound" | "inbound" },
): VoiceCallRow {
  const row = conn(tdb)
    .prepare(
      `INSERT INTO voice_calls (lead_id, direction, status, to_number, started_by)
       VALUES (?, ?, 'dialling', ?, ?) RETURNING *`,
    )
    .get(input.leadId, input.direction ?? "outbound", input.toNumber, input.startedBy) as Raw;
  return toRow(row);
}

/** Attach the provider's conversation id to a call AND index it, so the webhook can find its way back. */
export function linkProviderCall(
  tdb: TenantDb,
  tenantId: number,
  callId: number,
  providerCallId: string,
): void {
  conn(tdb)
    .prepare("UPDATE voice_calls SET provider_call_id = ? WHERE id = ?")
    .run(providerCallId, callId);
  controlSqlite
    .prepare(
      `INSERT INTO voice_call_index (provider_call_id, tenant_id, call_id)
       VALUES (?, ?, ?) ON CONFLICT(provider_call_id) DO NOTHING`,
    )
    .run(providerCallId, tenantId, callId);
}

/** Resolve a provider conversation id to its owning tenant + call. `null` = unknown, and the caller must then do NOTHING. */
export function resolveProviderCall(
  providerCallId: string,
): { tenantId: number; callId: number } | null {
  const row = controlSqlite
    .prepare("SELECT tenant_id, call_id FROM voice_call_index WHERE provider_call_id = ?")
    .get(providerCallId) as { tenant_id: number; call_id: number } | undefined;
  return row ? { tenantId: row.tenant_id, callId: row.call_id } : null;
}

export function markCallFailed(tdb: TenantDb, callId: number, error: string): void {
  conn(tdb)
    .prepare("UPDATE voice_calls SET status = 'failed', error = ?, ended_at = unixepoch() * 1000 WHERE id = ?")
    .run(error.slice(0, 500), callId);
}

export interface CallCompletion {
  status: VoiceCallStatus;
  durationSeconds: number;
  billedMinutes: number;
  costCents: number;
  outcome: string | null;
  transcript: string | null;
  recordingUrl: string | null;
}

/**
 * Write a finished call's outcome. Guarded on the row still being 'dialling',
 * the same "conditional UPDATE as mutex" shape the billing engine's invoice
 * claim uses: a provider that delivers the same webhook twice (they retry) must
 * not double-write, and — because metering is keyed off this returning true —
 * must not double-charge. Returns whether THIS call was the one that completed it.
 */
export function completeCall(tdb: TenantDb, callId: number, c: CallCompletion): boolean {
  const res = conn(tdb)
    .prepare(
      `UPDATE voice_calls
       SET status = ?, duration_seconds = ?, billed_minutes = ?, cost_cents = ?,
           outcome = ?, transcript = ?, recording_url = ?, ended_at = unixepoch() * 1000
       WHERE id = ? AND status = 'dialling'`,
    )
    .run(
      c.status,
      c.durationSeconds,
      c.billedMinutes,
      c.costCents,
      c.outcome,
      c.transcript,
      c.recordingUrl,
      callId,
    );
  return res.changes > 0;
}

export function getCall(tdb: TenantDb, callId: number): VoiceCallRow | null {
  const row = conn(tdb).prepare("SELECT * FROM voice_calls WHERE id = ?").get(callId) as Raw | undefined;
  return row ? toRow(row) : null;
}

/** A lead's calls, newest first — for the lead timeline. */
export function listCallsForLead(leadId: number, tdb?: TenantDb): VoiceCallRow[] {
  const rows = conn(tdb ?? getCurrentTenantDb())
    .prepare("SELECT * FROM voice_calls WHERE lead_id = ? ORDER BY id DESC")
    .all(leadId) as Raw[];
  return rows.map(toRow);
}

/** The tenant's recent calls, newest first. */
export function listRecentCalls(limit = 50, tdb?: TenantDb): VoiceCallRow[] {
  const rows = conn(tdb ?? getCurrentTenantDb())
    .prepare("SELECT * FROM voice_calls ORDER BY id DESC LIMIT ?")
    .all(limit) as Raw[];
  return rows.map(toRow);
}
