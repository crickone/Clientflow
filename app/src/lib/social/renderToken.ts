import "server-only";

import crypto from "node:crypto";

/**
 * A public, expiring URL for one rendered slide.
 *
 * Rendered PNGs are served by an authenticated route (a render is a tenant's
 * work). Meta fetches post images itself, from a plain URL, with no session
 * -- so a post that is about to go out gets a signed link per slide: the
 * tenant, the filename and an expiry, HMAC-signed with the app's secret.
 * The route (/api/social/render/[token]) verifies the signature and expiry
 * and serves the file; anything else is a 404. Nothing about the tenant's
 * library is enumerable from it, and a leaked link dies with its expiry.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function secret(): string | null {
  return process.env.SOCIAL_TOKEN_SECRET || process.env.EMAIL_TOKEN_SECRET || null;
}

export function renderTokensConfigured(): boolean {
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

export interface RenderClaim {
  tenantId: number;
  filename: string;
  expiresAt: number;
}

export function signRenderToken(claim: { tenantId: number; filename: string }, ttlMs: number = DEFAULT_TTL_MS): string | null {
  const key = secret();
  if (!key) return null;
  const payload = JSON.stringify({ t: claim.tenantId, f: claim.filename, e: Date.now() + ttlMs });
  const body = b64url(Buffer.from(payload, "utf8"));
  return `${body}.${sign(body, key)}`;
}

export function verifyRenderToken(token: string, now: number = Date.now()): RenderClaim | null {
  const key = secret();
  if (!key) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body, key);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let parsed: { t?: unknown; f?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.t !== "number" || typeof parsed.f !== "string" || typeof parsed.e !== "number") return null;
  if (parsed.e < now) return null;
  // The filename is a content hash this app produced; anything with a path
  // separator in it is not one of ours.
  if (!/^[A-Za-z0-9._-]+$/.test(parsed.f)) return null;
  return { tenantId: parsed.t, filename: parsed.f, expiresAt: parsed.e };
}
