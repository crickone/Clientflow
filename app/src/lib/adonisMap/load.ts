// app/src/lib/adonisMap/load.ts
import "server-only";

/**
 * Fills each map type with plain rows from today's tables. Raw SQL with bound
 * parameters only; every read goes through the explicit tenant's own DB.
 * Hidden fields (medical notes, addresses, Stripe ids, raw payloads ...) are
 * never selected.
 */
import { fenceUntrusted } from "@/lib/agents/toolKit";
import { addDays, dublinDate, dublinDateTime } from "./engine";
import { leadDisplayName, loadPeopleData, sqliteFor, type LeadFull, type PeopleData, type Sqlite } from "./peopleData";
import { emailKey, personStage, phoneKey } from "./person";
import { TYPE_DEFS, availableTypes, type MapModules } from "./schema";
import { MapError, type DateRange, type Row, type TypeName } from "./types";

export interface LoadArgs {
  range?: DateRange;
  clientIds?: number[];
  sessionIds?: number[];
  bookingIds?: number[];
  appointmentIds?: number[];
}

export interface LoadCtx {
  tenantId: number;
  nowMs: number;
  today: string;
  modules: MapModules;
  available: TypeName[];
  sq: Sqlite;
  cache: Map<string, Row[]>;
  peopleData?: PeopleData;
}

export function makeLoadCtx(tenantId: number, modules: MapModules, nowMs = Date.now()): LoadCtx {
  return { tenantId, nowMs, today: dublinDate(nowMs), modules, available: availableTypes(modules), sq: sqliteFor(tenantId), cache: new Map() };
}

export function people(lc: LoadCtx): PeopleData {
  lc.peopleData ??= loadPeopleData(lc.sq);
  return lc.peopleData;
}

export function loadRows(lc: LoadCtx, type: TypeName, args: LoadArgs = {}): Row[] {
  const key = `${type}|${JSON.stringify(args)}`;
  const hit = lc.cache.get(key);
  if (hit) return hit;
  const rows = LOADERS[type](lc, args);
  const max = TYPE_DEFS[type].maxRows;
  if (rows.length > max) {
    const d = TYPE_DEFS[type].dateField;
    throw new MapError(`There are ${rows.length} ${type} records to check, more than ${max}. ${d ? `Add a date range on ${d}.` : "Add a narrower filter."}`);
  }
  lc.cache.set(key, rows);
  return rows;
}

// ── SQL helpers ──

type Params = unknown[];

function rangeSql(col: string, r: DateRange | undefined, params: Params): string {
  const parts: string[] = [];
  if (r?.from) { parts.push(`${col} >= ?`); params.push(r.from); }
  if (r?.to) { parts.push(`${col} <= ?`); params.push(r.to); }
  return parts.join(" AND ");
}

function inSql(col: string, ids: number[] | undefined, params: Params): string {
  if (ids === undefined) return "";
  if (ids.length === 0) return "0"; // an empty list matches nothing
  params.push(...ids);
  return `${col} IN (${ids.map(() => "?").join(", ")})`;
}

function whereSql(parts: string[]): string {
  const p = parts.filter(Boolean);
  return p.length ? ` WHERE ${p.join(" AND ")}` : "";
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const msDate = (ms: number | null) => (ms === null ? null : dublinDate(ms));
const msDateTime = (ms: number | null) => (ms === null ? null : dublinDateTime(ms));
const maxN = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
function nameOf(lc: LoadCtx, personId: string | null): string | null {
  return personId ? people(lc).personName.get(personId) ?? null : null;
}

// ── Booking ──

const APPT_STATUS: Record<string, string> = { scheduled: "booked", confirmed: "booked", completed: "attended", cancelled: "cancelled", no_show: "no_show" };

function therapyNames(json: string, names: Map<number, string>): string {
  let ids: unknown;
  try {
    ids = JSON.parse(json);
  } catch {
    return "Appointment"; // a malformed therapy list still names the booking
  }
  return Array.isArray(ids) && ids.length ? ids.map((i) => names.get(Number(i)) ?? "Therapy").join(", ") : "Appointment";
}

function loadBookings(lc: LoadCtx, a: LoadArgs): Row[] {
  const out: Row[] = [];
  // Id filters say which half they are for: class booking ids and session ids only concern classes.
  const classPart = lc.modules.timetable && (a.appointmentIds === undefined || a.bookingIds !== undefined);
  const apptPart = lc.modules.calendar && a.sessionIds === undefined && (a.bookingIds === undefined || a.appointmentIds !== undefined);
  if (classPart) {
    const params: Params = [];
    const sql =
      "SELECT b.id, b.client_id, b.status, s.id AS session_id, s.date, s.start_time, s.name, s.instructor FROM session_bookings b JOIN class_sessions s ON s.id = b.session_id" +
      whereSql([rangeSql("s.date", a.range, params), inSql("b.client_id", a.clientIds, params), inSql("s.id", a.sessionIds, params), inSql("b.id", a.bookingIds, params)]);
    for (const r of lc.sq.prepare(sql).all(...params) as { id: number; client_id: number; status: string; session_id: number; date: string; start_time: string; name: string; instructor: string | null }[]) {
      const personId = `c:${r.client_id}`;
      out.push({
        id: `s:${r.id}`, kind: "class", date: r.date, startsAt: `${r.date} ${r.start_time}`, status: r.status, name: r.name,
        instructor: r.instructor, priceEur: null, personId, personName: nameOf(lc, personId), classId: `k:${r.session_id}`,
      });
    }
  }
  if (apptPart) {
    const therapy = new Map((lc.sq.prepare("SELECT id, name FROM therapies").all() as { id: number; name: string }[]).map((t) => [t.id, t.name]));
    const params: Params = [];
    const sql =
      "SELECT id, client_id, date, start_time, status, therapy_ids, total_price_eur FROM appointments" +
      whereSql([rangeSql("date", a.range, params), inSql("client_id", a.clientIds, params), inSql("id", a.appointmentIds, params)]);
    for (const r of lc.sq.prepare(sql).all(...params) as { id: number; client_id: number; date: string; start_time: string; status: string; therapy_ids: string; total_price_eur: number }[]) {
      const personId = `c:${r.client_id}`;
      out.push({
        id: `a:${r.id}`, kind: "appointment", date: r.date, startsAt: `${r.date} ${r.start_time}`, status: APPT_STATUS[r.status] ?? "booked",
        name: therapyNames(r.therapy_ids, therapy), instructor: null, priceEur: r.total_price_eur, personId, personName: nameOf(lc, personId), classId: null,
      });
    }
  }
  return out;
}

// ── Class ──

function loadClasses(lc: LoadCtx, a: LoadArgs): Row[] {
  if (!lc.modules.timetable) return [];
  const params: Params = [];
  const sql =
    `SELECT s.id, s.name, s.date, s.start_time, s.end_time, s.category, s.capacity, s.instructor, s.status,
        COALESCE(SUM(CASE WHEN b.status IN ('booked', 'attended', 'no_show') THEN 1 ELSE 0 END), 0) AS booked,
        COALESCE(SUM(CASE WHEN b.status IN ('booked', 'attended') THEN 1 ELSE 0 END), 0) AS taking
       FROM class_sessions s LEFT JOIN session_bookings b ON b.session_id = s.id` +
    whereSql([rangeSql("s.date", a.range, params), inSql("s.id", a.sessionIds, params)]) +
    " GROUP BY s.id";
  return (lc.sq.prepare(sql).all(...params) as { id: number; name: string; date: string; start_time: string; end_time: string; category: string | null; capacity: number; instructor: string | null; status: string; booked: number; taking: number }[]).map((r) => ({
    id: `k:${r.id}`, name: r.name, date: r.date, startsAt: `${r.date} ${r.start_time}`, endTime: r.end_time, category: r.category,
    capacity: r.capacity, instructor: r.instructor, status: r.status, booked: r.booked,
    placesLeft: Math.max(0, r.capacity - r.taking), fillRate: r.capacity > 0 ? Math.round((r.booked / r.capacity) * 100) : null,
  }));
}

// ── Membership ──

function monthsBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

function loadMemberships(lc: LoadCtx): Row[] {
  const rows = lc.sq.prepare("SELECT id, client_id, membership_name, price_cents, status, start_date, next_billing_date, ended_at FROM client_memberships").all() as { id: number; client_id: number; membership_name: string; price_cents: number; status: string; start_date: string; next_billing_date: string | null; ended_at: number | null }[];
  return rows.map((r) => {
    const personId = `c:${r.client_id}`;
    const ended = msDate(r.ended_at);
    return {
      id: `m:${r.id}`, plan: r.membership_name, priceEur: r.price_cents / 100, status: r.status, startDate: r.start_date,
      nextBillingDate: r.next_billing_date, endedAt: ended, monthsOnPlan: monthsBetween(r.start_date, ended ?? lc.today),
      personId, personName: nameOf(lc, personId),
    };
  });
}

// ── Package ──

function loadPackages(lc: LoadCtx): Row[] {
  const out: Row[] = [];
  for (const r of lc.sq.prepare("SELECT id, client_id, package_name, price_cents, sessions_total, unlimited_sessions, sessions_used, status, start_date, end_date FROM client_packages").all() as { id: number; client_id: number; package_name: string; price_cents: number; sessions_total: number; unlimited_sessions: number; sessions_used: number; status: string; start_date: string; end_date: string | null }[]) {
    const personId = `c:${r.client_id}`;
    const unlimited = r.unlimited_sessions === 1;
    out.push({
      id: `p:${r.id}`, name: r.package_name, kind: "package", sessionsTotal: r.sessions_total, sessionsUsed: r.sessions_used,
      sessionsLeft: unlimited ? null : Math.max(0, r.sessions_total - r.sessions_used), unlimited, status: r.status,
      startDate: r.start_date, endDate: r.end_date, priceEur: r.price_cents / 100, personId, personName: nameOf(lc, personId),
    });
  }
  for (const r of lc.sq.prepare("SELECT id, client_id, package_name, total_sessions, sessions_used, price_paid_eur, purchase_date, expiry_date, is_active FROM packages").all() as { id: number; client_id: number; package_name: string; total_sessions: number; sessions_used: number; price_paid_eur: number; purchase_date: string; expiry_date: string; is_active: number }[]) {
    const personId = `c:${r.client_id}`;
    out.push({
      id: `b:${r.id}`, name: r.package_name, kind: "bundle", sessionsTotal: r.total_sessions, sessionsUsed: r.sessions_used,
      sessionsLeft: Math.max(0, r.total_sessions - r.sessions_used), unlimited: false,
      status: r.is_active === 1 && r.expiry_date >= lc.today ? "active" : "expired",
      startDate: r.purchase_date, endDate: r.expiry_date, priceEur: r.price_paid_eur, personId, personName: nameOf(lc, personId),
    });
  }
  return out;
}

// ── Order ──

function orderPerson(p: PeopleData, r: { client_id: number | null; email: string | null; phone: string | null }): string | null {
  if (r.client_id !== null && p.clientById.has(r.client_id)) return `c:${r.client_id}`;
  const e = emailKey(r.email);
  if (e && p.personByEmail.has(e)) return p.personByEmail.get(e) ?? null;
  const ph = phoneKey(r.phone);
  if (ph && p.personByPhone.has(ph)) return p.personByPhone.get(ph) ?? null;
  return null;
}

function loadOrders(lc: LoadCtx): Row[] {
  const p = people(lc);
  const rows = lc.sq.prepare("SELECT o.id, o.amount_cents, o.status, o.created_at, o.paid_at, o.email, o.name, o.phone, o.client_id, f.title FROM offer_orders o LEFT JOIN offers f ON f.id = o.offer_id").all() as { id: number; amount_cents: number; status: string; created_at: number; paid_at: number | null; email: string | null; name: string | null; phone: string | null; client_id: number | null; title: string | null }[];
  return rows.map((r) => {
    const personId = orderPerson(p, r);
    return {
      id: `o:${r.id}`, offer: r.title ?? "Offer", amountEur: r.amount_cents / 100, status: r.status,
      createdAt: dublinDateTime(r.created_at), paidAt: msDateTime(r.paid_at), personId,
      personName: personId ? nameOf(lc, personId) : r.name, email: r.email,
    };
  });
}

// ── Conversation ──

function loadConversations(lc: LoadCtx): Row[] {
  const p = people(lc);
  const sql = `
    SELECT 'c' AS k, client_id AS rid, COALESCE(channel, 'manual') AS channel, COUNT(*) AS n, MAX(created_at) AS last_at,
           MAX(CASE WHEN direction = 'outbound' THEN created_at END) AS last_out, MAX(CASE WHEN direction = 'inbound' THEN created_at END) AS last_in
      FROM client_messages WHERE direction != 'note' GROUP BY client_id, COALESCE(channel, 'manual')
    UNION ALL
    SELECT 'l', lead_id, COALESCE(channel, 'manual'), COUNT(*), MAX(created_at),
           MAX(CASE WHEN direction = 'outbound' THEN created_at END), MAX(CASE WHEN direction = 'inbound' THEN created_at END)
      FROM lead_messages WHERE direction != 'note' GROUP BY lead_id, COALESCE(channel, 'manual')
    UNION ALL
    SELECT 'c', client_id, 'email', COUNT(*), MAX(COALESCE(internal_date, created_at)),
           MAX(CASE WHEN direction = 'out' THEN COALESCE(internal_date, created_at) END), MAX(CASE WHEN direction = 'in' THEN COALESCE(internal_date, created_at) END)
      FROM email_messages WHERE client_id IS NOT NULL GROUP BY client_id`;
  const merged = new Map<string, { personId: string; channel: string; n: number; lastAt: number; lastOut: number | null; lastIn: number | null }>();
  for (const r of lc.sq.prepare(sql).all() as { k: "c" | "l"; rid: number; channel: string; n: number; last_at: number; last_out: number | null; last_in: number | null }[]) {
    const personId = r.k === "c" ? `c:${r.rid}` : p.index.leadPerson.get(r.rid) ?? `l:${r.rid}`;
    const id = `${personId}|${r.channel}`;
    const m = merged.get(id) ?? { personId, channel: r.channel, n: 0, lastAt: 0, lastOut: null, lastIn: null };
    m.n += r.n;
    m.lastAt = Math.max(m.lastAt, r.last_at);
    m.lastOut = maxN(m.lastOut, r.last_out);
    m.lastIn = maxN(m.lastIn, r.last_in);
    merged.set(id, m);
  }
  return [...merged.entries()].map(([id, m]) => {
    const waiting = m.lastIn !== null && (m.lastOut === null || m.lastIn > m.lastOut);
    return {
      id, channel: m.channel, messageCount: m.n, lastMessageAt: dublinDateTime(m.lastAt), lastDirection: waiting ? "in" : "out",
      lastOutboundAt: msDateTime(m.lastOut), waitingForReply: waiting,
      hoursWaiting: waiting && m.lastIn !== null ? Math.floor((lc.nowMs - m.lastIn) / 3_600_000) : 0,
      personId: m.personId, personName: nameOf(lc, m.personId),
    };
  });
}

/** The last 10 messages of one conversation, oldest first, each trimmed to 500 characters, fenced as untrusted. */
export function conversationMessages(lc: LoadCtx, conversationId: string): string {
  const bar = conversationId.lastIndexOf("|");
  const personId = conversationId.slice(0, bar);
  const channel = conversationId.slice(bar + 1);
  const p = people(lc);
  const clientId = personId.startsWith("c:") ? Number(personId.slice(2)) : null;
  const leadIds = clientId !== null ? p.index.clientLeads.get(clientId) ?? [] : [Number(personId.slice(2))];
  const msgs: { at: number; direction: "in" | "out"; text: string }[] = [];
  const dir = (d: string): "in" | "out" => (d === "inbound" || d === "in" ? "in" : "out");
  type M = { at: number; direction: string; content: string };
  if (clientId !== null) {
    for (const m of lc.sq.prepare("SELECT created_at AS at, direction, content FROM client_messages WHERE client_id = ? AND COALESCE(channel, 'manual') = ? AND direction != 'note' ORDER BY created_at DESC LIMIT 10").all(clientId, channel) as M[]) {
      msgs.push({ at: m.at, direction: dir(m.direction), text: m.content });
    }
  }
  if (leadIds.length) {
    const sql = `SELECT created_at AS at, direction, content FROM lead_messages WHERE lead_id IN (${leadIds.map(() => "?").join(", ")}) AND COALESCE(channel, 'manual') = ? AND direction != 'note' ORDER BY created_at DESC LIMIT 10`;
    for (const m of lc.sq.prepare(sql).all(...leadIds, channel) as M[]) msgs.push({ at: m.at, direction: dir(m.direction), text: m.content });
  }
  if (channel === "email" && clientId !== null) {
    for (const m of lc.sq.prepare("SELECT COALESCE(internal_date, created_at) AS at, direction, COALESCE(body_text, snippet, subject, '') AS content FROM email_messages WHERE client_id = ? ORDER BY at DESC LIMIT 10").all(clientId) as M[]) {
      msgs.push({ at: m.at, direction: dir(m.direction), text: m.content });
    }
  }
  const last = msgs.sort((x, y) => y.at - x.at).slice(0, 10).reverse()
    .map((m) => ({ at: dublinDateTime(m.at), direction: m.direction, text: m.text.slice(0, 500) }));
  return fenceUntrusted(JSON.stringify(last));
}

// ── Person ──

function loadPersons(lc: LoadCtx): Row[] {
  const p = people(lc);
  const sq = lc.sq;
  const today = lc.today;
  const visits = new Map((sq.prepare(
    `SELECT client_id AS id, MAX(d) AS last, SUM(CASE WHEN d >= ? AND d <= ? THEN 1 ELSE 0 END) AS n30 FROM (
       SELECT b.client_id, s.date AS d FROM session_bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.status = 'attended'
       UNION ALL SELECT client_id, date FROM appointments WHERE status = 'completed'
     ) GROUP BY client_id`,
  ).all(addDays(today, -30), today) as { id: number; last: string; n30: number }[]).map((r) => [r.id, r]));
  const future = new Map((sq.prepare(
    `SELECT client_id AS id, COUNT(*) AS n FROM (
       SELECT b.client_id FROM session_bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.status = 'booked' AND s.status = 'scheduled' AND s.date >= ?
       UNION ALL SELECT client_id FROM appointments WHERE status IN ('scheduled', 'confirmed') AND date >= ?
     ) GROUP BY client_id`,
  ).all(today, today) as { id: number; n: number }[]).map((r) => [r.id, r.n]));
  const activeMembership = new Set((sq.prepare("SELECT DISTINCT client_id AS id FROM client_memberships WHERE status = 'active'").all() as { id: number }[]).map((r) => r.id));
  const activePackage = new Set((sq.prepare(
    `SELECT client_id AS id FROM client_packages WHERE status = 'active' AND activated = 1 AND (unlimited_sessions = 1 OR sessions_used < sessions_total) AND (end_date IS NULL OR end_date >= ?)
     UNION SELECT client_id FROM packages WHERE is_active = 1 AND sessions_used < total_sessions AND expiry_date >= ?`,
  ).all(today, today) as { id: number }[]).map((r) => r.id));

  const spend = new Map<string, number>();
  const addSpend = (pid: string, eur: number) => spend.set(pid, (spend.get(pid) ?? 0) + eur);
  for (const r of sq.prepare(
    `SELECT client_id AS id, SUM(eur) AS eur FROM (
       SELECT client_id, total_price_eur AS eur FROM appointments WHERE status = 'completed'
       UNION ALL SELECT client_id, price_cents / 100.0 FROM client_packages
       UNION ALL SELECT client_id, price_paid_eur FROM packages
     ) GROUP BY client_id`,
  ).all() as { id: number; eur: number }[]) addSpend(`c:${r.id}`, r.eur);
  for (const o of loadRows(lc, "Order")) {
    if (o.status === "paid" && typeof o.personId === "string") addSpend(o.personId, o.amountEur as number);
  }

  const lastOut = new Map<string, string>();
  const lastAny = new Map<string, string>();
  for (const c of loadRows(lc, "Conversation")) {
    const pid = c.personId as string;
    if (typeof c.lastOutboundAt === "string" && (lastOut.get(pid) ?? "") < c.lastOutboundAt) lastOut.set(pid, c.lastOutboundAt);
    if ((lastAny.get(pid) ?? "") < (c.lastMessageAt as string)) lastAny.set(pid, c.lastMessageAt as string);
  }

  const reviews = new Map<string, number>();
  for (const r of p.index.reviews) {
    for (const pid of [`c:${r.clientId}`, p.index.leadPerson.get(r.leadId) ?? `l:${r.leadId}`]) reviews.set(pid, (reviews.get(pid) ?? 0) + 1);
  }

  const leadsOf = new Map<string, LeadFull[]>();
  for (const l of p.leads) {
    const pid = p.index.leadPerson.get(l.id) ?? `l:${l.id}`;
    const list = leadsOf.get(pid) ?? [];
    list.push(l);
    leadsOf.set(pid, list);
  }
  for (const list of leadsOf.values()) list.sort((x, y) => y.createdAt - x.createdAt);

  const shared = (pid: string, ls: LeadFull[]) => {
    const latest = ls[0];
    const scored = ls.find((l) => l.leadScore !== null);
    return {
      pipelineStage: latest?.stageName ?? null, source: latest?.source ?? null, campaign: latest?.campaign ?? null,
      leadScore: scored?.leadScore ?? null, doNotCall: ls.some((l) => l.doNotCall),
      lifetimeSpendEur: round2(spend.get(pid) ?? 0), lastContactedAt: lastOut.get(pid) ?? null,
      lastMessageAt: lastAny.get(pid) ?? null, possibleMatches: reviews.get(pid) ?? 0,
    };
  };

  const rows: Row[] = [];
  for (const c of p.clients) {
    const pid = `c:${c.id}`;
    const ls = leadsOf.get(pid) ?? [];
    const v = visits.get(c.id);
    const fut = future.get(c.id) ?? 0;
    const lastVisit = v?.last ?? null;
    rows.push({
      id: pid, name: `${c.firstName} ${c.lastName}`.trim(), firstName: c.firstName, email: c.email, phone: c.phone, kind: "client",
      stage: personStage({ kind: "client", activeMembership: activeMembership.has(c.id), activePackage: activePackage.has(c.id), lastVisit, futureBookings: fut, today }),
      createdAt: dublinDate(Math.min(c.createdAt, ...ls.map((l) => l.createdAt))), joinedAt: dublinDate(c.createdAt),
      lastVisit, visits30d: v?.n30 ?? 0, futureBookings: fut, ...shared(pid, ls),
    });
  }
  for (const [pid, ls] of leadsOf) {
    if (!pid.startsWith("l:")) continue;
    const l = ls[0];
    rows.push({
      id: pid, name: leadDisplayName(l), firstName: l.firstName, email: l.email, phone: l.phone, kind: "lead", stage: "lead",
      createdAt: dublinDate(l.createdAt), joinedAt: null, lastVisit: null, visits30d: 0, futureBookings: 0, ...shared(pid, ls),
    });
  }
  return rows;
}

const LOADERS: Record<TypeName, (lc: LoadCtx, a: LoadArgs) => Row[]> = {
  Person: (lc) => loadPersons(lc),
  Booking: loadBookings,
  Class: loadClasses,
  Membership: (lc) => loadMemberships(lc),
  Package: (lc) => loadPackages(lc),
  Order: (lc) => loadOrders(lc),
  Conversation: (lc) => loadConversations(lc),
};
