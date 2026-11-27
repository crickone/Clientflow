import "server-only";

import crypto from "node:crypto";

import { isSafeMediaFile, type MediaKind, type MessageMedia } from "@/lib/inbox/mediaModel";

/**
 * A signed, expiring ticket for one uploaded attachment.
 *
 * The composer uploads a file first (/api/messages/attachments), then sends
 * the message with the tickets it was given. The ticket names the business
 * and the stored file, HMAC-signed with the app's secret, so a send can only
 * use a file that THIS business uploaded, recently. Same style as
 * lib/social/renderToken.ts: base64url JSON payload, a dot, the signature.
 * Payload: { t: tenant id, m: the stored media record, x: expiry ms }.
 */

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
const KINDS: ReadonlySet<MediaKind> = new Set(["image", "video", "audio", "file"]);

function secret(): string | null {
  return process.env.SOCIAL_TOKEN_SECRET || process.env.EMAIL_TOKEN_SECRET || null;
}

export function attachmentTokensConfigured(): boolean {
  return secret() !== null;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string, key: string): string {
  return b64url(crypto.createHmac("sha256", key).update(payload).digest());
}

/** Throws when the server has no token secret (check attachmentTokensConfigured first). */
export function signAttachment(tenantId: number, media: MessageMedia, ttlMs: number = DEFAULT_TTL_MS): string {
  const key = secret();
  if (!key) throw new Error("Attachments are not set up on this server.");
  const m: MessageMedia = { kind: media.kind, file: media.file, mime: media.mime, ...(media.name ? { name: media.name } : {}), size: media.size };
  const payload = JSON.stringify({ t: tenantId, m, x: Date.now() + ttlMs });
  const body = b64url(Buffer.from(payload, "utf8"));
  return `${body}.${sign(body, key)}`;
}

/** The media record, or null when the ticket is forged, tampered, expired or another business's. */
export function verifyAttachment(token: string, tenantId: number): MessageMedia | null {
  const key = secret();
  if (!key || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body, key);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let parsed: { t?: unknown; m?: unknown; x?: unknown };
  try {
    parsed = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.t !== "number" || parsed.t !== tenantId) return null;
  if (typeof parsed.x !== "number" || parsed.x < Date.now()) return null;
  const m = parsed.m as Partial<MessageMedia> | null | undefined;
  if (!m || typeof m !== "object") return null;
  if (typeof m.kind !== "string" || !KINDS.has(m.kind as MediaKind)) return null;
  if (typeof m.file !== "string" || !isSafeMediaFile(m.file)) return null;
  if (typeof m.mime !== "string" || typeof m.size !== "number") return null;
  if (m.name !== undefined && typeof m.name !== "string") return null;
  return { kind: m.kind as MediaKind, file: m.file, mime: m.mime, ...(m.name ? { name: m.name } : {}), size: m.size };
}
