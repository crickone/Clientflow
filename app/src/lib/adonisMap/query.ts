// app/src/lib/adonisMap/query.ts
import "server-only";

/** The four map operations behind Adonis's read tools. Each throws MapError for a query that doesn't fit. */
import { mapModules } from "./access";
import {
  clampLimit, datePushdown, filterRows, groupRows, linkDef, pick, sortRows, typeDef, validateWhere,
} from "./engine";
import { conversationMessages, loadRows, makeLoadCtx, people, type LoadArgs, type LoadCtx } from "./load";
import { TYPE_DEFS } from "./schema";
import { MapError, isLinkCondition, type Condition, type FieldCondition, type LinkDef, type Row, type TypeDef } from "./types";

export interface MapEnv { tenantId: number; nowMs?: number }

function ctxFor(env: MapEnv): LoadCtx {
  return makeLoadCtx(env.tenantId, mapModules(env.tenantId), env.nowMs ?? Date.now());
}

const ints = (vals: string[], prefix: string) =>
  vals.filter((v) => v.startsWith(prefix)).map((v) => Number(v.slice(prefix.length))).filter((n) => Number.isInteger(n));

function rowsByIds(lc: LoadCtx, def: TypeDef, ids: string[]): Row[] {
  if (def.name === "Booking") return loadRows(lc, "Booking", { bookingIds: ints(ids, "s:"), appointmentIds: ints(ids, "a:") });
  if (def.name === "Class") return loadRows(lc, "Class", { sessionIds: ints(ids, "k:") });
  const want = new Set(ids);
  return loadRows(lc, def.name).filter((r) => want.has(r.id));
}

function sortNewest(def: TypeDef, rows: Row[]): Row[] {
  const f = def.dateField ?? def.fields.find((x) => x.type === "datetime" || x.type === "date")?.name;
  if (!f) return rows;
  return [...rows].sort((a, b) => String(b[f] ?? "").localeCompare(String(a[f] ?? "")));
}

/** Linked rows per source id, newest first. Bookings and classes load only for the sources asked about. */
function linkedRows(lc: LoadCtx, link: LinkDef, sources: Row[], where: FieldCondition[]): Map<string, Row[]> {
  const tdef = TYPE_DEFS[link.target];
  const args: LoadArgs = { range: datePushdown(tdef, where) };
  const vals = sources.map((s) => s[link.from]).filter((v): v is string => typeof v === "string");
  if (link.target === "Booking" && link.to === "personId") args.clientIds = ints(vals, "c:");
  if (link.target === "Booking" && link.to === "classId") args.sessionIds = ints(vals, "k:");
  if (link.target === "Class") args.sessionIds = ints(vals, "k:");
  const targets = filterRows(tdef, loadRows(lc, link.target, args), where);
  const byKey = new Map<string, Row[]>();
  for (const t of targets) {
    const k = String(t[link.to]);
    const list = byKey.get(k) ?? [];
    list.push(t);
    byKey.set(k, list);
  }
  const out = new Map<string, Row[]>();
  for (const s of sources) out.set(s.id, sortNewest(tdef, byKey.get(String(s[link.from])) ?? []));
  return out;
}

/** Rows of one type matching every condition. Link conditions load their targets by date range only. */
function select(lc: LoadCtx, def: TypeDef, where: Condition[]): Row[] {
  let rows = loadRows(lc, def.name, { range: datePushdown(def, where) });
  rows = filterRows(def, rows, where.filter((c): c is FieldCondition => !isLinkCondition(c)));
  for (const c of where) {
    if (!isLinkCondition(c)) continue;
    const link = linkDef(def, c.link, lc.available);
    const tdef = TYPE_DEFS[link.target];
    const inner = c.where ?? [];
    const targets = filterRows(tdef, loadRows(lc, link.target, { range: datePushdown(tdef, inner) }), inner);
    const keys = new Set(targets.map((t) => String(t[link.to])));
    rows = rows.filter((r) => keys.has(String(r[link.from])) === c.exists);
  }
  return rows;
}

export function mapFind(env: MapEnv, input: Record<string, unknown>) {
  const lc = ctxFor(env);
  const def = typeDef(input.type, lc.available);
  const where = validateWhere(def, input.where, lc.available);
  const rows = sortRows(def, select(lc, def, where), input.sort);
  const limit = clampLimit(input.limit, 20, 50);
  const shown = rows.slice(0, limit).map((r) => pick(def, r, input.fields));
  return {
    type: def.name,
    total: rows.length,
    rows: shown,
    ...(rows.length > shown.length ? { note: `Showing ${shown.length} of ${rows.length}. Use map_count for totals, or narrow the filter.` } : {}),
  };
}

export function mapGet(env: MapEnv, input: Record<string, unknown>) {
  const lc = ctxFor(env);
  const def = typeDef(input.type, lc.available);
  if (typeof input.id !== "string") throw new MapError("id is a text id like c:12.");
  const [row] = rowsByIds(lc, def, [input.id]);
  if (!row) throw new MapError(`No ${def.name} with id ${input.id}.`);
  const include = input.include === undefined
    ? def.links.filter((l) => lc.available.includes(l.target)).map((l) => l.name)
    : input.include;
  if (!Array.isArray(include)) throw new MapError("include must be a list of link names.");
  const links: Record<string, { total: number; rows: Row[] }> = {};
  for (const name of include) {
    const l = linkDef(def, name, lc.available);
    const got = linkedRows(lc, l, [row], []).get(row.id) ?? [];
    links[l.name] = { total: got.length, rows: got.slice(0, 20) };
  }
  const extra: Record<string, unknown> = {};
  if (def.name === "Person") {
    const p = people(lc);
    const clientId = row.id.startsWith("c:") ? Number(row.id.slice(2)) : null;
    extra.records = { clientId, leadIds: clientId !== null ? p.index.clientLeads.get(clientId) ?? [] : [Number(row.id.slice(2))] };
  }
  if (def.name === "Conversation") extra.messages = conversationMessages(lc, row.id);
  return { type: def.name, object: { ...row, ...extra }, links };
}

export function mapFollow(env: MapEnv, input: Record<string, unknown>) {
  const lc = ctxFor(env);
  const def = typeDef(input.type, lc.available);
  const ids = input.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50 || !ids.every((i) => typeof i === "string")) {
    throw new MapError("ids takes 1 to 50 text ids.");
  }
  const l = linkDef(def, input.link, lc.available);
  const where = validateWhere(TYPE_DEFS[l.target], input.where, lc.available, 1) as FieldCondition[];
  const limit = clampLimit(input.limit, 20, 50);
  const sources = rowsByIds(lc, def, ids as string[]);
  const got = linkedRows(lc, l, sources, where);
  return {
    type: def.name,
    link: l.name,
    target: l.target,
    results: (ids as string[]).map((id) => {
      const list = got.get(id);
      return list ? { id, total: list.length, rows: list.slice(0, limit) } : { id, missing: true as const };
    }),
  };
}

export function mapCount(env: MapEnv, input: Record<string, unknown>) {
  const lc = ctxFor(env);
  const def = typeDef(input.type, lc.available);
  const where = validateWhere(def, input.where, lc.available);
  return { type: def.name, ...groupRows(def, select(lc, def, where), input.groupBy, input.sum) };
}
