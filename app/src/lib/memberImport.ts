/**
 * Migration concierge — pure CSV helpers for the member-import wizard.
 *
 * Deliberately dependency-free and framework-free (NO `server-only`, no db, no
 * next imports) so it runs identically in the browser (instant wizard preview)
 * and in the server import action (source of truth), and is unit-testable under
 * the plain tsx runner. Everything here is a pure function.
 */

// ── field model ───────────────────────────────────────────────────────────────

/** The ClientFlow fields a CSV column can be mapped onto. */
export type MemberField =
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "joinDate"
  | "membershipPlan"
  | "notes";

export const MEMBER_FIELDS: MemberField[] = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "joinDate",
  "membershipPlan",
  "notes",
];

export const FIELD_LABELS: Record<MemberField, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  joinDate: "Join date",
  membershipPlan: "Membership plan",
  notes: "Notes",
};

/** A single CSV row projected onto the ClientFlow field model. */
export interface MappedRow {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  joinDate: string;
  membershipPlan: string;
  notes: string;
}

export type ColumnMapping = Partial<Record<MemberField, number>>;

// ── CSV parsing (RFC-4180-ish, delimiter-sniffing) ────────────────────────────

/** Pick the most likely delimiter by counting occurrences on the header line. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestN = -1;
  for (const d of candidates) {
    // Count delimiters that aren't inside the first pair of quotes (best-effort).
    const n = firstLine.split(d).length - 1;
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

/** Split delimited text into records, honouring quoted fields (commas, newlines,
 *  escaped `""`). Returns raw records including the header record. */
function parseRecords(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush the trailing field/record.
  row.push(field);
  rows.push(row);
  return rows;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

/**
 * Parse a CSV/TSV/semicolon file into `{ headers, rows }`. Sniffs the delimiter,
 * strips a UTF-8 BOM, and drops fully-blank records (e.g. a trailing newline).
 */
export function parseCsv(text: string): ParsedCsv {
  const clean = (text ?? "").replace(/^﻿/, "");
  const delimiter = detectDelimiter(clean);
  const records = parseRecords(clean, delimiter).filter((r) =>
    r.some((c) => c.trim() !== ""),
  );
  if (records.length === 0) return { headers: [], rows: [], delimiter };
  const [header, ...rows] = records;
  return { headers: header.map((h) => h.trim()), rows, delimiter };
}

// ── mapping auto-suggestion (competitor header names) ─────────────────────────

const norm = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Header synonyms for common gym-software exports (Mindbody, Glofox, LegitFit,
 * TeamUp). Matched normalized (lowercased, alphanumerics only), so "Mobile
 * Phone" and "mobile_phone" both collapse to "mobilephone".
 */
const SYNONYMS: Record<MemberField, string[]> = {
  firstName: [
    "first name",
    "firstname",
    "first",
    "given name",
    "givenname",
    "fname",
    "member first name",
    "client first name",
    "forename",
  ],
  lastName: [
    "last name",
    "lastname",
    "last",
    "surname",
    "family name",
    "familyname",
    "lname",
    "member last name",
    "client last name",
  ],
  email: [
    "email",
    "email address",
    "emailaddress",
    "e-mail",
    "member email",
    "client email",
    "primary email",
    "contact email",
  ],
  phone: [
    "phone",
    "phone number",
    "mobile",
    "mobile phone",
    "mobile number",
    "mobilephone",
    "cell",
    "cell phone",
    "telephone",
    "tel",
    "contact number",
    "contact phone",
  ],
  joinDate: [
    "join date",
    "joined",
    "date joined",
    "member since",
    "start date",
    "startdate",
    "signup date",
    "sign up date",
    "registration date",
    "registered",
    "created",
    "created date",
    "date added",
    "membership start",
  ],
  membershipPlan: [
    "membership",
    "membership plan",
    "membership type",
    "membership name",
    "plan",
    "plan name",
    "package",
    "product",
    "pricing option",
    "subscription",
    "tier",
  ],
  notes: ["notes", "note", "comments", "comment", "remarks", "memo"],
};

/**
 * Best-effort auto-map of CSV columns onto ClientFlow fields. Each column and
 * each field is used at most once. Two passes: exact normalized match first,
 * then a `contains` fallback (e.g. "MemberEmailAddress" → email).
 */
export function suggestMapping(headers: string[]): ColumnMapping {
  const normHeaders = headers.map(norm);
  const mapping: ColumnMapping = {};
  const usedCols = new Set<number>();

  const claim = (field: MemberField, col: number) => {
    mapping[field] = col;
    usedCols.add(col);
  };

  // Pass 1 — exact normalized equality.
  for (const field of MEMBER_FIELDS) {
    const syns = SYNONYMS[field].map(norm);
    for (let i = 0; i < normHeaders.length; i++) {
      if (usedCols.has(i)) continue;
      if (normHeaders[i] && syns.includes(normHeaders[i])) {
        claim(field, i);
        break;
      }
    }
  }

  // Pass 2 — header contains a synonym (longest synonyms first to avoid a short
  // token like "tel" grabbing a header meant for something more specific).
  for (const field of MEMBER_FIELDS) {
    if (mapping[field] !== undefined) continue;
    const syns = SYNONYMS[field]
      .map(norm)
      .filter((s) => s.length >= 3)
      .sort((a, b) => b.length - a.length);
    for (let i = 0; i < normHeaders.length; i++) {
      if (usedCols.has(i)) continue;
      const h = normHeaders[i];
      if (h && syns.some((s) => h.includes(s))) {
        claim(field, i);
        break;
      }
    }
  }

  return mapping;
}

// ── row projection + validation ───────────────────────────────────────────────

/** Project a raw CSV row onto the field model using a column mapping. */
export function mapRow(row: string[], mapping: ColumnMapping): MappedRow {
  const at = (field: MemberField) => {
    const i = mapping[field];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  return {
    firstName: at("firstName"),
    lastName: at("lastName"),
    email: at("email"),
    phone: at("phone"),
    joinDate: at("joinDate"),
    membershipPlan: at("membershipPlan"),
    notes: at("notes"),
  };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface RowValidation {
  /** True when the row can be imported (no blocking errors). */
  ok: boolean;
  /** Blocking problems (row would be skipped). */
  errors: string[];
  /** Non-blocking flags (row imports, but worth surfacing in the preview). */
  warnings: string[];
}

/**
 * Validate a mapped row. Blocking: no name at all, or a present-but-malformed
 * email (would create junk). Non-blocking warnings: missing email, missing
 * phone, unparseable join date.
 */
export function validateRow(m: MappedRow): RowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!m.firstName && !m.lastName) errors.push("Missing name");
  if (m.email && !EMAIL_RE.test(m.email)) errors.push("Invalid email address");

  if (!m.email) warnings.push("No email");
  if (!m.phone) warnings.push("No phone");
  if (m.joinDate && normalizeDate(m.joinDate) === null) warnings.push("Unrecognised join date");

  return { ok: errors.length === 0, errors, warnings };
}

// ── dedupe keys ───────────────────────────────────────────────────────────────

/** Digits only — so "+353 (85) 123-4567" and "0851234567" compare fairly. */
export function normalizePhone(phone: string): string {
  return (phone ?? "").replace(/\D/g, "");
}

export function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Normalized dedupe key for a row. Email is case-insensitive; phone is reduced
 * to digits. Either may be null when absent. Dedupe policy (see the import
 * action) is "match on email, then phone".
 */
export function dedupeKey(m: { email?: string | null; phone?: string | null }): {
  email: string | null;
  phone: string | null;
} {
  const email = normalizeEmail(m.email ?? "") || null;
  const phone = normalizePhone(m.phone ?? "") || null;
  return { email, phone };
}

// ── date normalization ────────────────────────────────────────────────────────

function isoOrNull(y: number, mo: number, d: number): string | null {
  if (!Number.isFinite(y) || y < 1900 || y > 2200) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/**
 * Best-effort parse of the many date shapes competitor exports emit into
 * `YYYY-MM-DD`, or null when it can't be understood. Ambiguous numeric dates
 * (e.g. 05/06/2024) default to DD/MM/YYYY (UK/IE convention — this is an Irish
 * product), unless a component > 12 forces the interpretation.
 */
export function normalizeDate(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  // ISO / YYYY-MM-DD (optionally with a time component).
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return isoOrNull(+m[1], +m[2], +m[3]);

  // D/M/Y, M/D/Y, D-M-Y, D.M.Y (2- or 4-digit year).
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    let y = +m[3];
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    let day: number;
    let month: number;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else {
      day = a; // ambiguous → DD/MM
      month = b;
    }
    return isoOrNull(y, month, day);
  }

  // Textual months, e.g. "5 Jan 2024" / "January 5, 2024".
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return isoOrNull(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}
