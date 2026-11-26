/**
 * Provider-agnostic WhatsApp bridge. Implementations wrap an unofficial
 * QR-linked WhatsApp API (e.g. Whapi.cloud). Callers depend only on this
 * interface so the vendor is swappable. No provider types leak past the adapter.
 */

export type MessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

/** A normalized inbound message parsed from a provider webhook. */
export interface InboundMessage {
  /** Sender phone, normalized to E.164 digits (no '+'). */
  fromPhone: string;
  text: string;
  providerMessageId: string;
  /** Epoch ms. */
  timestamp: number;
  /** A photo, video, voice note or document that came with it (`text` is then its caption or a placeholder). */
  media?: InboundMedia[];
}

/** An inbound attachment as the provider described it, before download. */
export interface InboundMedia {
  kind: "image" | "video" | "audio" | "file";
  /** The provider's media id, for its media endpoint. */
  mediaId?: string;
  /** A direct link, when the provider gives one. */
  link?: string;
  mime?: string;
  name?: string;
  size?: number;
}

/** A normalized delivery/read status update parsed from a provider webhook. */
export interface StatusUpdate {
  providerMessageId: string;
  status: MessageStatus;
}

export interface ConnectionStatus {
  connected: boolean;
  /** The linked WhatsApp number when connected, else null. */
  phone: string | null;
}

export interface QrResult {
  /** A data-URL or base64 image of the QR to scan, or null if already linked. */
  qr: string | null;
  connected: boolean;
}

export interface WhatsAppBridge {
  /** Send a plain-text message. Throws on provider/transport failure. */
  sendText(
    toPhone: string,
    text: string,
  ): Promise<{ providerMessageId: string }>;

  /** Whether the linked session is live, and which number. */
  connectionStatus(): Promise<ConnectionStatus>;

  /** QR (or null when already connected) for linking the number. */
  getQrCode(): Promise<QrResult>;

  /** Map a provider inbound-webhook payload to a normalized message, or null. */
  parseInboundWebhook(payload: unknown): InboundMessage | null;

  /**
   * Where to download an inbound attachment from, tried in order. A token
   * header is only ever attached to the provider's own host.
   */
  mediaSources?(media: InboundMedia): Array<{ url: string; headers?: Record<string, string> }>;

  /**
   * The chat with a number, as the provider holds it: everything sent and
   * received on the business's WhatsApp, including from its phone. Newest
   * `count` messages. Optional: a provider without history leaves it out.
   */
  listChat?(phone: string, count: number): Promise<import("./historyModel").ChatMessage[]>;

  /** Map a provider status-webhook payload to a normalized status, or null. */
  parseStatusWebhook(payload: unknown): StatusUpdate | null;

  /**
   * Verify an inbound webhook is genuinely ours. `providedSecret` is whatever
   * the route extracted from the request (header/query); compared to the
   * configured webhook secret.
   */
  verifyWebhook(providedSecret: string | null): boolean;
}
