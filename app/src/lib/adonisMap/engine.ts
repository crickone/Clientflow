// app/src/lib/adonisMap/engine.ts
/**
 * The pure part of the business map: validating the model's conditions,
 * matching rows, sorting, grouping, and Irish calendar dates. No I/O.
 */
import { TYPE_DEFS } from "./schema";
import {
  MapError, isLinkCondition,
  type Condition, type DateBucket, type DateRange, type FieldCondition, type FieldDef, type LinkDef, type Op, type Row,
  type TypeDef, type TypeName,
} from "./types";

const OPS_BY_TYPE: Record<FieldDef["type"], readonly Op[]> = {
  text: ["eq", "ne", "in", "contains", "isNull"],
  number: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "in", "isNull"],
  date: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "isNull"],
  datetime: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "isNull"],
  bool: ["eq", "ne", "isNull"],
  enum: ["eq", "ne", "in", "isNull"],
};
const MAX_IN = 100;
const MAX_CONDITIONS = 12;
export const MAX_GROUPS = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;

// ── lookups ──

export function typeDef(name: unknown, available: readonly TypeName[]): TypeDef {
  if (typeof name !== "string" || !available.includes(name as TypeName)) {
    throw new MapError(`Unknown type "${String(name)}". Types: ${available.join(", ")}.`);
  }
  return TYPE_DEFS[name as TypeName];
}

export function fieldDef(def: TypeDef, name: unknown): FieldDef {
  const f = typeof name === "string" ? def.fields.find((x) => x.name === name) : undefined;
  if (!f) throw new MapError(`Unknown field "${String(name)}" on ${def.name}. Fields: ${def.fields.map((x) => x.name).join(", ")}.`);
  return f;
}

export function linkDef(def: TypeDef, name: unknown, available: readonly TypeName[]): LinkDef {
  const usable = def.links.filter((x) => available.includes(x.target));
  const l = typeof name === "string" ? usable.find((x) => x.name === name) : undefined;
  if (!l) throw new MapError(`Unknown link "${String(name)}" on ${def.name}. Links: ${usable.map((x) => x.name).join(", ") || "none"}.`);
  return l;
}

// ── validation ──

function checkScalar(where: string, f: FieldDef, v: unknown): void {
  switch (f.type) {
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) throw new MapError(`${where} takes a number.`);
      return;
    case "date":
    case "datetime":
      if (typeof v !== "string" || !DATE_RE.test(v)) throw new MapError(`${where} takes a date like 2026-11-21.`);
      return;
    case "bool":
      if (typeof v !== "boolean") throw new MapError(`${where} takes true or false.`);
      return;
    case "enum":
      if (typeof v !== "string" || !(f.values ?? []).includes(v)) throw new MapError(`${where} takes one of: ${(f.values ?? []).join(", ")}.`);
      return;
    case "text":
      if (typeof v !== "string") throw new MapError(`${where} takes text.`);
      return;
  }
}

function checkValue(def: TypeDef, f: FieldDef, op: Op, value: unknown): void {
  const where = `${def.name}.${f.name} ${op}`;
  if (op === "isNull") {
    if (value !== undefined && typeof value !== "boolean") throw new MapError(`${where} takes true or false.`);
    return;
  }
  if (op === "in") {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IN) throw new MapError(`${where} takes a list of 1 to ${MAX_IN} values.`);
    value.forEach((v) => checkScalar(where, f, v));
    return;
  }
  if (op === "between") {
    if (!Array.isArray(value) || value.length !== 2) throw new MapError(`${where} takes [from, to].`);
    value.forEach((v) => checkScalar(where, f, v));
    return;
  }
  if (op === "contains") {
    if (typeof value !== "string") throw new MapError(`${where} takes text.`);
    return;
  }
  checkScalar(where, f, value);
}

/** Checks the model's conditions against the map. Throws MapError on the first one that doesn't fit. */
export function validateWhere(def: TypeDef, where: unknown, available: readonly TypeName[], depth = 0): Condition[] {
  if (where === undefined || where === null) return [];
  if (!Array.isArray(where)) throw new MapError("where must be a list of conditions.");
  if (where.length > MAX_CONDITIONS) throw new MapError(`Use at most ${MAX_CONDITIONS} conditions.`);
  return where.map((c: unknown): Condition => {
    if (!c || typeof c !== "object") throw new MapError("Each condition is an object.");
    const cond = c as Record<string, unknown>;
    if (typeof cond.link === "string") {
      if (depth > 0) throw new MapError("A link condition can't contain another link condition.");
      const l = linkDef(def, cond.link, available);
      if (typeof cond.exists !== "boolean") throw new MapError(`The link condition on "${l.name}" needs exists: true or false.`);
      const inner = validateWhere(TYPE_DEFS[l.target], cond.where, available, 1) as FieldCondition[];
      return { link: l.name, exists: cond.exists, where: inner };
    }
    const f = fieldDef(def, cond.field);
    const op = cond.op as Op;
    if (!OPS_BY_TYPE[f.type].includes(op)) {
      throw new MapError(`${def.name}.${f.name} (${f.type}) takes ops: ${OPS_BY_TYPE[f.type].join(", ")}.`);
    }
    checkValue(def, f, op, cond.value);
    return { field: f.name, op, value: cond.value };
  });
}

// ── matching ──

function lower(f: FieldDef, v: unknown): unknown {
  return f.type === "text" && typeof v === "string" ? v.toLowerCase() : v;
}

/** The row's value as compared with `against`: text ignores case; a date-only value compares a datetime by its day. */
function comparable(f: FieldDef, raw: unknown, against: unknown): unknown {
  if (f.type === "datetime" && typeof raw === "string" && typeof against === "string" && against.length === 10) return raw.slice(0, 10);
  return lower(f, raw);
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function matchField(def: TypeDef, row: Row, c: FieldCondition): boolean {
  const f = fieldDef(def, c.field);
  const raw = row[f.name];
  if (c.op === "isNull") return (raw === null || raw === undefined) === (c.value !== false);
  if (raw === null || raw === undefined) return c.op === "ne";
  const one = (x: unknown) => cmp(comparable(f, raw, x), lower(f, x));
  switch (c.op) {
    case "eq": return one(c.value) === 0;
    case "ne": return one(c.value) !== 0;
    case "gt": return one(c.value) > 0;
    case "gte": return one(c.value) >= 0;
    case "lt": return one(c.value) < 0;
    case "lte": return one(c.value) <= 0;
    case "in": return (c.value as unknown[]).some((x) => one(x) === 0);
    case "between": {
      const [a, b] = c.value as unknown[];
      return one(a) >= 0 && one(b) <= 0;
    }
    case "contains": return String(raw).toLowerCase().includes(String(c.value).toLowerCase());
  }
}

export function filterRows(def: TypeDef, rows: Row[], where: FieldCondition[]): Row[] {
  return where.length ? rows.filter((r) => where.every((c) => matchField(def, r, c))) : rows;
}

/** Sorts by one field; nulls go last in both directions. */
export function sortRows(def: TypeDef, rows: Row[], sort: unknown): Row[] {
  if (sort === undefined || sort === null) return rows;
  const s = sort as { field?: unknown; dir?: unknown };
  const f = fieldDef(def, s.field);
  const dir = s.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[f.name];
    const y = b[f.name];
    if ((x === null || x === undefined) && (y === null || y === undefined)) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return dir * cmp(lower(f, x), lower(f, y));
  });
}

export function pick(def: TypeDef, row: Row, fields: unknown): Row {
  if (fields === undefined || fields === null) return row;
  if (!Array.isArray(fields)) throw new MapError("fields must be a list of field names.");
  const out: Row = { id: row.id };
  for (const n of fields) {
    const f = fieldDef(def, n);
    out[f.name] = row[f.name];
  }
  return out;
}

export function clampLimit(v: unknown, dflt: number, max: number): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? Math.min(v, max) : dflt;
}

/** The date range the conditions pin the type's date field to, for the SQL load. Inclusive; the filter still runs afterwards. */
export function datePushdown(def: TypeDef, where: Condition[]): DateRange {
  const out: DateRange = {};
  if (!def.dateField) return out;
  const later = (a: string | undefined, b: string) => (a && a > b ? a : b);
  const earlier = (a: string | undefined, b: string) => (a && a < b ? a : b);
  for (const c of where) {
    if (isLinkCondition(c) || c.field !== def.dateField) continue;
    const v = c.value;
    if (c.op === "eq" && typeof v === "string") {
      out.from = later(out.from, v.slice(0, 10));
      out.to = earlier(out.to, v.slice(0, 10));
    }
    if ((c.op === "gte" || c.op === "gt") && typeof v === "string") out.from = later(out.from, v.slice(0, 10));
    if ((c.op === "lte" || c.op === "lt") && typeof v === "string") out.to = earlier(out.to, v.slice(0, 10));
    if (c.op === "between" && Array.isArray(v)) {
      out.from = later(out.from, String(v[0]).slice(0, 10));
      out.to = earlier(out.to, String(v[1]).slice(0, 10));
    }
  }
  return out;
}

// ── dates: pure UTC arithmetic on Irish calendar dates ──

const DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" });
const TIME_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function dublinDate(ms: number): string {
  return DATE_FMT.format(ms);
}

export function dublinDateTime(ms: number): string {
  return `${DATE_FMT.format(ms)} ${TIME_FMT.format(ms)}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the date's week. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function weekdayName(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function bucketKey(value: string, by: DateBucket): string {
  switch (by) {
    case "day": return value.slice(0, 10);
    case "week": return weekStart(value.slice(0, 10));
    case "month": return value.slice(0, 7);
    case "weekday": return weekdayName(value.slice(0, 10));
    case "hour": return value.length >= 13 ? value.slice(11, 13) : "none";
  }
}

// ── grouping ──

export interface Group { key: string; count: number; sum?: number }
const round2 = (n: number) => Math.round(n * 100) / 100;

export function groupRows(def: TypeDef, rows: Row[], groupBy: unknown, sum: unknown): { total: number; sum?: number; groups: Group[] } {
  const sumField = sum === undefined || sum === null ? null : fieldDef(def, sum);
  if (sumField && sumField.type !== "number") throw new MapError(`sum takes a number field; ${def.name}.${sumField.name} is ${sumField.type}.`);
  const valueOf = (r: Row) => (sumField && typeof r[sumField.name] === "number" ? (r[sumField.name] as number) : 0);
  const head = sumField ? { total: rows.length, sum: round2(rows.reduce((a, r) => a + valueOf(r), 0)) } : { total: rows.length };
  if (groupBy === undefined || groupBy === null) return { ...head, groups: [] };

  let keyOf: (r: Row) => string;
  let byKey = false;
  if (typeof groupBy === "string") {
    const f = fieldDef(def, groupBy);
    keyOf = (r) => (r[f.name] === null || r[f.name] === undefined ? "none" : String(r[f.name]));
    byKey = f.type === "date" || f.type === "datetime";
  } else {
    const g = (groupBy ?? {}) as { field?: unknown; by?: unknown };
    const f = fieldDef(def, g.field);
    const by = g.by as DateBucket;
    if (!["day", "week", "month", "weekday", "hour"].includes(by)) throw new MapError("by takes day, week, month, weekday or hour.");
    if (f.type !== "date" && f.type !== "datetime") throw new MapError(`Grouping by ${by} needs a date field; ${def.name}.${f.name} is ${f.type}.`);
    if (by === "hour" && f.type !== "datetime") throw new MapError(`Grouping by hour needs a datetime field; ${def.name}.${f.name} is a date.`);
    keyOf = (r) => (typeof r[f.name] === "string" ? bucketKey(r[f.name] as string, by) : "none");
    byKey = by !== "weekday";
  }

  const m = new Map<string, Group>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = m.get(k) ?? (sumField ? { key: k, count: 0, sum: 0 } : { key: k, count: 0 });
    g.count++;
    if (sumField) g.sum = round2((g.sum ?? 0) + valueOf(r));
    m.set(k, g);
  }
  const groups = [...m.values()].sort(
    byKey
      ? (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      : (a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  if (groups.length > MAX_GROUPS) {
    throw new MapError(`That makes ${groups.length} groups; the most is ${MAX_GROUPS}. Group by something coarser or add a filter.`);
  }
  return { ...head, groups };
}
