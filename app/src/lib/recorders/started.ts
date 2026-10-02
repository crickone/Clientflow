/**
 * Event recorders (dashboard slice 2) start empty on deploy day. Each one is
 * stamped once per tenant, the first time ensureTenantTables runs after the
 * deploy, so a dashboard widget can say "Collecting since <date>" instead of
 * showing a misleading zero. The stamp never moves (INSERT OR IGNORE).
 *
 * Pure on purpose (no @/lib imports): src/lib/db/tenant.ts imports it, so it
 * must not reach back into settings/db. The ambient-db reader is in
 * ./startedStore.
 */

export const RECORDER_KEYS = ["stage_history", "page_views", "email_events", "status_dates"] as const;
export type RecorderKey = (typeof RECORDER_KEYS)[number];

export function recorderSettingKey(key: RecorderKey): string {
  return `recorder_started:${key}`;
}

/** Idempotent: run on every tenant open, only the first run writes. */
export const RECORDER_START_SQL = RECORDER_KEYS.map(
  (k) =>
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('${recorderSettingKey(k)}', json_quote(strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));`,
).join("\n");

/** An ISO string to a Date, or null when it is not a valid date. */
export function parseIsoDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse the raw JSON text stored in settings.value. */
export function parseRecorderStart(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  try {
    return parseIsoDate(JSON.parse(raw));
  } catch {
    return null;
  }
}
