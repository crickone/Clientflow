/**
 * Classes preset pure helpers (no DB, no server imports; tested in
 * classes.test.ts). The loaders live in classesQueries.ts.
 */
import { pct } from "./stats";

export type FillRow = { label: string; booked: number; capacity: number; pct: number };

/** Booked over capacity per group, fullest first, top `n`. Zero-capacity groups are skipped. */
export function fillByGroup(items: { key: string; booked: number; capacity: number }[], n: number): FillRow[] {
  const g = new Map<string, { booked: number; capacity: number }>();
  for (const i of items) {
    const e = g.get(i.key) ?? { booked: 0, capacity: 0 };
    e.booked += i.booked;
    e.capacity += i.capacity;
    g.set(i.key, e);
  }
  return [...g.entries()]
    .filter(([, v]) => v.capacity > 0)
    .map(([label, v]) => ({ label, booked: v.booked, capacity: v.capacity, pct: pct(v.booked, v.capacity) ?? 0 }))
    .sort((a, b) => b.pct - a.pct || b.capacity - a.capacity)
    .slice(0, n);
}

/**
 * Weekday (Mon first) by hour grid of the average fill pct (0-100, whole
 * numbers) of sessions starting then. `date` and `startTime` are already
 * Dublin wall-clock values, so no timezone conversion is needed.
 */
export function fillBySlotGrid(sessions: { date: string; startTime: string; booked: number; capacity: number }[]): number[][] {
  const sum = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const cnt = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const s of sessions) {
    if (s.capacity <= 0) continue;
    const dow = (new Date(`${s.date}T00:00:00Z`).getUTCDay() + 6) % 7;
    const hour = Number(s.startTime.slice(0, 2));
    if (!(hour >= 0 && hour < 24)) continue;
    sum[dow][hour] += (s.booked / s.capacity) * 100;
    cnt[dow][hour]++;
  }
  return sum.map((row, d) => row.map((v, h) => (cnt[d][h] ? Math.round(v / cnt[d][h]) : 0)));
}

export type InstructorRow = { name: string; classes: number; fillPct: number | null; attendancePct: number | null };

export function instructorRows(
  sessions: { instructor: string | null; booked: number; capacity: number; attended: number; noShow: number }[],
): InstructorRow[] {
  const g = new Map<string, { classes: number; booked: number; capacity: number; attended: number; noShow: number }>();
  for (const s of sessions) {
    const k = s.instructor && s.instructor.trim() ? s.instructor.trim() : "Unassigned";
    const e = g.get(k) ?? { classes: 0, booked: 0, capacity: 0, attended: 0, noShow: 0 };
    e.classes++;
    e.booked += s.booked;
    e.capacity += s.capacity;
    e.attended += s.attended;
    e.noShow += s.noShow;
    g.set(k, e);
  }
  return [...g.entries()]
    .map(([name, v]) => ({
      name,
      classes: v.classes,
      fillPct: pct(v.booked, v.capacity),
      attendancePct: pct(v.attended, v.attended + v.noShow),
    }))
    .sort((a, b) => b.classes - a.classes || a.name.localeCompare(b.name));
}

export type QuietMember = { id: number; name: string; lastMs: number | null };

/** Members with no visit in the last `days` days: never-visited first, then oldest visit first. */
export function quietMembers(members: QuietMember[], nowMs: number, days: number, limit: number): QuietMember[] {
  const cutoff = nowMs - days * 86_400_000;
  return members
    .filter((m) => m.lastMs === null || m.lastMs < cutoff)
    .sort((a, b) => (a.lastMs ?? -Infinity) - (b.lastMs ?? -Infinity))
    .slice(0, limit);
}
