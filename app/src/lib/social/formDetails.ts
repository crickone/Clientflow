/**
 * Contact details a lead typed into a Facebook "click to Messenger" form, read
 * from the first message Meta sends on their behalf:
 *
 *   Full name: marinahewitt
 *   Phone number: 089 401 8010
 *   Email: marinaghewitt@gmail.com
 *
 * Pure: no DB, so it runs under the plain test runner. Only "Label: value"
 * lines count; anything else in the message is ignored.
 */

export interface FormDetails {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "marina hewitt" -> "Marina Hewitt"; leaves mixed case ("McCarthy") alone. */
function tidyName(s: string): string {
  return s
    .split(" ")
    .map((w) => (w === w.toLowerCase() || w === w.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

export function parseFormDetails(text: string): FormDetails {
  const out: FormDetails = { firstName: null, lastName: null, email: null, phone: null };
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*([^:]{2,40}):\s*(.+?)\s*$/);
    if (!m) continue;
    const label = m[1].toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
    const value = m[2].replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (/\be ?mail\b/.test(label)) {
      if (!out.email && EMAIL.test(value)) out.email = value.toLowerCase();
    } else if (/\b(phone|mobile|telephone|contact number)\b/.test(label)) {
      const digits = value.replace(/[^\d+]/g, "");
      if (!out.phone && digits.replace(/\D/g, "").length >= 7) out.phone = value;
    } else if (/\bfirst name\b/.test(label)) {
      if (!out.firstName) out.firstName = tidyName(value);
    } else if (/\b(last name|surname|second name)\b/.test(label)) {
      if (!out.lastName) out.lastName = tidyName(value);
    } else if (/^(full name|name|your name)$/.test(label)) {
      if (!out.firstName) {
        const clean = tidyName(value);
        const sp = clean.indexOf(" ");
        out.firstName = sp === -1 ? clean : clean.slice(0, sp);
        if (sp !== -1 && !out.lastName) out.lastName = clean.slice(sp + 1);
      }
    }
  }
  return out;
}

export function hasFormDetails(d: FormDetails): boolean {
  return !!(d.firstName || d.lastName || d.email || d.phone);
}
