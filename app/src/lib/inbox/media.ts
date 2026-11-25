import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";

import { clientMessages, leadMessages } from "@/lib/db/schema";
import { getTenantById, getTenantDbById } from "@/lib/db/tenant";
import { MAX_MEDIA_BYTES, baseMime, classifyMime, isSafeMediaFile, type MediaKind, type MessageMedia } from "./mediaModel";

/**
 * Photos and attachments on inbox messages (Messenger, Instagram, WhatsApp).
 *
 * The channels hand us links that expire (Meta's CDN) or need the provider's
 * token (Whapi), so each one is downloaded once, right after the message row
 * is stored, into the business's PRIVATE folder data/tenants/<slug>/inbox-media/
 * under a random name. Never public/, never the shared image library; only
 * signed-in staff of that business can read them (api/inbox/media/[file]).
 *
 * Everything here is fail-soft: a link that times out, is too big or returns
 * the wrong thing is logged and skipped, and the message keeps its "[Photo]"
 * style text. Nothing here throws into a webhook.
 */

const DOWNLOAD_TIMEOUT_MS = 15_000;

export type MediaOwner = "lead" | "client";

/** One place to fetch a file from. Headers carry a provider token, so they go only to that provider's own host. */
export interface MediaSource {
  url: string;
  headers?: Record<string, string>;
}

/** One attachment as the channel described it, before download. */
export interface IncomingAttachment {
  kind: MediaKind;
  /** Tried in order until one works. */
  sources: MediaSource[];
  /** The type the channel declared, used when the download's own header is vague. */
  mime?: string;
  name?: string;
  /** The size the channel declared; over the cap means it is not fetched at all. */
  size?: number;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function inboxMediaDir(tenantSlug: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(tenantSlug)) throw new Error(`[inbox media] bad tenant slug: ${tenantSlug}`);
  return path.join(process.cwd(), "data", "tenants", tenantSlug, "inbox-media");
}

/** The absolute path of a stored file, or null when the name is not one we write (path traversal, junk). */
export function inboxMediaPath(tenantSlug: string, file: string): string | null {
  if (!isSafeMediaFile(file)) return null;
  const dir = inboxMediaDir(tenantSlug);
  const full = path.join(dir, file);
  return path.dirname(full) === dir ? full : null;
}

/** Read a response body, giving up as soon as it passes the cap. */
async function readCapped(res: Response, cap: number): Promise<Buffer | null> {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > cap ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Download one attachment, trying each source in turn. Returns the bytes and
 * the type to store, or a plain reason it could not be kept.
 */
export async function downloadAttachment(
  a: IncomingAttachment,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ ok: true; buf: Buffer; mime: string } | { ok: false; reason: string }> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const cap = opts.maxBytes ?? MAX_MEDIA_BYTES;
  if (a.size && a.size > cap) return { ok: false, reason: `too large (${a.size} bytes)` };
  let reason = "no link";
  for (const src of a.sources) {
    if (!/^https:\/\//i.test(src.url)) {
      reason = "not an https link";
      continue;
    }
    try {
      const res = await doFetch(src.url, { headers: src.headers, redirect: "follow", signal: AbortSignal.timeout(opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS) });
      if (!res.ok) {
        reason = `HTTP ${res.status}`;
        continue;
      }
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > cap) {
        reason = `too large (${declared} bytes)`;
        continue;
      }
      const header = baseMime(res.headers.get("content-type"));
      // An HTML or JSON body is an error or sign-in page, never the file.
      if (header === "text/html" || header === "application/json") {
        reason = `unexpected ${header} response`;
        continue;
      }
      const buf = await readCapped(res, cap);
      if (!buf) {
        reason = "too large";
        continue;
      }
      if (buf.length === 0) {
        reason = "empty file";
        continue;
      }
      // The header wins when it names a type we know; else what the channel declared.
      const mime = classifyMime(header).known ? header : classifyMime(a.mime).known ? baseMime(a.mime) : header || "application/octet-stream";
      return { ok: true, buf, mime };
    } catch (err) {
      reason = err instanceof Error ? (err.name === "TimeoutError" ? "timed out" : err.message) : "download failed";
    }
  }
  return { ok: false, reason };
}

/** Write the bytes under a random name in the business's folder. */
export function saveMediaFile(tenantSlug: string, buf: Buffer, mime: string, name?: string): MessageMedia {
  const c = classifyMime(mime);
  const dir = inboxMediaDir(tenantSlug);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${crypto.randomBytes(16).toString("hex")}.${c.ext}`;
  fs.writeFileSync(path.join(dir, file), buf, { mode: 0o600 });
  return { kind: c.kind, file, mime: c.mime, ...(name ? { name: name.slice(0, 120) } : {}), size: buf.length };
}

/** Put the media list on the stored message row. */
export function setMessageMedia(tenantId: number, owner: MediaOwner, messageId: number, items: MessageMedia[]): void {
  const tdb = getTenantDbById(tenantId);
  const media = items.length ? JSON.stringify(items) : null;
  if (owner === "lead") tdb.update(leadMessages).set({ media }).where(eq(leadMessages.id, messageId)).run();
  else tdb.update(clientMessages).set({ media }).where(eq(clientMessages.id, messageId)).run();
}

/**
 * Download every attachment of one stored message and record the ones that
 * were kept. The tenant is passed explicitly (never read from the request),
 * because this runs after the webhook has already answered. Never throws.
 */
export async function ingestMessageMedia(input: {
  tenantId: number;
  owner: MediaOwner;
  messageId: number;
  attachments: IncomingAttachment[];
  fetchImpl?: FetchLike;
}): Promise<MessageMedia[]> {
  const kept: MessageMedia[] = [];
  try {
    const tenant = getTenantById(input.tenantId);
    if (!tenant) throw new Error(`unknown tenant ${input.tenantId}`);
    for (const a of input.attachments) {
      const got = await downloadAttachment(a, { fetchImpl: input.fetchImpl });
      if (!got.ok) {
        console.warn(`[inbox media] ${input.owner} message ${input.messageId}: ${a.kind} not kept (${got.reason})`);
        continue;
      }
      kept.push(saveMediaFile(tenant.slug, got.buf, got.mime, a.name));
    }
    if (kept.length) setMessageMedia(input.tenantId, input.owner, input.messageId, kept);
  } catch (err) {
    console.error(`[inbox media] ${input.owner} message ${input.messageId} failed:`, err);
  }
  return kept;
}

/** Start the download without waiting for it, so the webhook answers at once. */
export function ingestMessageMediaLater(input: Parameters<typeof ingestMessageMedia>[0]): void {
  if (!input.attachments.length) return;
  void ingestMessageMedia(input);
}
