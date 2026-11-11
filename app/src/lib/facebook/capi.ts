import "server-only";

import { eq } from "drizzle-orm";

import { controlSqlite } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";
import { sites } from "@/lib/db/schema";
import { decryptToken, encryptToken } from "@/lib/google/tokenCrypto";
import { clientIp } from "@/lib/rateLimit";
import { isValidPixelId } from "@/lib/cms/trackingIds";
import { SITE_HOST_HEADER } from "@/lib/cms/proxyHost";
import { getGrantToken } from "./grants";
import { GRAPH_BASE, isConnectionRefused, metaApiError } from "./graph";
import {
  ADS_CONSENT_COOKIE,
  CAPI_GIVE_UP_MS,
  CRM_STAGE_EVENTS,
  capiRetryDelayMs,
  cookieValue,
  crmEvent,
  isMetaCookie,
  websiteEvent,
  type AdContext,
  type CapiEvent,
  type Person,
} from "./capiModel";

/**
 * Meta Conversions API: conversions sent from our server, not only the
 * visitor's browser, so ad blockers, iPhone tracking limits and a closed tab
 * stop losing them.
 *
 *  - Lead: a new website enquiry or campaign sign-up.
 *  - Purchase: a paid offer (same event id as the browser's Purchase event,
 *    so Meta counts it once).
 *  - "Conversion leads": a Facebook lead-ads lead moving to booked / attended
 *    / sale / repeat in the pipeline, identified only by Meta's own lead id,
 *    so lead ads learn which leads become customers.
 *
 * CONSENT: website events go only for visitors who accepted advertising
 * cookies on that site (the ADS_CONSENT_COOKIE SiteTracking sets), the same
 * rule the browser Pixel follows. Personal data is hashed before it is even
 * queued (capiModel.userData).
 *
 * Events are queued (control capi_events, once per event_key) and sent by
 * the minute ticker in batches, so a form submit never waits on Meta and an
 * outage is retried rather than lost. The token is the site's own
 * Conversions API token (Settings on the website's Domains screen), falling
 * back to the business's Facebook connection.
 */

/** The visitor's ad context from an incoming request (a form post or checkout start). */
export function adContextFromRequest(req: Request): AdContext {
  const cookies = req.headers.get("cookie");
  const fbp = cookieValue(cookies, "_fbp");
  const fbc = cookieValue(cookies, "_fbc");
  // Behind the Cloudflare Worker (a client's own domain, verified by the
  // middleware before it sets SITE_HOST_HEADER) the visitor's address is
  // Cloudflare's CF-Connecting-IP; otherwise the proxy chain's.
  const proxied = Boolean(req.headers.get(SITE_HOST_HEADER));
  const ip = (proxied && req.headers.get("cf-connecting-ip")?.trim()) || clientIp(req);
  return {
    consent: cookieValue(cookies, ADS_CONSENT_COOKIE) === "1",
    fbp: isMetaCookie(fbp) ? fbp : null,
    fbc: isMetaCookie(fbc) ? fbc : null,
    ip: ip && ip !== "unknown" ? ip.slice(0, 64) : null,
    userAgent: req.headers.get("user-agent")?.slice(0, 400) ?? null,
    url: (() => {
      const r = req.headers.get("referer");
      try {
        return r ? new URL(r).toString().slice(0, 500) : null;
      } catch {
        return null;
      }
    })(),
  };
}

interface PixelTarget {
  siteId: number;
  pixelId: string;
}

/** The Pixel events for this business go to: the named site's, else its live site with one. */
export function pixelFor(tenantId: number, siteId?: number | null): PixelTarget | null {
  try {
    const rows = getTenantDbById(tenantId)
      .select({ id: sites.id, pixel: sites.metaPixelId, status: sites.status })
      .from(sites)
      .all()
      .filter((r) => r.pixel && isValidPixelId(r.pixel.trim()));
    const pick = (siteId ? rows.find((r) => r.id === siteId) : undefined) ?? rows.find((r) => r.status === "live") ?? rows[0];
    return pick ? { siteId: pick.id, pixelId: pick.pixel!.trim() } : null;
  } catch {
    return null;
  }
}

function enqueue(tenantId: number, target: PixelTarget, key: string, event: CapiEvent): boolean {
  const now = Date.now();
  return (
    controlSqlite
      .prepare(
        `INSERT INTO capi_events (tenant_id, site_id, pixel_id, event_key, event_name, payload, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_key) DO NOTHING`,
      )
      .run(tenantId, target.siteId, target.pixelId, key, event.event_name, JSON.stringify(event), now, now).changes > 0
  );
}

/** Never throws: a conversion that cannot be queued must not break the form that caused it. */
function safely(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[capi] ${label} not queued:`, err);
  }
}

/** A new lead from the website or a campaign page. */
export function queueWebsiteLead(opts: { tenantId: number; siteId?: number | null; leadId: number; person: Person; ctx: AdContext; contentName: string }): void {
  safely(`lead ${opts.leadId}`, () => {
    if (!opts.ctx.consent) return;
    const target = pixelFor(opts.tenantId, opts.siteId);
    if (!target) return;
    const eventId = `lead-${opts.tenantId}-${opts.leadId}`;
    enqueue(
      opts.tenantId,
      target,
      eventId,
      websiteEvent({ name: "Lead", eventId, person: { ...opts.person, externalId: `lead-${opts.leadId}` }, ctx: opts.ctx, custom: { content_name: opts.contentName.slice(0, 100) } }),
    );
  });
}

/** Keep the buyer's ad context from checkout until Stripe says it was paid (consented visitors only). */
export function rememberCheckoutContext(tenantId: number, orderId: number, ctx: AdContext): void {
  safely(`checkout ${orderId} context`, () => {
    if (!ctx.consent) return;
    controlSqlite
      .prepare("INSERT OR REPLACE INTO capi_context (key, tenant_id, data, created_at) VALUES (?, ?, ?, ?)")
      .run(`order-${tenantId}-${orderId}`, tenantId, JSON.stringify(ctx), Date.now());
  });
}

/** A paid offer. Only for a buyer whose checkout carried consent (rememberCheckoutContext). */
export function queuePurchase(opts: { tenantId: number; orderId: number; valueCents: number; currency: string; person: Person; contentName: string }): void {
  safely(`purchase ${opts.orderId}`, () => {
    const key = `order-${opts.tenantId}-${opts.orderId}`;
    const row = controlSqlite.prepare("SELECT data FROM capi_context WHERE key = ?").get(key) as { data: string } | undefined;
    if (!row) return; // no consent recorded at checkout: nothing goes to Meta
    controlSqlite.prepare("DELETE FROM capi_context WHERE key = ?").run(key);
    const ctx = JSON.parse(row.data) as AdContext;
    const target = pixelFor(opts.tenantId);
    if (!target || !ctx.consent) return;
    // The browser's PurchaseEvent uses this exact id, so Meta keeps one of the two.
    const eventId = `offer-order-${opts.orderId}`;
    enqueue(
      opts.tenantId,
      target,
      `purchase-${opts.tenantId}-${opts.orderId}`,
      websiteEvent({
        name: "Purchase",
        eventId,
        person: opts.person,
        ctx,
        custom: { value: Math.round(opts.valueCents) / 100, currency: opts.currency.toUpperCase(), content_name: opts.contentName.slice(0, 100) },
      }),
    );
  });
}

/** A Facebook lead-ads lead reached a stage worth telling Meta about. */
export function queueCrmStage(tenantId: number, lead: { source: string | null; sourceLeadId: string | null }, role: string): void {
  safely(`crm ${role}`, () => {
    const name = CRM_STAGE_EVENTS[role];
    if (!name || lead.source !== "facebook" || !lead.sourceLeadId) return;
    const event = crmEvent({ stageName: name, leadgenId: lead.sourceLeadId });
    const target = event ? pixelFor(tenantId) : null;
    if (!event || !target) return;
    enqueue(tenantId, target, `crm-${tenantId}-${lead.sourceLeadId}-${role}`, event);
  });
}

// ── Sending ────────────────────────────────────────────────────────────────

/** Seal a token for storage; empty stays empty. */
export function sealCapiToken(token: string): string | null {
  const t = token.trim();
  return t ? encryptToken(t) : null;
}

function tokenFor(tenantId: number, siteId: number | null): { token: string | null; testCode: string | null } {
  let token: string | null = null;
  let testCode: string | null = null;
  if (siteId) {
    try {
      const row = getTenantDbById(tenantId)
        .select({ token: sites.metaCapiToken, test: sites.metaCapiTestCode })
        .from(sites)
        .where(eq(sites.id, siteId))
        .get();
      testCode = row?.test?.trim() || null;
      if (row?.token) token = decryptToken(row.token);
    } catch (err) {
      console.error(`[capi] tenant ${tenantId} site ${siteId} token unreadable:`, err instanceof Error ? err.message : err);
    }
  }
  // No site token: the business's Facebook connection, which reaches a Pixel
  // its business portfolio owns.
  return { token: token ?? getGrantToken(tenantId), testCode };
}

type QueueRow = { id: number; tenant_id: number; site_id: number | null; pixel_id: string; payload: string | null; attempts: number; created_at: number };

function setStatus(tenantId: number, pixelId: string, ok: boolean, error?: string): void {
  const now = Date.now();
  controlSqlite
    .prepare(
      ok
        ? `INSERT INTO capi_status (tenant_id, pixel_id, last_ok_at) VALUES (?, ?, ?)
           ON CONFLICT(tenant_id, pixel_id) DO UPDATE SET last_ok_at = excluded.last_ok_at`
        : `INSERT INTO capi_status (tenant_id, pixel_id, last_error, last_error_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(tenant_id, pixel_id) DO UPDATE SET last_error = excluded.last_error, last_error_at = excluded.last_error_at`,
    )
    .run(...(ok ? [tenantId, pixelId, now] : [tenantId, pixelId, (error ?? "").slice(0, 300), now]));
}

/**
 * Send what is due, in one batch per business and Pixel. Called from the
 * minute ticker. Returns how many events Meta accepted.
 */
export async function processDueCapiEvents(now = Date.now()): Promise<number> {
  controlSqlite.prepare("DELETE FROM capi_events WHERE created_at < ?").run(now - 30 * 24 * 60 * 60 * 1000);
  controlSqlite.prepare("DELETE FROM capi_context WHERE created_at < ?").run(now - 2 * 24 * 60 * 60 * 1000);

  const due = controlSqlite
    .prepare(
      `SELECT id, tenant_id, site_id, pixel_id, payload, attempts, created_at FROM capi_events
        WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 500`,
    )
    .all(now) as QueueRow[];
  const groups = new Map<string, QueueRow[]>();
  for (const r of due) {
    const k = `${r.tenant_id}:${r.site_id ?? 0}:${r.pixel_id}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  let sent = 0;
  for (const rows of groups.values()) {
    const { tenant_id: tenantId, site_id: siteId, pixel_id: pixelId } = rows[0];
    const events = rows.map((r) => (r.payload ? (JSON.parse(r.payload) as CapiEvent) : null));
    const ok = rows.filter((_, i) => events[i]);
    try {
      const { token, testCode } = tokenFor(tenantId, siteId);
      if (!token) throw new Error("No Conversions API token for this Pixel, and Facebook is not connected.");
      const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(pixelId)}/events?` + new URLSearchParams({ access_token: token }), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: events.filter(Boolean), ...(testCode ? { test_event_code: testCode } : {}) }),
      });
      const json = (await res.json().catch(() => ({}))) as { events_received?: number; error?: unknown };
      if (!res.ok || json.error) throw metaApiError(json, res.status, `Meta refused the events (${res.status}).`);
      const mark = controlSqlite.prepare("UPDATE capi_events SET status = 'sent', sent_at = ?, payload = NULL, attempts = attempts + 1, last_error = NULL WHERE id = ?");
      for (const r of ok) mark.run(Date.now(), r.id);
      sent += ok.length;
      setStatus(tenantId, pixelId, true);
      // One line per batch so a send can be confirmed from the logs (names only, never personal data).
      console.log(`[capi] tenant ${tenantId} Pixel ${pixelId}: ${ok.length} event(s) accepted (${[...new Set(ok.map((r) => (JSON.parse(r.payload ?? "{}") as { event_name?: string }).event_name))].join(", ")})${testCode ? " as test events" : ""}`);
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      const hint = isConnectionRefused(err) ? `${reason} Add a Conversions API token for this Pixel on the website's Domains screen.` : reason;
      const fail = controlSqlite.prepare("UPDATE capi_events SET attempts = ?, last_error = ?, next_attempt_at = ?, status = ? WHERE id = ?");
      for (const r of rows) {
        const attempts = r.attempts + 1;
        const expired = now - r.created_at >= CAPI_GIVE_UP_MS;
        fail.run(attempts, hint, now + capiRetryDelayMs(attempts), expired ? "failed" : "pending", r.id);
      }
      setStatus(tenantId, pixelId, false, hint);
      console.error(`[capi] tenant ${tenantId} Pixel ${pixelId}: ${rows.length} event(s) not sent: ${reason}`);
    }
  }
  return sent;
}

export interface CapiStatus {
  lastOkAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  sentLast7Days: number;
  waiting: number;
}

/** What Settings shows next to the token: is Meta taking our events? */
export function capiStatus(tenantId: number, pixelId: string | null): CapiStatus | null {
  if (!pixelId) return null;
  const s = controlSqlite.prepare("SELECT last_ok_at, last_error, last_error_at FROM capi_status WHERE tenant_id = ? AND pixel_id = ?").get(tenantId, pixelId) as
    | { last_ok_at: number | null; last_error: string | null; last_error_at: number | null }
    | undefined;
  const counts = controlSqlite
    .prepare(
      `SELECT SUM(CASE WHEN status = 'sent' AND sent_at > ? THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS waiting
         FROM capi_events WHERE tenant_id = ? AND pixel_id = ?`,
    )
    .get(Date.now() - 7 * 24 * 60 * 60 * 1000, tenantId, pixelId) as { sent: number | null; waiting: number | null };
  return {
    lastOkAt: s?.last_ok_at ?? null,
    lastError: s?.last_error ?? null,
    lastErrorAt: s?.last_error_at ?? null,
    sentLast7Days: counts.sent ?? 0,
    waiting: counts.waiting ?? 0,
  };
}
