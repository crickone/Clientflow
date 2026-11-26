/**
 * Pure: the people on the business's WhatsApp, as Whapi returns them.
 * GET /contacts gives the phone's contacts ({contacts: [{id, name?, pushname?,
 * saved, phonebook}], total}); GET /chats gives the conversations ({chats:
 * [{id, type, timestamp, name?, last_message}], total}). One row per phone
 * number: saved contacts plus everyone with a one-to-one chat. Groups, status,
 * channels and the business's own number are left out. No DB, no server-only.
 */

export interface WaContactRow {
  /** Digits only, with country code. */
  phone: string;
  /** The name saved in the phone, else the name they gave WhatsApp, else null. */
  name: string | null;
  saved: boolean;
  /** Milliseconds, or null when there is no chat. */
  lastChatAt: number | null;
}

interface Parsed {
  phone: string;
  savedName: string | null;
  pushname: string | null;
  saved: boolean;
  lastChatAt: number | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const PHONE = /^\d{7,15}$/;

/** A WhatsApp id ("353870000000" or "353870000000@s.whatsapp.net") as phone digits, or null. */
export function phoneFromWaId(id: string): string | null {
  const [user, server] = id.split("@");
  if (server && server !== "s.whatsapp.net" && server !== "c.us") return null;
  return PHONE.test(user) ? user : null;
}

function total(json: unknown): number {
  const t = Number(obj(json)?.total);
  return Number.isFinite(t) && t >= 0 ? t : 0;
}

/** One page of GET /contacts. */
export function parseContactsPage(json: unknown): { items: Parsed[]; total: number } {
  const list = obj(json)?.contacts;
  const items: Parsed[] = [];
  if (Array.isArray(list)) {
    for (const raw of list) {
      const c = obj(raw);
      if (!c) continue;
      const phone = phoneFromWaId(str(c.id));
      if (!phone) continue;
      const saved = c.saved === true || c.phonebook === true;
      items.push({ phone, savedName: saved ? str(c.name) || null : null, pushname: str(c.pushname) || (saved ? null : str(c.name) || null), saved, lastChatAt: null });
    }
  }
  return { items, total: total(json) };
}

/** One page of GET /chats: one-to-one chats only. */
export function parseChatsPage(json: unknown): { items: Parsed[]; total: number } {
  const list = obj(json)?.chats;
  const items: Parsed[] = [];
  if (Array.isArray(list)) {
    for (const raw of list) {
      const c = obj(raw);
      if (!c) continue;
      const type = str(c.type);
      if (type && type !== "contact") continue;
      const phone = phoneFromWaId(str(c.id));
      if (!phone || !str(c.id).includes("@")) continue;
      const last = obj(c.last_message);
      const fromName = last && last.from_me !== true ? str(last.from_name) : "";
      const ts = Number(c.timestamp ?? last?.timestamp ?? 0);
      const at = ts > 1e12 ? ts : ts * 1000;
      items.push({ phone, savedName: null, pushname: str(c.name) || fromName || null, saved: false, lastChatAt: Number.isFinite(at) && at > 0 ? at : null });
    }
  }
  return { items, total: total(json) };
}

/** Contacts and chats as one row per phone; the business's own number left out. */
export function mergeWaContacts(contacts: Parsed[], chats: Parsed[], ownPhone?: string | null): WaContactRow[] {
  const own = ownPhone ? ownPhone.replace(/\D/g, "") : "";
  const by = new Map<string, Parsed>();
  for (const p of [...contacts, ...chats]) {
    if (own && p.phone === own) continue;
    const cur = by.get(p.phone);
    if (!cur) {
      by.set(p.phone, { ...p });
      continue;
    }
    cur.savedName = cur.savedName ?? p.savedName;
    cur.pushname = cur.pushname ?? p.pushname;
    cur.saved = cur.saved || p.saved;
    cur.lastChatAt = cur.lastChatAt == null ? p.lastChatAt : p.lastChatAt == null ? cur.lastChatAt : Math.max(cur.lastChatAt, p.lastChatAt);
  }
  return [...by.values()].map((p) => ({ phone: p.phone, name: p.savedName ?? p.pushname ?? null, saved: p.saved, lastChatAt: p.lastChatAt }));
}
