/**
 * Default country code for national-format numbers (a single leading trunk '0',
 * e.g. Irish "085…"). Ireland for now (single-tenant); becomes a per-business
 * setting in the tenancy phase.
 */
const DEFAULT_COUNTRY_CODE = "353";

/**
 * Normalize a phone number to E.164 *digits only* (no '+', spaces, or dashes),
 * which the provider expects and which we use to match inbound numbers to a
 * lead/client. Handles '+CC…' / '00CC…' international forms, and national format
 * ('0…') by swapping the trunk '0' for the default country code.
 */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.replace(/[^\d+]/g, ""); // keep digits and '+'
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  else if (s.startsWith("0")) s = DEFAULT_COUNTRY_CODE + s.slice(1);
  return s.replace(/\D/g, "");
}

/** True when two numbers refer to the same line after normalization. */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length > 0 && na === nb;
}
