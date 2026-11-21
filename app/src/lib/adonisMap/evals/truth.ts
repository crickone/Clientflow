// app/src/lib/adonisMap/evals/truth.ts
import "server-only";

/** Expected answers, worked out from the seeded databases by SQL (and, for stage-based ones, the map's own Person rows). */
import { addDays, weekStart, weekdayName, dublinDate } from "../engine";
import { loadRows, makeLoadCtx } from "../load";
import { sqliteFor } from "../peopleData";
import { ALL_MODULES } from "../schema";
import type { GymKnown } from "./fixture";

export interface Truth {
  today: string;
  gym: GymKnown;
  clinicNames: string[];
  joinedRecentFewVisits: string[];
  plans: Record<string, number>;
  renewSoon: string[];
  expiringPackages: string[];
  topVisitors: string[];
  bookingsLastWeek: { kept: number; all: number };
  bookingsWeekBefore: { kept: number; all: number };
  halfEmptyLastWeek: string;
  placesThisWeek: string;
  busiest: string;
  noShowTwice: string[];
  topTherapy: string;
  offersThisMonthEur: number;
  leadsByWeek: string;
  membersNotContacted60: string[];
  autumnMembers: number;
}

const DAY_NAMES: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

export function computeTruth(a: { gymId: number; clinicId: number; today: string; gym: GymKnown; clinicNames: string[] }): Truth {
  const sq = sqliteFor(a.gymId);
  const today = a.today;
  const monthStart = `${today.slice(0, 7)}-01`;
  const w0 = weekStart(today);
  const lastFrom = addDays(w0, -7), lastTo = addDays(w0, -1);
  const prevFrom = addDays(w0, -14), prevTo = addDays(w0, -8);
  const names = (rows: unknown[]) => (rows as { name: string }[]).map((r) => r.name);

  const weekCounts = (from: string, to: string) => sq.prepare(
    `SELECT SUM(CASE WHEN b.status IN ('booked','attended','no_show') THEN 1 ELSE 0 END) AS kept, COUNT(*) AS allc
       FROM session_bookings b JOIN class_sessions s ON s.id = b.session_id WHERE s.date BETWEEN ? AND ?`,
  ).get(from, to) as { kept: number; allc: number };
  const last = weekCounts(lastFrom, lastTo);
  const prev = weekCounts(prevFrom, prevTo);

  const sessionLine = (r: { date: string; start_time: string; name: string }) => `${DAY_NAMES[weekdayName(r.date)]} ${r.date} ${r.start_time} ${r.name}`;
  const halfEmpty = sq.prepare(
    `SELECT s.date, s.start_time, s.name, s.capacity, SUM(CASE WHEN b.status IN ('booked','attended','no_show') THEN 1 ELSE 0 END) AS n
       FROM class_sessions s LEFT JOIN session_bookings b ON b.session_id = s.id
      WHERE s.date BETWEEN ? AND ? AND s.status = 'scheduled' GROUP BY s.id HAVING n * 2 < s.capacity ORDER BY s.date`,
  ).all(lastFrom, lastTo) as { date: string; start_time: string; name: string; capacity: number; n: number }[];
  const places = sq.prepare(
    `SELECT s.date, s.start_time, s.name, s.capacity - SUM(CASE WHEN b.status IN ('booked','attended') THEN 1 ELSE 0 END) AS left_
       FROM class_sessions s LEFT JOIN session_bookings b ON b.session_id = s.id
      WHERE s.date BETWEEN ? AND ? AND s.status = 'scheduled' GROUP BY s.id HAVING left_ > 0 ORDER BY s.date`,
  ).all(today, addDays(w0, 6)) as { date: string; start_time: string; name: string; left_: number }[];
  const busiestRows = sq.prepare(
    `SELECT s.date, s.start_time, COUNT(*) AS n FROM session_bookings b JOIN class_sessions s ON s.id = b.session_id
      WHERE s.date BETWEEN ? AND ? AND b.status IN ('booked','attended','no_show') GROUP BY s.date, s.start_time`,
  ).all(addDays(today, -28), addDays(today, -1)) as { date: string; start_time: string; n: number }[];
  const bySlot = new Map<string, number>();
  for (const r of busiestRows) {
    const k = `${DAY_NAMES[weekdayName(r.date)]} ${r.start_time}`;
    bySlot.set(k, (bySlot.get(k) ?? 0) + r.n);
  }
  const busiest = [...bySlot.entries()].sort((x, y) => y[1] - x[1])[0];

  const clinic = sqliteFor(a.clinicId);
  const therapyName = new Map((clinic.prepare("SELECT id, name FROM therapies").all() as { id: number; name: string }[]).map((t) => [t.id, t.name]));
  const therapyCount = new Map<string, number>();
  for (const r of clinic.prepare("SELECT therapy_ids FROM appointments WHERE date >= ? AND date <= ? AND status != 'cancelled'").all(monthStart, `${today.slice(0, 7)}-31`) as { therapy_ids: string }[]) {
    for (const id of JSON.parse(r.therapy_ids) as number[]) {
      const n = therapyName.get(id) ?? "";
      therapyCount.set(n, (therapyCount.get(n) ?? 0) + 1);
    }
  }

  const leadRows = sq.prepare("SELECT created_at, source FROM leads").all() as { created_at: number; source: string }[];
  const leadWeeks = new Map<string, number>();
  for (const r of leadRows) {
    const d = dublinDate(r.created_at);
    if (d < monthStart || d > today) continue;
    const k = `week of ${weekStart(d)}, ${r.source}`;
    leadWeeks.set(k, (leadWeeks.get(k) ?? 0) + 1);
  }

  const paidThisMonth = (sq.prepare("SELECT amount_cents, paid_at FROM offer_orders WHERE status = 'paid' AND paid_at IS NOT NULL").all() as { amount_cents: number; paid_at: number }[])
    .filter((r) => dublinDate(r.paid_at).slice(0, 7) === today.slice(0, 7))
    .reduce((s, r) => s + r.amount_cents / 100, 0);

  const persons = loadRows(makeLoadCtx(a.gymId, ALL_MODULES), "Person");
  const autumnMembers = persons.filter((p) => p.campaign === "Autumn reset" && p.stage === "member").length;
  const notContacted = persons
    .filter((p) => p.stage === "member" && (p.lastContactedAt === null || String(p.lastContactedAt).slice(0, 10) < addDays(today, -60)))
    .map((p) => String(p.name));

  return {
    today,
    gym: a.gym,
    clinicNames: a.clinicNames,
    joinedRecentFewVisits: names(sq.prepare(
      `SELECT c.first_name || ' ' || c.last_name AS name FROM clients c WHERE c.created_at >= ?
         AND (SELECT COUNT(*) FROM session_bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.client_id = c.id AND b.status = 'attended') < 3`,
    ).all(Date.parse(`${addDays(today, -60)}T00:00:00Z`))),
    plans: Object.fromEntries((sq.prepare("SELECT membership_name AS plan, COUNT(*) AS n FROM client_memberships WHERE status = 'active' GROUP BY membership_name").all() as { plan: string; n: number }[]).map((r) => [r.plan, r.n])),
    renewSoon: names(sq.prepare(
      "SELECT c.first_name || ' ' || c.last_name AS name FROM client_memberships m JOIN clients c ON c.id = m.client_id WHERE m.status = 'active' AND m.next_billing_date BETWEEN ? AND ?",
    ).all(today, addDays(today, 14))),
    expiringPackages: names(sq.prepare(
      "SELECT c.first_name || ' ' || c.last_name AS name FROM client_packages p JOIN clients c ON c.id = p.client_id WHERE p.status = 'active' AND p.end_date BETWEEN ? AND ? AND p.sessions_total - p.sessions_used > 2",
    ).all(today, addDays(today, 30))),
    // Everyone tied with the 10th-placed visitor counts as a top-10 answer: regulars attend in
    // groups with identical counts, so a hard LIMIT 10 would cut a tie at an alphabetical line.
    topVisitors: (() => {
      const ranked = sq.prepare(
        `SELECT c.first_name || ' ' || c.last_name AS name, COUNT(*) AS n FROM session_bookings b JOIN class_sessions s ON s.id = b.session_id JOIN clients c ON c.id = b.client_id
          WHERE b.status = 'attended' AND s.date BETWEEN ? AND ? GROUP BY c.id ORDER BY n DESC, name ASC`,
      ).all(monthStart, today) as { name: string; n: number }[];
      const cutoff = ranked[Math.min(9, ranked.length - 1)]?.n ?? 0;
      return ranked.filter((r) => r.n >= cutoff).map((r) => r.name);
    })(),
    bookingsLastWeek: { kept: last.kept ?? 0, all: last.allc },
    bookingsWeekBefore: { kept: prev.kept ?? 0, all: prev.allc },
    halfEmptyLastWeek: halfEmpty.map((r) => `${sessionLine(r)} (${r.n} of ${r.capacity})`).join("; ") || "none",
    placesThisWeek: places.map((r) => `${sessionLine(r)} (${r.left_} places)`).join("; ") || "No sessions with places are left this week.",
    busiest: busiest ? `${busiest[0]} (${busiest[1]} bookings)` : "none",
    noShowTwice: names(sq.prepare(
      `SELECT c.first_name || ' ' || c.last_name AS name, COUNT(*) AS n FROM session_bookings b JOIN class_sessions s ON s.id = b.session_id JOIN clients c ON c.id = b.client_id
        WHERE b.status = 'no_show' AND s.date >= ? GROUP BY c.id HAVING n >= 2`,
    ).all(addDays(today, -30))),
    topTherapy: [...therapyCount.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "",
    offersThisMonthEur: Math.round(paidThisMonth * 100) / 100,
    leadsByWeek: [...leadWeeks.entries()].sort().map(([k, n]) => `${k}: ${n}`).join("; ") || "none",
    membersNotContacted60: notContacted,
    autumnMembers,
  };
}
