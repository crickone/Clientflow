import "server-only";

import { timingSafeEqual } from "node:crypto";

import { normalizePhone } from "./phone";
import { parseChatHistory, type ChatMessage } from "./historyModel";
import type {
  ConnectionStatus,
  InboundMedia,
  InboundMessage,
  MessageStatus,
  QrResult,
  StatusUpdate,
  WhatsAppBridge,
} from "./types";

const DEFAULT_BASE = "https://gate.whapi.cloud";

/**
 * Whapi.cloud adapter. Whapi pairs a number via QR (linked-device, like
 * WhatsApp Web) and exposes a JSON REST API + webhooks.
 *
 * NOTE: exact endpoint paths/payload shapes are confirmed against live Whapi
 * credentials in the verification phase; they're isolated here so a tweak never
 * touches callers.
 */
export class WhapiBridge implements WhatsAppBridge {
  private readonly base: string;
  private readonly token: string;
  private readonly webhookSecret: string;

  constructor(opts: { token: string; baseUrl?: string; webhookSecret?: string }) {
    this.token = opts.token;
    this.base = (opts.baseUrl?.trim() || DEFAULT_BASE).replace(/\/$/, "");
    this.webhookSecret = opts.webhookSecret ?? "";
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async sendText(
    toPhone: string,
    text: string,
  ): Promise<{ providerMessageId: string }> {
    const to = normalizePhone(toPhone);
    if (!to) throw new Error("Recipient phone is empty after normalization.");

    const res = await fetch(`${this.base}/messages/text`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ to, body: text }),
    });
    if (!res.ok) {
      const detail = await safeText(res);
      throw new Error(`WhatsApp send failed (${res.status}): ${detail}`);
    }
    const data = (await res.json().catch(() => ({}))) as {
      message?: { id?: string };
      id?: string;
      sent?: boolean;
    };
    const id = data.message?.id ?? data.id;
    if (!id) throw new Error("WhatsApp send: provider returned no message id.");
    return { providerMessageId: id };
  }

  /**
   * Point Whapi's webhook at `webhookUrl` (no secret in it) and have Whapi
   * send the secret as an x-webhook-secret header instead. Headers can only
   * be set through Whapi's API (not its dashboard). The channel's current
   * settings are read first and written back with only our webhook entry
   * changed, so nothing else the business configured resets.
   */
  async moveSecretToHeader(webhookUrl: string): Promise<void> {
    if (!this.webhookSecret) throw new Error("No webhook secret yet: save the WhatsApp settings first.");
    const cur = await fetch(`${this.base}/settings`, { headers: this.headers() });
    if (!cur.ok) throw new Error(`Could not read the WhatsApp settings (${cur.status}): ${await safeText(cur)}`);
    const settings = (await cur.json().catch(() => ({}))) as Record<string, unknown> & {
      webhooks?: Array<{ url?: string; events?: unknown; mode?: string; headers?: Record<string, string> }>;
    };
    const ours = (u?: string) => Boolean(u && u.includes("/api/whatsapp/webhook"));
    const existing = settings.webhooks ?? [];
    const mine = existing.filter((h) => ours(h.url));
    const others = existing.filter((h) => !ours(h.url));
    const base = mine[0] ?? { events: [{ type: "messages", method: "post" }, { type: "statuses", method: "post" }], mode: "body" };
    const webhooks = [...others, { ...base, url: webhookUrl, headers: { ...(base.headers ?? {}), "x-webhook-secret": this.webhookSecret } }];

    let res = await fetch(`${this.base}/settings`, { method: "PATCH", headers: this.headers(), body: JSON.stringify({ ...settings, webhooks }) });
    // Some fields the read returns may not be writable; the webhooks alone are enough.
    if (!res.ok) res = await fetch(`${this.base}/settings`, { method: "PATCH", headers: this.headers(), body: JSON.stringify({ webhooks }) });
    if (!res.ok) throw new Error(`WhatsApp did not accept the webhook change (${res.status}): ${await safeText(res)}`);

    // Confirm it took before the app starts refusing the old address.
    const check = await fetch(`${this.base}/settings`, { headers: this.headers() });
    const after = (await check.json().catch(() => ({}))) as { webhooks?: Array<{ url?: string; headers?: Record<string, string> }> };
    const ok = (after.webhooks ?? []).some((h) => h.url === webhookUrl && h.headers?.["x-webhook-secret"] === this.webhookSecret);
    if (!ok) throw new Error("WhatsApp saved the settings but the webhook header is not there. Nothing was changed on our side.");
  }

  async connectionStatus(): Promise<ConnectionStatus> {
    const res = await fetch(`${this.base}/health`, { headers: this.headers() });
    if (!res.ok) return { connected: false, phone: null };
    const data = (await res.json().catch(() => ({}))) as {
      status?: { text?: string };
      user?: { id?: string };
    };
    const text = (data.status?.text ?? "").toUpperCase();
    const connected = text === "AUTH" || text === "CONNECTED" || text === "READY";
    const phone = data.user?.id ? normalizePhone(String(data.user.id)) : null;
    return { connected, phone: phone || null };
  }

  async getQrCode(): Promise<QrResult> {
    const status = await this.connectionStatus();
    if (status.connected) return { qr: null, connected: true };
    const res = await fetch(`${this.base}/users/login`, {
      headers: this.headers(),
    });
    if (!res.ok) return { qr: null, connected: false };
    const data = (await res.json().catch(() => ({}))) as {
      qr?: string;
      base64?: string;
    };
    const qr = data.base64 ?? data.qr ?? null;
    return { qr: qr ? ensureDataUrl(qr) : null, connected: false };
  }

  async listChat(phone: string, count: number): Promise<ChatMessage[]> {
    const digits = normalizePhone(phone);
    if (!digits) return [];
    const chat = `${digits}@s.whatsapp.net`;
    const res = await fetch(`${this.base}/messages/list/${encodeURIComponent(chat)}?count=${Math.max(1, Math.min(500, Math.round(count)))}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`WhatsApp history failed (${res.status}).`);
    return parseChatHistory(await res.json().catch(() => ({})));
  }

  async listContactsPage(offset: number, count: number): Promise<unknown> {
    return this.getPage("contacts", offset, count);
  }

  async listChatsPage(offset: number, count: number): Promise<unknown> {
    return this.getPage("chats", offset, count);
  }

  private async getPage(what: "contacts" | "chats", offset: number, count: number): Promise<unknown> {
    const qs = new URLSearchParams({ count: String(Math.max(1, Math.min(500, Math.round(count)))), offset: String(Math.max(0, Math.round(offset))) });
    const res = await fetch(`${this.base}/${what}?${qs}`, { headers: this.headers(), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`WhatsApp ${what} failed (${res.status}).`);
    return res.json().catch(() => ({}));
  }

  parseInboundWebhook(payload: unknown): InboundMessage | null {
    const messages = asArray(getProp(payload, "messages"));
    for (const m of messages) {
      if (getProp(m, "from_me") === true) continue;
      const type = String(getProp(m, "type") ?? "");
      const media = whapiMedia(type, getProp(m, type));
      if (type !== "text" && !media) continue;
      // Only accept 1:1 user chats. Skip groups (@g.us), status/broadcast, and
      // channels/newsletters — a clinic enquiry is always a direct message, and
      // we must never ingest group chatter into leads. When chat_id is absent we
      // fall through (older payloads), but reject an explicit group `from` too.
      const chatId = String(getProp(m, "chat_id") ?? "");
      const isDirect =
        chatId.endsWith("@s.whatsapp.net") || chatId.endsWith("@c.us");
      if (chatId && !isDirect) continue;
      const from = String(getProp(m, "from") ?? "");
      if (from.endsWith("@g.us")) continue;
      const body = media ? media.text : String(getProp(getProp(m, "text"), "body") ?? "");
      const id = String(getProp(m, "id") ?? "");
      if (!from || !id || !body) continue;
      const tsRaw = Number(getProp(m, "timestamp") ?? 0);
      // Whapi timestamps are seconds.
      const timestamp = tsRaw > 1e12 ? tsRaw : tsRaw * 1000;
      return {
        fromPhone: normalizePhone(from.split("@")[0]),
        text: body,
        providerMessageId: id,
        timestamp: timestamp || Date.now(),
        ...(media ? { media: [media.item] } : {}),
        ...(typeof getProp(m, "from_name") === "string" && String(getProp(m, "from_name")).trim() ? { fromName: String(getProp(m, "from_name")).trim() } : {}),
      };
    }
    return null;
  }

  /** The file's own link first (no token sent), then Whapi's media endpoint with the token. */
  mediaSources(media: InboundMedia): Array<{ url: string; headers?: Record<string, string> }> {
    const out: Array<{ url: string; headers?: Record<string, string> }> = [];
    if (media.link?.startsWith("https://")) out.push({ url: media.link });
    if (media.mediaId) {
      out.push({ url: `${this.base}/media/${encodeURIComponent(media.mediaId)}`, headers: { Authorization: `Bearer ${this.token}` } });
    }
    return out;
  }

  parseStatusWebhook(payload: unknown): StatusUpdate | null {
    const statuses = asArray(getProp(payload, "statuses"));
    const s = statuses[0];
    if (!s) return null;
    const id = String(getProp(s, "id") ?? "");
    if (!id) return null;
    const raw = String(getProp(s, "status") ?? "").toLowerCase();
    const status = mapStatus(raw);
    if (!status) return null;
    return { providerMessageId: id, status };
  }

  verifyWebhook(providedSecret: string | null): boolean {
    if (!this.webhookSecret) return false; // fail closed if unconfigured
    if (providedSecret == null) return false;
    // Constant-time compare (mirrors the cron routes' secretMatches): a naive
    // `===` short-circuits on the first mismatched byte, letting a remote
    // attacker time their way to the webhook secret. Length is checked first
    // (timingSafeEqual throws on a length mismatch rather than returning
    // false), so an unequal-length guess never throws and always reports false.
    const a = Buffer.from(providedSecret);
    const b = Buffer.from(this.webhookSecret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

function mapStatus(raw: string): MessageStatus | null {
  switch (raw) {
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
      return "read";
    case "failed":
    case "error":
      return "failed";
    default:
      return null;
  }
}

const WHAPI_MEDIA: Record<string, { kind: InboundMedia["kind"]; placeholder: string }> = {
  image: { kind: "image", placeholder: "[Photo]" },
  video: { kind: "video", placeholder: "[Video]" },
  audio: { kind: "audio", placeholder: "[Audio]" },
  voice: { kind: "audio", placeholder: "[Voice note]" },
  document: { kind: "file", placeholder: "[File]" },
};

/**
 * A Whapi photo / video / audio / voice / document message: its caption (or a
 * placeholder) as the text, and what to download. Shape: `{ type: "image",
 * image: { id, mime_type, file_size, link?, caption?, filename? } }`.
 */
function whapiMedia(type: string, obj: unknown): { text: string; item: InboundMedia } | null {
  const spec = Object.prototype.hasOwnProperty.call(WHAPI_MEDIA, type) ? WHAPI_MEDIA[type] : undefined;
  if (!spec || !obj || typeof obj !== "object") return null;
  const id = String(getProp(obj, "id") ?? "");
  const link = String(getProp(obj, "link") ?? "");
  if (!id && !link) return null;
  const caption = String(getProp(obj, "caption") ?? "").trim();
  const size = Number(getProp(obj, "file_size") ?? 0);
  const name = String(getProp(obj, "filename") ?? getProp(obj, "file_name") ?? "").trim();
  const mime = String(getProp(obj, "mime_type") ?? "");
  return {
    text: caption || spec.placeholder,
    item: {
      kind: spec.kind,
      ...(id ? { mediaId: id } : {}),
      ...(link ? { link } : {}),
      ...(mime ? { mime } : {}),
      ...(name ? { name } : {}),
      ...(Number.isFinite(size) && size > 0 ? { size } : {}),
    },
  };
}

function ensureDataUrl(s: string): string {
  return s.startsWith("data:") ? s : `data:image/png;base64,${s}`;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "(no body)";
  }
}

// --- tiny unknown-payload guards (no `any`) ---
function getProp(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object"
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
