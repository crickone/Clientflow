/**
 * Is this email an automatic reply (out of office, vacation responder, bulk
 * mail)? Such a message is not a person answering, so it must not stop a
 * lead's follow-up flows or make the lead hot. Pure: the callers pass the
 * headers they have (names in any case) and the subject.
 *
 * Headers read (RFC 3834 and the common vendor ones):
 * - Auto-Submitted: anything other than "no"
 * - X-Autoreply / X-Autorespond: present
 * - Precedence: auto_reply, bulk, junk or list
 * When a path has no headers, the subject is the fallback.
 */

const SUBJECT_PREFIX = /^\s*(automatic reply|auto[\s-]?reply|autoreply|automatische antwort|out of (the )?office|away from (the )?office)\b/i;

export function isAutoReply(headers: Record<string, string | undefined> | null | undefined, subject: string | null | undefined): boolean {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (typeof v === "string") h[k.toLowerCase()] = v.trim().toLowerCase();
  }
  const autoSubmitted = h["auto-submitted"];
  if (autoSubmitted !== undefined && autoSubmitted !== "no" && autoSubmitted !== "") return true;
  if ("x-autoreply" in h || "x-autorespond" in h) return true;
  const precedence = h["precedence"];
  if (precedence && /^(auto_reply|auto-reply|bulk|junk|list)\b/.test(precedence)) return true;
  return SUBJECT_PREFIX.test(subject ?? "");
}
