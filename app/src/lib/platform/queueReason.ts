/**
 * The reason shown under a failed-queue alert: the latest failure's error,
 * tidied and redacted. Provider errors (WhatsApp, Mailgun, Meta) often echo
 * the recipient's email or phone, URLs with keys in the query string, or
 * token fragments; none of that belongs on a platform alert. Redaction runs
 * before truncation, so a token cut at the length limit is never left
 * half-visible.
 */
export function queueReason(raw: string | null | undefined): string | null {
  let s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  s = s
    .replace(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi, "[email]")
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/gi, "$1")
    .replace(/\+?\d[\d ()-]{6,}\d/g, "[number]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[token]");
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}
