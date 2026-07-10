import "server-only";

import { normalizePhone } from "./phone";
import type {
  ConnectionStatus,
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

  parseInboundWebhook(payload: unknown): InboundMessage | null {
    const messages = asArray(getProp(payload, "messages"));
    for (const m of messages) {
      if (getProp(m, "from_me") === true) continue;
      if (getProp(m, "type") !== "text") continue;
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
      const body = String(getProp(getProp(m, "text"), "body") ?? "");
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
      };
    }
    return null;
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
    return providedSecret != null && providedSecret === this.webhookSecret;
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
