/**
 * Pure helpers that turn stored email rows into something a person can scan:
 * a readable sender, decoded text, and which pile the message belongs in.
 * No I/O, so the server (inbox list) and tests share them.
 */

export type InboxBucket = "people" | "notifications" | "promotions";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  zwnj: "",
  zwj: "",
};

/**
 * Decode HTML entities left in snippets and subjects ("there&#39;s" →
 * "there's"). Unknown names are left as they are rather than guessed.
 */
export function decodeEntities(input: string): string {
  return input.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, ent: string) => {
    if (ent[0] === "#") {
      const hex = ent[1] === "x" || ent[1] === "X";
      const code = hex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? match;
  });
}

/**
 * Split a raw From header into name and address. Uses the LAST "<...>" so a
 * display name that itself contains angle brackets ("noreply - legitfit < >")
 * does not swallow the address, which is what broke the old parser.
 */
export function splitAddress(raw: string): { name: string; email: string } {
  const s = raw.trim();
  const lt = s.lastIndexOf("<");
  const gt = s.lastIndexOf(">");
  if (lt !== -1 && gt > lt) {
    const email = s.slice(lt + 1, gt).trim().toLowerCase();
    if (email.includes("@")) {
      const name = s.slice(0, lt).trim().replace(/^"+|"+$/g, "").trim();
      return { name, email };
    }
  }
  return { name: "", email: s.replace(/^"+|"+$/g, "").trim().toLowerCase() };
}

/** Personal mailbox providers: the domain says nothing about who wrote. */
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "live.ie", "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.ie", "icloud.com", "me.com", "mac.com", "aol.com", "eircom.net", "proton.me", "protonmail.com",
]);

/** Snippet text: entities decoded, invisible preheader padding removed, spaces collapsed. */
export function cleanSnippet(input: string): string {
  return decodeEntities(input)
    .replace(/[\u00ad\u034f\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const NOREPLY_WORDS = /\b(?:no[-_ ]?reply|do[-_ ]?not[-_ ]?reply|donotreply|mailer[-_ ]?daemon)\b/gi;
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

/** "noreply@purchased-services.legitfit.com" → "Legitfit". */
export function brandFromDomain(email: string): string {
  const domain = email.split("@")[1] ?? "";
  const labels = domain.split(".").filter(Boolean);
  if (labels.length === 0) return "";
  let label = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  if (labels.length >= 3 && SECOND_LEVEL.has(label)) label = labels[labels.length - 3];
  return titleIfLower(label.replace(/[-_]+/g, " "));
}

function titleIfLower(s: string): string {
  if (s !== s.toLowerCase()) return s;
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The name to show for a sender. Cleans quotes, stray brackets and "noreply"
 * noise; falls back to the brand in the domain when nothing human is left.
 * Also recovers rows stored before the parser fix, where the whole raw header
 * landed in the address field.
 */
export function displaySender(fromName: string | null, fromEmail: string | null): { name: string; email: string } {
  let name = (fromName ?? "").trim();
  let email = (fromEmail ?? "").trim();
  if (email.includes("<") || email.includes('"')) {
    const parsed = splitAddress(email);
    email = parsed.email;
    if (!name) name = parsed.name;
  }
  if (name.includes("@") && name.includes("<")) {
    const parsed = splitAddress(name);
    name = parsed.name;
    if (!email) email = parsed.email;
  }
  email = email.toLowerCase();

  let clean = name
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>"]/g, " ")
    .replace(NOREPLY_WORDS, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—|:·,]+|[\s\-–—|:·,]+$/g, "")
    .trim();
  const local = email.split("@")[0] ?? "";
  if (!clean || clean.includes("@") || clean.toLowerCase() === local) {
    const domain = email.split("@")[1] ?? "";
    clean = (FREEMAIL.has(domain) ? email : brandFromDomain(email)) || email || "Unknown sender";
  } else {
    clean = titleIfLower(clean);
  }
  return { name: clean, email };
}

const NOTIFY_LOCAL =
  /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|notify|alerts?|mailer[-_.]?daemon|postmaster|bounces?|automated|system|receipts?|billing|invoices?|security|updates?|reminders?)(?:[-_.+].*)?$/i;
/** Machine words anywhere in the mailbox name ("failed-payments+acct_1x@stripe.com"). */
const NOTIFY_ANYWHERE = /(?:no[-_.]?reply|notification|receipt|invoice|payment|billing|mailer|bounce|automated)/i;
/** Senders that only ever send automated mail. */
const NOTIFY_DOMAINS = /(?:^|\.)(?:facebookmail\.com|stripe\.com|paypal\.(?:com|ie|co\.uk)|accounts\.google\.com|intercom-mail\.com|mailchimpapp\.com)$/i;

/**
 * Which pile an email goes in. Anything we sent, or from a person, is
 * "people". Automated senders (noreply, notifications, receipts) are
 * "notifications". Bulk mail carrying an unsubscribe link is "promotions".
 */
export function classifyEmail(input: {
  direction: "in" | "out";
  fromEmail: string;
  fromName: string | null;
  hasUnsubscribe: boolean;
}): InboxBucket {
  if (input.direction === "out") return "people";
  const local = input.fromEmail.split("@")[0] ?? "";
  const rawName = input.fromName ?? "";
  const domain = input.fromEmail.split("@")[1] ?? "";
  if (NOTIFY_LOCAL.test(local) || NOTIFY_ANYWHERE.test(local) || NOTIFY_DOMAINS.test(domain) || /\bno[-_ ]?reply\b/i.test(rawName)) {
    return "notifications";
  }
  if (input.hasUnsubscribe) return "promotions";
  return "people";
}

/** Readable text from an email's HTML, for the AI draft prompt. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}
