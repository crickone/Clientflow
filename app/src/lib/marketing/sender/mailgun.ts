import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { CampaignMessage, CampaignSendResult, CampaignSender, DomainStatus, MailgunEvent } from "./types";

/**
 * Mailgun implementation of CampaignSender — raw `fetch` against Mailgun's
 * HTTP API (deliberately NO `mailgun.js` dependency, per the brief: this
 * whole adapter is one small file so a future provider swap never has to
 * fight someone else's SDK shape). Base URL is region-selectable
 * (MAILGUN_REGION, default "us" -> api.mailgun.net; "eu" -> api.eu.mailgun.net
 * — Mailgun's two real API regions; there is no "api.us.mailgun.net" host).
 * Auth is HTTP Basic with the literal username "api" and MAILGUN_API_KEY as
 * the password, exactly as Mailgun's API expects.
 *
 * Every method NEVER THROWS — every failure (missing config, network error,
 * a non-2xx response) comes back as a typed `{ok:false,error}` instead — and
 * the API key is NEVER interpolated into a returned/logged error string; the
 * only place it appears is the outgoing Authorization header.
 *
 * This file also owns the two PURE helpers webhooks need (Task 7's webhook
 * route imports both): `verifyMailgunSignature` (HMAC-SHA256 signature check,
 * fails closed) and `parseMailgunEvent` (defensive parse of Mailgun's webhook
 * JSON into a MailgunEvent). Neither touches the network or the sender
 * instance, so both are covered directly by mailgun.test.ts without a live
 * Mailgun key.
 */

const MISSING_KEY_ERROR = "Mailgun is not configured (MAILGUN_API_KEY is unset).";

function apiKey(): string | null {
  const key = process.env.MAILGUN_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

/** Mailgun's two real API regions. "us" (default) is plain api.mailgun.net — there is no "api.us.mailgun.net". */
function baseUrl(): string {
  const region = (process.env.MAILGUN_REGION || "us").trim().toLowerCase();
  const host = region === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
  return `https://${host}/v3`;
}

function authHeader(key: string): string {
  return `Basic ${Buffer.from(`api:${key}`).toString("base64")}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Strip characters that would break a `"Name" <addr>` header (header-injection defense) — mirrors imapEmail.ts's sanitizeFromName. */
function sanitizeHeaderName(name: string): string {
  return name.replace(/["<>\r\n]/g, "").trim();
}

function formatAddress(name: string | undefined, email: string): string {
  const clean = name ? sanitizeHeaderName(name) : "";
  return clean ? `"${clean}" <${email}>` : email;
}

/** Best-effort, bounded error detail from a non-2xx response — never throws, never echoes anything WE sent (so the API key can't leak back out through it). */
async function safeErrorText(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    return (text || res.statusText || `HTTP ${res.status}`).slice(0, 500);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

function mapDomainState(raw: unknown): DomainStatus["state"] {
  if (raw === "active") return "verified";
  if (raw === "unverified") return "unverified";
  return "failed";
}

/** Maps Mailgun's raw DNS record objects (`record_type`/`name`/`value`) to our {type,name,value} shape. Skips anything malformed rather than failing the whole call. */
function mapDnsRecords(raw: unknown): DomainStatus["dnsRecords"] {
  if (!Array.isArray(raw)) return [];
  const out: DomainStatus["dnsRecords"] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const type = rec.record_type ?? rec.type;
    const name = rec.name;
    const value = rec.value;
    if (typeof type === "string" && typeof name === "string" && typeof value === "string") {
      out.push({ type, name, value });
    }
  }
  return out;
}

export class MailgunSender implements CampaignSender {
  async registerDomain(
    domain: string,
  ): Promise<{ ok: true; id: string; dnsRecords: DomainStatus["dnsRecords"] } | { ok: false; error: string }> {
    const key = apiKey();
    if (!key) return { ok: false, error: MISSING_KEY_ERROR };
    try {
      const form = new URLSearchParams();
      form.set("name", domain);
      const res = await fetch(`${baseUrl()}/domains`, {
        method: "POST",
        headers: { Authorization: authHeader(key) },
        body: form,
      });
      if (!res.ok) {
        return { ok: false, error: `Mailgun registerDomain failed (${res.status}): ${await safeErrorText(res)}` };
      }
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const domainObj = (data.domain ?? {}) as Record<string, unknown>;
      const id = typeof domainObj.id === "string" ? domainObj.id : domain;
      // Only the SENDING records matter here — this product only ever sends
      // campaign mail through this domain, never receives it.
      const dnsRecords = mapDnsRecords(data.sending_dns_records);
      return { ok: true, id, dnsRecords };
    } catch (err) {
      return { ok: false, error: `Mailgun registerDomain failed: ${errorMessage(err)}` };
    }
  }

  async getDomainStatus(
    domain: string,
  ): Promise<{ ok: true; status: DomainStatus } | { ok: false; error: string }> {
    const key = apiKey();
    if (!key) return { ok: false, error: MISSING_KEY_ERROR };
    try {
      // PUT .../verify — not a plain GET — so this actively asks Mailgun to
      // recheck DNS right now. A plain GET would only return Mailgun's last
      // cached state, which would make "Check verification" in the UI feel
      // broken (still "unverified" right after the operator fixes DNS).
      const res = await fetch(`${baseUrl()}/domains/${encodeURIComponent(domain)}/verify`, {
        method: "PUT",
        headers: { Authorization: authHeader(key) },
      });
      if (!res.ok) {
        return { ok: false, error: `Mailgun getDomainStatus failed (${res.status}): ${await safeErrorText(res)}` };
      }
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const domainObj = (data.domain ?? {}) as Record<string, unknown>;
      const status: DomainStatus = {
        state: mapDomainState(domainObj.state),
        dnsRecords: mapDnsRecords(data.sending_dns_records),
      };
      return { ok: true, status };
    } catch (err) {
      return { ok: false, error: `Mailgun getDomainStatus failed: ${errorMessage(err)}` };
    }
  }

  async send(
    fromDomain: string,
    from: { name: string; email: string },
    msg: CampaignMessage,
  ): Promise<CampaignSendResult> {
    const key = apiKey();
    if (!key) return { ok: false, error: MISSING_KEY_ERROR };
    try {
      const form = new URLSearchParams();
      form.set("from", formatAddress(from.name, from.email));
      form.set("to", formatAddress(msg.toName, msg.to));
      form.set("subject", msg.subject);
      form.set("html", msg.html);
      if (msg.text) form.set("text", msg.text);

      // User-variables so Task 7's webhook route can resolve an inbound
      // event back to campaign/contact/tenant — see CampaignMessage's doc
      // comment in ./types.ts.
      if (msg.campaignId !== undefined) form.set("v:campaignId", String(msg.campaignId));
      if (msg.contactId !== undefined) form.set("v:contactId", String(msg.contactId));
      if (msg.tenantId !== undefined) form.set("v:tenantId", String(msg.tenantId));

      for (const tag of msg.tags ?? []) form.append("o:tag", tag);
      // Caller-supplied headers (List-Unsubscribe etc.) — always `h:`-prefixed, never a `v:` user-variable.
      for (const [name, value] of Object.entries(msg.headers ?? {})) form.set(`h:${name}`, value);

      const res = await fetch(`${baseUrl()}/${encodeURIComponent(fromDomain)}/messages`, {
        method: "POST",
        headers: { Authorization: authHeader(key) },
        body: form,
      });
      if (!res.ok) {
        return { ok: false, error: `Mailgun send failed (${res.status}): ${await safeErrorText(res)}` };
      }
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const providerId = typeof data.id === "string" ? data.id : null;
      if (!providerId) return { ok: false, error: "Mailgun send: provider returned no message id." };
      return { ok: true, providerId };
    } catch (err) {
      return { ok: false, error: `Mailgun send failed: ${errorMessage(err)}` };
    }
  }
}

// ─── Pure webhook helpers (Task 7 imports both) ────────────────────────────

/**
 * Constant-time Mailgun webhook signature check: HMAC-SHA256(signing key,
 * timestamp+token), hex-encoded, compared against the caller-provided
 * `signature`. Mirrors the length-check + timingSafeEqual tail of
 * WhapiBridge.verifyWebhook (lib/whatsapp/whapi.ts) / the cron routes'
 * secretMatches (api/cron/daily/route.ts) exactly: a naive `===` short-
 * circuits on the first mismatched byte, letting a remote attacker time
 * their way to a valid signature; length is checked first since
 * timingSafeEqual itself throws on a length mismatch rather than returning
 * false. Fails CLOSED if MAILGUN_WEBHOOK_SIGNING_KEY is unset — never
 * reaches the compare at all, so an unconfigured deployment can never
 * accidentally accept forged webhook events.
 */
export function verifyMailgunSignature(timestamp: string, token: string, signature: string): boolean {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!signingKey) return false;
  const expected = createHmac("sha256", signingKey).update(timestamp + token).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const RECOGNIZED_EVENTS: ReadonlySet<string> = new Set([
  "delivered",
  "failed",
  "complained",
  "unsubscribed",
  "opened",
  "clicked",
]);
const RECOGNIZED_SEVERITIES: ReadonlySet<string> = new Set(["temporary", "permanent"]);

// --- tiny unknown-payload guards (no `any`) — mirrors whapi.ts's getProp/asArray ---
function prop(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parses Mailgun's webhook JSON body into a MailgunEvent, or null if any
 * ESSENTIAL field (event / recipient / message id) is missing or
 * unrecognized. `severity`/`campaignId`/`tenantId` are optional on
 * MailgunEvent, so their absence never causes a null return.
 *
 * Mailgun nests the real payload under `event-data` (with the HMAC signature
 * alongside it under `signature`); this falls back to the top-level object
 * too so a flattened/simulated payload still parses. campaignId/tenantId are
 * read back out of `user-variables` — the same values MailgunSender.send
 * sent as `v:campaignId`/`v:tenantId` (see ./types.ts's CampaignMessage doc
 * comment) — and Mailgun always returns user-variables as strings, so
 * they're coerced back to number here.
 */
export function parseMailgunEvent(payload: unknown): MailgunEvent | null {
  const data = prop(payload, "event-data") ?? payload;

  const eventRaw = prop(data, "event");
  if (typeof eventRaw !== "string" || !RECOGNIZED_EVENTS.has(eventRaw)) return null;
  const event = eventRaw as MailgunEvent["event"];

  const recipientRaw = prop(data, "recipient");
  const recipient = typeof recipientRaw === "string" ? recipientRaw.trim() : "";
  if (!recipient) return null;

  // message.headers["message-id"], falling back to a top-level "message-id".
  const headers = prop(prop(data, "message"), "headers");
  const messageIdRaw = prop(headers, "message-id") ?? prop(data, "message-id");
  const messageId = typeof messageIdRaw === "string" ? messageIdRaw.trim() : "";
  if (!messageId) return null;

  const result: MailgunEvent = { event, recipient, messageId };

  const severityRaw = prop(data, "severity");
  if (typeof severityRaw === "string" && RECOGNIZED_SEVERITIES.has(severityRaw)) {
    result.severity = severityRaw as MailgunEvent["severity"];
  }

  const userVars = prop(data, "user-variables");
  const campaignId = toFiniteNumber(prop(userVars, "campaignId"));
  if (campaignId !== null) result.campaignId = campaignId;
  const tenantId = toFiniteNumber(prop(userVars, "tenantId"));
  if (tenantId !== null) result.tenantId = tenantId;

  return result;
}
