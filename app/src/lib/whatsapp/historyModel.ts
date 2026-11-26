/**
 * Pure: reading a WhatsApp chat's messages as Whapi returns them
 * (GET /messages/list/{chat}, and the same shape in webhooks), so the lead
 * page can show the whole conversation: what the business sent from its own
 * phone or an earlier tool (GoHighLevel's templates arrive as "hsm"), and
 * what the person replied. No DB, no server-only.
 */

export interface ChatMessage {
  id: string;
  fromMe: boolean;
  /** Milliseconds. */
  at: number;
  text: string;
  /** Whapi's "source": "mobile", "web", "api", ... ("api" = sent through the API, i.e. by Adonis). */
  source: string | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** What a message says, in words. Null for things that are not messages (reactions, edits, system notes). */
export function messageText(type: string, m: Record<string, unknown>): string | null {
  const part = obj(m[type]);
  const caption = str(part?.caption).trim();
  switch (type) {
    case "text":
      return str(obj(m.text)?.body).trim() || null;
    case "hsm": {
      const h = obj(m.hsm);
      const parts = [str(obj(h?.header)?.text ?? h?.header), str(h?.body), str(h?.footer)].map((s) => s.trim()).filter(Boolean);
      return parts.join("\n\n") || null;
    }
    case "link_preview":
      return str(part?.body).trim() || null;
    case "image":
      return caption ? `Photo: ${caption}` : "Photo";
    case "video":
    case "gif":
      return caption ? `Video: ${caption}` : "Video";
    case "short":
      return "Video";
    case "document": {
      const name = str(part?.file_name ?? part?.filename).trim();
      return caption || (name ? `Document: ${name}` : "Document");
    }
    case "audio":
    case "voice":
      return "Voice message";
    case "sticker":
      return "Sticker";
    case "location":
    case "live_location":
      return "Location";
    case "contact":
    case "contact_list":
      return "Contact card";
    case "poll":
      return str(part?.title).trim() ? `Poll: ${str(part?.title).trim()}` : "Poll";
    case "interactive":
    case "buttons":
    case "list":
      return str(obj(part?.body)?.text ?? part?.body).trim() || null;
    case "reply": {
      const r = obj(m.reply);
      return str(obj(r?.buttons_reply)?.title ?? obj(r?.list_reply)?.title).trim() || null;
    }
    default:
      return null;
  }
}

/** One Whapi message, or null when it is not a one-to-one chat message worth showing. */
export function parseChatMessage(raw: unknown): ChatMessage | null {
  const m = obj(raw);
  if (!m) return null;
  const id = str(m.id);
  const chatId = str(m.chat_id);
  if (!id) return null;
  // One-to-one chats only: never groups, status or channels.
  if (chatId && !(chatId.endsWith("@s.whatsapp.net") || chatId.endsWith("@c.us"))) return null;
  const type = str(m.type);
  const text = messageText(type, m);
  if (!text) return null;
  const ts = Number(m.timestamp ?? 0);
  const at = ts > 1e12 ? ts : ts * 1000;
  if (!Number.isFinite(at) || at <= 0) return null;
  return { id, fromMe: m.from_me === true, at, text, source: str(m.source) || null };
}

/** A /messages/list response, oldest first. */
export function parseChatHistory(json: unknown): ChatMessage[] {
  const list = obj(json)?.messages;
  if (!Array.isArray(list)) return [];
  return list
    .map(parseChatMessage)
    .filter((m): m is ChatMessage => m !== null)
    .sort((a, b) => a.at - b.at);
}

/** The messages a webhook carries that the business sent itself, from its phone or another tool (not through Adonis). */
export function phoneSentFromWebhook(payload: unknown): Array<ChatMessage & { toPhoneDigits: string }> {
  const list = obj(payload)?.messages;
  if (!Array.isArray(list)) return [];
  const out: Array<ChatMessage & { toPhoneDigits: string }> = [];
  for (const raw of list) {
    const m = parseChatMessage(raw);
    if (!m || !m.fromMe || m.source === "api") continue;
    const chatId = str(obj(raw)?.chat_id);
    const digits = chatId.split("@")[0].replace(/\D/g, "");
    if (!digits) continue;
    out.push({ ...m, toPhoneDigits: digits });
  }
  return out;
}

/** Which of a chat's messages are not stored yet, given every provider id already known. */
export function missingMessages(history: ChatMessage[], known: Set<string>): ChatMessage[] {
  return history.filter((m) => !known.has(m.id));
}
