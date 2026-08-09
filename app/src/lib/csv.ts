/**
 * CSV field-escaping for CSV-generating routes (currently api/export). Pure,
 * no react/next imports — split out so it's directly testable under the
 * plain-tsx test runner (same reasoning as @/lib/password being split out of
 * @/lib/auth: importing a module that pulls in next/headers crashes it).
 */

// Formula-injection guard (improvement-plan-2026-08.md Theme B5): a field
// beginning with =, +, -, @, tab, or CR is interpreted as a formula (or a
// DDE/macro trigger) by Excel/Sheets/LibreOffice when the CSV is opened.
// Client names/emails/phones in these exports originate from public
// lead-capture input, so a value like `=cmd|'/c calc'!A1` must not reach the
// file un-neutralized. Only applied to strings: a `number` field here is
// always our own computed value (price/total), never attacker text, and the
// only one of these lead characters it could stringify to is `-` (a negative
// amount) — quote-prefixing that would needlessly turn a legitimate numeric
// export into text, so numbers are left exactly as before.
const RISKY_LEADING_CHAR = /^[=+\-@\t\r]/;

export function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && RISKY_LEADING_CHAR.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
