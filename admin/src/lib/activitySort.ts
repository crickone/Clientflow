/** Join and sort for the dashboard's "This week" table. Pure, so it is tested without a browser. */
import type { ActivityRow } from "./types";

export type ActivitySortKey = "problems" | "name" | "lastLogin" | "membersActive" | "bookings" | "leads" | "sales" | "ai" | "setup";

export interface ActivityView {
  row: ActivityRow;
  /** Open problems; null when the alerts feed was unavailable, so it is unknown rather than zero. */
  problems: number | null;
  worst: "bad" | "warn" | null;
}

export const ACTIVITY_SORT_KEYS: ActivitySortKey[] = ["problems", "name", "lastLogin", "membersActive", "bookings", "leads", "sales", "ai", "setup"];

/** Attach each business's open-problem count and its worst level. Snoozed-until-future alerts do not count. */
export function joinProblems(
  rows: ActivityRow[],
  alerts: { tenantId: number | null; level: string; snoozedUntil?: number | null }[] | null,
  now: number,
): ActivityView[] {
  if (alerts === null) return rows.map((row) => ({ row, problems: null, worst: null }));
  const byTenant = new Map<number, { problems: number; worst: "bad" | "warn" | null }>();
  for (const a of alerts) {
    if (a.tenantId === null || a.tenantId === undefined) continue;
    if (a.snoozedUntil != null && a.snoozedUntil > now) continue;
    const cur = byTenant.get(a.tenantId) ?? { problems: 0, worst: null };
    cur.problems += 1;
    if (a.level === "bad") cur.worst = "bad";
    else if (a.level === "warn" && cur.worst === null) cur.worst = "warn";
    byTenant.set(a.tenantId, cur);
  }
  return rows.map((row) => {
    const hit = byTenant.get(row.tenantId);
    return { row, problems: hit?.problems ?? 0, worst: hit?.worst ?? null };
  });
}

/** This week's bookings minus the week before; null when either is unknown. */
export function bookingsDelta(row: ActivityRow): number | null {
  if (row.bookings7d === null || row.bookingsPrev7d === null) return null;
  return row.bookings7d - row.bookingsPrev7d;
}

function valueOf(v: ActivityView, key: ActivitySortKey): number | string | null {
  const r = v.row;
  switch (key) {
    case "problems": return v.problems;
    case "name": return r.name;
    case "lastLogin": return r.lastLoginAt;
    case "membersActive": return r.membersActive7d;
    case "bookings": return r.bookings7d;
    case "leads": return r.leads7d;
    case "sales": return r.salesCents7d;
    case "ai": return r.aiCentsThisMonth;
    case "setup": return r.setup && r.setup.total > 0 ? r.setup.done / r.setup.total : null;
  }
}

const byName = (a: ActivityView, b: ActivityView) => a.row.name.localeCompare(b.row.name, undefined, { sensitivity: "base", numeric: true });

/** Nulls always last; ties fall back to name ascending. Does not mutate its input. */
export function sortActivity(views: ActivityView[], key: ActivitySortKey, dir: "asc" | "desc"): ActivityView[] {
  return [...views].sort((a, b) => {
    const av = valueOf(a, key);
    const bv = valueOf(b, key);
    if (av === null && bv === null) return byName(a, b);
    if (av === null) return 1;
    if (bv === null) return -1;
    const c = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true });
    return (dir === "asc" ? c : -c) || byName(a, b);
  });
}
