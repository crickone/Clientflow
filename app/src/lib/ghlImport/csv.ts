/**
 * Reading GoHighLevel's contacts and opportunities exports, and writing the
 * dry-run download. Pure: no DB, no server-only.
 *
 * Columns are found by name, case-insensitive, trimmed, with runs of spaces
 * collapsed ("Days since last stage change " matches), because the columns
 * an export carries vary by account and by what was ticked when exporting.
 * The quoting rules are memberImport's parseCsv (RFC 4180: quoted commas,
 * line breaks and doubled quotes; a byte-order mark; CRLF).
 */
import { parseCsv } from "@/lib/memberImport";

export interface GhlContact {
  contactId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  /** Epoch ms, or null when missing or unreadable. */
  createdAt: number | null;
  tags: string[];
  dnd: boolean;
  source: string;
  treatment: string;
  town: string;
  medicalCondition: string;
  usedBefore: string;
}

export interface GhlOpportunity {
  opportunityId: string;
  contactId: string;
  contactName: string;
  phone: string;
  email: string;
  pipeline: string;
  stage: string;
  source: string;
  assigned: string;
  createdAt: number | null;
  updatedAt: number | null;
  notes: string;
  tags: string[];
  /** Whole days since the last stage change, as of the export date; null when missing. */
  daysInStage: number | null;
}

export type ReadResult<T> = { ok: true; rows: T[] } | { ok: false; error: string };

export function headerKey(h: string): string {
  return (h ?? "").replace(/^\uFEFF/, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function indexOf(headers: string[], ...names: string[]): number {
  const keys = headers.map(headerKey);
  for (const name of names) {
    const i = keys.indexOf(headerKey(name));
    if (i >= 0) return i;
  }
  return -1;
}

function cell(row: string[], i: number): string {
  return i >= 0 ? (row[i] ?? "").trim() : "";
}

/** "a, B,a" -> ["a", "b"]: lowercased, trimmed, no repeats. */
export function parseTagList(raw: string): string[] {
  const out: string[] = [];
  for (const t of (raw ?? "").split(",")) {
    const k = t.trim().replace(/\s+/g, " ").toLowerCase();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** "75 Days", "1 Day", "Today" -> 75, 1, 0. Anything else -> null. */
export function parseDaysInStage(raw: string): number | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "today") return 0;
  const m = /^(\d+)\s*days?$/.exec(s);
  return m ? Number(m[1]) : null;
}

function parseTimestamp(raw: string): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function isTrue(raw: string): boolean {
  return ["true", "yes", "y", "1"].includes((raw ?? "").trim().toLowerCase());
}

function looksLikeOpportunities(headers: string[]): boolean {
  return indexOf(headers, "stage") >= 0 && indexOf(headers, "Opportunity ID") >= 0;
}

export function parseGhlContacts(text: string): ReadResult<GhlContact> {
  const { headers, rows } = parseCsv(text ?? "");
  if (headers.length === 0) return { ok: false, error: "The contacts file is empty." };
  if (looksLikeOpportunities(headers)) {
    return { ok: false, error: "This is the opportunities export. Put it in the opportunities box, and the contacts export here." };
  }
  const id = indexOf(headers, "Contact Id");
  if (id < 0) return { ok: false, error: "This doesn't look like a GoHighLevel contacts export: it has no Contact Id column." };
  const col = {
    first: indexOf(headers, "First Name"),
    last: indexOf(headers, "Last Name"),
    phone: indexOf(headers, "Phone"),
    email: indexOf(headers, "Email"),
    created: indexOf(headers, "Created", "Date Created"),
    tags: indexOf(headers, "Tags"),
    dnd: indexOf(headers, "DND"),
    source: indexOf(headers, "Source"),
    treatment: indexOf(headers, "Treatment interested in"),
    town: indexOf(headers, "Location", "Town", "City"),
    medical: indexOf(headers, "Medical Condition"),
    used: indexOf(headers, "Used treatments before?", "Used treatments before"),
  };
  const out: GhlContact[] = [];
  for (const r of rows) {
    const contactId = cell(r, id);
    if (!contactId) continue;
    out.push({
      contactId,
      firstName: cell(r, col.first),
      lastName: cell(r, col.last),
      phone: cell(r, col.phone),
      email: cell(r, col.email),
      createdAt: parseTimestamp(cell(r, col.created)),
      tags: parseTagList(cell(r, col.tags)),
      dnd: isTrue(cell(r, col.dnd)),
      source: cell(r, col.source),
      treatment: cell(r, col.treatment),
      town: cell(r, col.town),
      medicalCondition: cell(r, col.medical),
      usedBefore: cell(r, col.used),
    });
  }
  return { ok: true, rows: out };
}

export function parseGhlOpportunities(text: string): ReadResult<GhlOpportunity> {
  const { headers, rows } = parseCsv(text ?? "");
  if (headers.length === 0) return { ok: false, error: "The opportunities file is empty." };
  const stage = indexOf(headers, "stage");
  if (stage < 0) return { ok: false, error: "This doesn't look like a GoHighLevel opportunities export: it has no stage column." };
  const contact = indexOf(headers, "Contact ID");
  if (contact < 0) return { ok: false, error: "This opportunities export has no Contact ID column, so it can't be matched to the contacts." };
  const col = {
    id: indexOf(headers, "Opportunity ID"),
    name: indexOf(headers, "Contact Name", "Opportunity name"),
    phone: indexOf(headers, "phone"),
    email: indexOf(headers, "email"),
    pipeline: indexOf(headers, "pipeline"),
    source: indexOf(headers, "source"),
    assigned: indexOf(headers, "assigned"),
    created: indexOf(headers, "Created on"),
    updated: indexOf(headers, "Updated on"),
    notes: indexOf(headers, "Notes"),
    tags: indexOf(headers, "tags"),
    days: indexOf(headers, "Days since last stage change"),
  };
  const out: GhlOpportunity[] = [];
  for (const r of rows) {
    const contactId = cell(r, contact);
    if (!contactId) continue;
    out.push({
      opportunityId: cell(r, col.id),
      contactId,
      contactName: cell(r, col.name),
      phone: cell(r, col.phone),
      email: cell(r, col.email),
      pipeline: cell(r, col.pipeline),
      stage: cell(r, stage),
      source: cell(r, col.source),
      assigned: cell(r, col.assigned),
      createdAt: parseTimestamp(cell(r, col.created)),
      updatedAt: parseTimestamp(cell(r, col.updated)),
      notes: cell(r, col.notes),
      tags: parseTagList(cell(r, col.tags)),
      daysInStage: parseDaysInStage(cell(r, col.days)),
    });
  }
  return { ok: true, rows: out };
}

const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const PHONE_SHAPED = /^\+?[\d\s()-]{6,}$/;

/** A cell a spreadsheet would run as a formula. A + or - start is safe only on a plain number or a phone number. */
function runsAsFormula(s: string): boolean {
  if (/^[=@\t\r]/.test(s)) return true;
  if (!/^[+-]/.test(s)) return false;
  if (PLAIN_NUMBER.test(s)) return false;
  return !(PHONE_SHAPED.test(s) && (s.match(/\d/g)?.length ?? 0) >= 6);
}

/**
 * Rows to CSV text: quoted where needed, quotes doubled, CRLF line ends. A
 * cell that a spreadsheet would run as a formula (=, @, tab, CR, or + / -
 * unless the cell is a plain number or a phone number) gets a leading
 * apostrophe.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined): string => {
    let s = v == null ? "" : String(v);
    if (runsAsFormula(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
