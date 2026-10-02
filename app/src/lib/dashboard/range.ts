/**
 * Dashboard date ranges. Every window is a run of whole UTC days (the same
 * day boundary lib/dashboard.ts and the appointment `date` column use).
 * `toMs` is exclusive so it can feed `lt()` on timestamp columns; `toIso`
 * is inclusive so it can feed `lte()` on ISO `date` text columns.
 *
 * Pure: no DB, no server imports.
 */
export type RangeKey = "today" | "7d" | "30d" | "90d" | "month" | "custom";

/** The keys a tab may persist. `custom` lives only in the URL. */
export const STORED_RANGE_KEYS = ["today", "7d", "30d", "90d", "month"] as const;
export type StoredRangeKey = (typeof STORED_RANGE_KEYS)[number];

const ALL_KEYS: readonly RangeKey[] = [...STORED_RANGE_KEYS, "custom"];

export const RANGE_LABELS: Record<StoredRangeKey, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
};

export interface ResolvedRange {
  key: RangeKey;
  label: string;
  fromMs: number;
  toMs: number;
  fromIso: string;
  toIso: string;
  days: number;
}

/** Longest custom window accepted, in whole days. */
export const MAX_CUSTOM_RANGE_DAYS = 366;

const DAY = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function build(key: RangeKey, label: string, fromMs: number, toMs: number): ResolvedRange {
  return {
    key,
    label,
    fromMs,
    toMs,
    fromIso: isoOf(fromMs),
    toIso: isoOf(toMs - DAY),
    days: Math.round((toMs - fromMs) / DAY),
  };
}

export function parseRangeKey(v: unknown): RangeKey | null {
  return typeof v === "string" && (ALL_KEYS as readonly string[]).includes(v) ? (v as RangeKey) : null;
}

function shortDate(iso: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

export function resolveRange(
  key: RangeKey,
  now: Date,
  custom?: { from?: string; to?: string },
): ResolvedRange {
  const start = dayStart(now);
  const end = start + DAY;
  switch (key) {
    case "today":
      return build(key, RANGE_LABELS.today, start, end);
    case "7d":
      return build(key, RANGE_LABELS["7d"], start - 6 * DAY, end);
    case "90d":
      return build(key, RANGE_LABELS["90d"], start - 89 * DAY, end);
    case "month":
      return build(key, RANGE_LABELS.month, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1), end);
    case "custom": {
      const from = custom?.from;
      const to = custom?.to;
      if (from && to && ISO_RE.test(from) && ISO_RE.test(to)) {
        const f = Date.parse(`${from}T00:00:00Z`);
        const t = Date.parse(`${to}T00:00:00Z`);
        if (
          Number.isFinite(f) &&
          Number.isFinite(t) &&
          isoOf(f) === from &&
          isoOf(t) === to &&
          f <= t &&
          t - f + DAY <= MAX_CUSTOM_RANGE_DAYS * DAY
        ) {
          return build("custom", `${shortDate(from)} - ${shortDate(to)}`, f, t + DAY);
        }
      }
      return resolveRange("30d", now);
    }
    case "30d":
    default:
      return build("30d", RANGE_LABELS["30d"], start - 29 * DAY, end);
  }
}

/** The same-length window immediately before `r`. */
export function previousRange(r: ResolvedRange): ResolvedRange {
  const len = r.toMs - r.fromMs;
  return build(r.key, "Previous period", r.fromMs - len, r.fromMs);
}

/** Percentage change, rounded to a whole number; null when there is no baseline. */
export function deltaPct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}
