/**
 * Email marketing — pure CSV helpers for the contacts-import wizard. Mirrors
 * `lib/memberImport.ts`'s shape (parseCsv/suggestMapping/mapRow/validateRow/
 * normalizeEmail/dedupeKey) for the narrower contacts field model.
 *
 * Deliberately dependency-free and framework-free (NO `server-only`, no db, no
 * next imports) so it runs identically in the browser (instant wizard preview)
 * and in the server import action (source of truth), and is unit-testable
 * under the plain tsx runner. Everything here is a pure function.
 */

// ── field model ───────────────────────────────────────────────────────────────

/** The contact fields a CSV column can be mapped onto. Email is the only
 *  required field — a contacts row with no email can't be emailed. */
export type ContactField = "email" | "name" | "phone" | "tags";

export const CONTACT_FIELDS: ContactField[] = ["email", "name", "phone", "tags"];

export const CONTACT_FIELD_LABELS: Record<ContactField, string> = {
  email: "Email",
  name: "Name",
  phone: "Phone",
  tags: "Tags",
};

/** A single CSV row projected onto the contact field model. `tags` is the
 *  RAW cell text (e.g. "vip, lead") — see `parseTags` to split it. */
export interface MappedContactRow {
  email: string;
  name: string;
  phone: string;
  tags: string;
}

export type ContactColumnMapping = Partial<Record<ContactField, number>>;

// ── CSV parsing (RFC-4180-ish, delimiter-sniffing) ────────────────────────────
// Identical engine to lib/memberImport.ts — duplicated rather than shared so
// this module stays a fully standalone, dependency-free file (see file header).

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
 * Header synonyms for common CRM/ESP exports (Mailchimp, GoHighLevel, HubSpot,
 * plus the CSV shapes memberImport.ts already recognises). Matched normalized
 * (lowercased, alphanumerics only). `name` deliberately does NOT include
 * "first name"/"firstname" — this field model has no separate last-name slot,
 * so auto-mapping a first-name-only column would silently drop the surname;
 * better to make the operator map that column explicitly. (The bare "name"
 * token below is still needed for pass 1 — an exact "Name" header — but is
 * excluded from pass 2's contains-fallback in suggestMapping, since as a
 * substring match it would otherwise also catch "First Name"/"Last Name".)
 */
const SYNONYMS: Record<ContactField, string[]> = {
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
  name: [
    "name",
    "full name",
    "fullname",
    "contact name",
    "customer name",
    "lead name",
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
  tags: [
    "tags",
    "tag",
    "labels",
    "label",
    "segment",
    "segments",
    "lists",
    "list",
    "category",
    "categories",
  ],
};

/**
 * Best-effort auto-map of CSV columns onto contact fields. Each column and
 * each field is used at most once. Two passes: exact normalized match first,
 * then a `contains` fallback (e.g. "ContactEmailAddress" → email).
 */
export function suggestMapping(headers: string[]): ContactColumnMapping {
  const normHeaders = headers.map(norm);
  const mapping: ContactColumnMapping = {};
  const usedCols = new Set<number>();

  const claim = (field: ContactField, col: number) => {
    mapping[field] = col;
    usedCols.add(col);
  };

  // Pass 1 — exact normalized equality.
  for (const field of CONTACT_FIELDS) {
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
  // token like "tag" grabbing a header meant for something more specific).
  // The bare "name" token is excluded from this pass: as a contains-match it
  // would also fire on "First Name"/"Last Name"/"Surname" columns (all
  // contain the substring "name"), silently capturing just one half of a
  // split name into the single `name` field. A bare "Name" header still
  // matches fine via pass 1's exact match above; anything split across
  // separate first/last columns is left for the operator to map by hand.
  for (const field of CONTACT_FIELDS) {
    if (mapping[field] !== undefined) continue;
    const syns = SYNONYMS[field]
      .map(norm)
      .filter((s) => s.length >= 3 && !(field === "name" && s === "name"))
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

/** Project a raw CSV row onto the contact field model using a column mapping. */
export function mapRow(row: string[], mapping: ContactColumnMapping): MappedContactRow {
  const at = (field: ContactField) => {
    const i = mapping[field];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  return {
    email: at("email"),
    name: at("name"),
    phone: at("phone"),
    tags: at("tags"),
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
 * Validate a mapped row. Blocking: no email, or a malformed email (a contact
 * that can't be emailed defeats the point of the list). Non-blocking
 * warnings: missing name, missing phone.
 */
export function validateRow(m: MappedContactRow): RowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!m.email) errors.push("Missing email");
  else if (!EMAIL_RE.test(m.email)) errors.push("Invalid email address");

  if (!m.name) warnings.push("No name");
  if (!m.phone) warnings.push("No phone");

  return { ok: errors.length === 0, errors, warnings };
}

// ── tags ──────────────────────────────────────────────────────────────────────

/**
 * Split a free-text tags cell ("vip, lead; newsletter") into a clean array —
 * comma, semicolon or pipe separated, trimmed, de-duplicated case-insensitively
 * (first-seen casing wins), empties dropped. Used both by the wizard preview
 * and the import action, so a cell always becomes the same tag list either side.
 */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? "").split(/[,;|]+/)) {
    const t = part.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ── dedupe key (email only) ────────────────────────────────────────────────────

export function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Normalized dedupe key for a row — email only (contacts have no secondary
 * identifier like members' phone fallback). Null when absent.
 */
export function dedupeKey(m: { email?: string | null }): string | null {
  return normalizeEmail(m.email ?? "") || null;
}
