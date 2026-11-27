import "server-only";

import crypto from "node:crypto";

import { isSafeMediaFile } from "@/lib/inbox/mediaModel";

/**
 * A public, short-lived link to one file a staff member is sending on
 * Instagram.
 *
 * Instagram's Send API takes a file only by URL (Messenger also takes an
 * upload, Instagram does not), and Meta fetches that URL itself with no
 * session. Sent files live in the business's PRIVATE inbox-media folder, so a
 * send gets a signed link per file: the business, the stored file name and an
 * expiry 15 minutes out, HMAC-signed. The route
 * (/api/messages/attachments/public/[token]) checks the signature and expiry
 * and serves that one file from that business's folder; anything else is a 404.
 * Same shape as lib/social/renderToken.ts.
 *
 * The signing key is DERIVED from the app secret for this one purpose, and the
 * payload uses its own field names, so no other token signed with the same
 * secret (render links, attachment tickets, unsubscribe links) verifies here,
 * and this token verifies nowhere else.
 */

export const PUBLIC_LINK_TTL_MS = 15 * 60 * 1000;

function key(): Buffer | null {
  const s = process.env.SOCIAL_TOKEN_SECRET || process.env.EMAIL_TOKEN_SECRET;
  if (!s) return null;
  return crypto.createHmac("sha256", s).update("inbox-media-public-link/v1").digest();
}

export function publicLinksConfigured(): boolean {
  return key() !== null;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string, k: Buffer): string {
  return b64url(crypto.createHmac("sha256", k).update(payload).digest());
}

export interface PublicFileClaim {
  tenantId: number;
  file: string;
  expiresAt: number;
}

/** Null when the server has no token secret, or the name is not one we store. */
export function signPublicFile(claim: { tenantId: number; file: string }, ttlMs: number = PUBLIC_LINK_TTL_MS, now: number = Date.now()): string | null {
  const k = key();
  if (!k || !isSafeMediaFile(claim.file)) return null;
  const payload = JSON.stringify({ pt: claim.tenantId, pf: claim.file, px: now + ttlMs });
  const body = b64url(Buffer.from(payload, "utf8"));
  return `${body}.${sign(body, k)}`;
}

/** The claim, or null when the link is forged, tampered, expired or names a file we would never store. */
export function verifyPublicFile(token: string, now: number = Date.now()): PublicFileClaim | null {
  const k = key();
  if (!k || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body, k);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let parsed: { pt?: unknown; pf?: unknown; px?: unknown };
  try {
    parsed = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.pt !== "number" || typeof parsed.pf !== "string" || typeof parsed.px !== "number") return null;
  if (parsed.px < now) return null;
  if (!isSafeMediaFile(parsed.pf)) return null;
  return { tenantId: parsed.pt, file: parsed.pf, expiresAt: parsed.px };
}

/** The absolute public URL Meta fetches, or null when links can't be signed here. */
export function publicFileUrl(baseUrl: string, claim: { tenantId: number; file: string }): string | null {
  const token = signPublicFile(claim);
  if (!token) return null;
  return `${baseUrl.replace(/\/+$/, "")}/api/messages/attachments/public/${encodeURIComponent(token)}`;
}
