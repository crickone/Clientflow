/**
 * Staff notifications: the pure rules. No database, no network, so every
 * rule here is tested directly (model.test.ts).
 *
 * Four kinds notify: an inbound message, a new lead, a sale and a class
 * booked in the member app. Cancellations, AI notices and staff's own
 * actions do not. A sale is for admins only.
 */

export const NOTIFICATION_KINDS = ["message", "lead", "sale", "booking"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type StaffRole = "admin" | "staff";

export function isNotificationKind(v: unknown): v is NotificationKind {
  return typeof v === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(v);
}

/** The words for each kind on the settings page. */
export const KIND_COPY: Record<NotificationKind, { label: string; desc: string }> = {
  message: { label: "Messages", desc: "WhatsApp, Messenger and Instagram messages, and email from a client or lead." },
  lead: { label: "New leads", desc: "A new lead from a form, an ad or another tool." },
  sale: { label: "Sales", desc: "An offer or a gift voucher paid for online." },
  booking: { label: "Class bookings", desc: "A member books a class in the app." },
};

/** Sales are for admins. Everything else goes to every staff member. */
export function isAdminOnlyKind(kind: NotificationKind): boolean {
  return kind === "sale";
}

/** The kinds a person can get, in settings order. */
export function kindsForRole(role: StaffRole): NotificationKind[] {
  return NOTIFICATION_KINDS.filter((k) => role === "admin" || !isAdminOnlyKind(k));
}

/** Whether a person with this role may see a notification at all. */
export function maySee(role: StaffRole, n: { adminOnly: boolean }): boolean {
  return role === "admin" || !n.adminOnly;
}

export interface KindPref {
  inApp: boolean;
  push: boolean;
}
export type Prefs = Record<NotificationKind, KindPref>;

/** Everything on until the person turns it off. */
export function defaultPrefs(): Prefs {
  return {
    message: { inApp: true, push: true },
    lead: { inApp: true, push: true },
    sale: { inApp: true, push: true },
    booking: { inApp: true, push: true },
  };
}

/** Saved rows over the defaults. Unknown kinds in the rows are ignored. */
export function mergePrefs(rows: Array<{ kind: string; inApp: boolean; push: boolean }>): Prefs {
  const out = defaultPrefs();
  for (const r of rows) {
    if (isNotificationKind(r.kind)) out[r.kind] = { inApp: Boolean(r.inApp), push: Boolean(r.push) };
  }
  return out;
}

export interface Recipient {
  userId: number;
  role: StaffRole;
}

/**
 * Who gets a phone/desktop alert for one notification: may see it, and has
 * not turned alerts off for its kind.
 */
export function pushRecipients(
  people: Recipient[],
  prefsByUser: Map<number, Prefs>,
  n: { kind: NotificationKind; adminOnly: boolean },
): number[] {
  return people
    .filter((p) => maySee(p.role, n))
    .filter((p) => (prefsByUser.get(p.userId) ?? defaultPrefs())[n.kind].push)
    .map((p) => p.userId);
}

/** One line of text, at most `max` characters, cut on a word where it can be. */
export function snippet(text: string | null | undefined, max = 140): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** "EUR 64" or "EUR 64.50". */
export function eurText(cents: number): string {
  const eur = cents / 100;
  return `EUR ${Number.isInteger(eur) ? eur.toFixed(0) : eur.toFixed(2)}`;
}

/** Where an inbound message lives in the Inbox. */
export function conversationHref(kind: "client" | "lead", contactId: number): string {
  return `/communication?open=${encodeURIComponent(`conv:${kind}-${contactId}`)}`;
}

export function emailThreadHref(threadKey: string): string {
  return `/communication?open=${encodeURIComponent(`email:${threadKey}`)}`;
}

const CHANNEL_NAME: Record<string, string> = {
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  instagram: "Instagram",
  email: "Email",
};

/** "WhatsApp from Chris Walshe", or "New WhatsApp message" with no name. */
export function messageTitle(channel: string, name: string | null | undefined): string {
  const ch = CHANNEL_NAME[channel] ?? "Message";
  const who = (name ?? "").trim();
  return who ? `${ch} from ${who}` : `New ${ch} message`;
}

// ---- Leads -----------------------------------------------------------------

/**
 * A lead that came in on a message: the message notification already says
 * so. A lead a staff member typed in (or Adonis added on their approval) is
 * their own action.
 */
const MESSAGE_SOURCES = new Set(["whatsapp", "messenger", "instagram"]);

export function leadNotifies(source: string | null | undefined, actor?: string | null): boolean {
  if (actor === "user" || actor === "agent") return false;
  return !MESSAGE_SOURCES.has((source ?? "").trim().toLowerCase());
}

const LEAD_SOURCE: Record<string, string> = {
  facebook: "From Facebook lead form",
  meta: "From Facebook lead form",
  website: "From the website",
  "website-demo": "From the website demo form",
  landing: "From a campaign page",
  form: "From a form",
  offer: "Bought online from a campaign page",
  checkout: "Started a checkout and did not finish",
  email: "From an email",
  voice: "From a phone call",
  manual: "Added by hand",
};

export function leadSourceText(source: string | null | undefined): string {
  const s = (source ?? "").trim();
  if (!s) return "New lead";
  return LEAD_SOURCE[s.toLowerCase()] ?? `From ${s}`;
}

export function personName(first: string | null | undefined, last: string | null | undefined, fallback: string): string {
  const n = [first, last].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  return n || fallback;
}

// ---- Email -----------------------------------------------------------------

export const EMAIL_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * An inbound email notifies only when it is from a known client or lead, is
 * unread, and is less than 2 hours old. The age rule keeps the first sync of
 * a mailbox (months of old mail) silent.
 */
export function emailNotifies(e: { known: boolean; isRead: boolean; at: number | null; now: number }): boolean {
  if (!e.known || e.isRead || e.at == null) return false;
  const age = e.now - e.at;
  return age >= -5 * 60 * 1000 && age < EMAIL_MAX_AGE_MS;
}

// ---- Bookings --------------------------------------------------------------

/** "Spin, Tue 25 Nov at 18:00". */
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function classWhen(name: string, date: string, startTime: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = Number.isNaN(d.getTime()) ? date : `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
  return `${name}, ${day} at ${startTime}`;
}

// ---- Display ---------------------------------------------------------------

/** "Just now", "5 min ago", "3 h ago", "Yesterday", "12 Nov". */
export function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return "Yesterday";
  const d = new Date(at);
  return `${d.getDate()} ${MONTH[d.getMonth()]}`;
}

/** The badge: nothing at 0, "99+" over 99. */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? "99+" : String(unread);
}
