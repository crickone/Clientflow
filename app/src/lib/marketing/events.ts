import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { getTenantById, getTenantDbById, type TenantDb } from "@/lib/db/tenant";
import { controlDb } from "@/lib/db/control";
import { campaignSends, emailCampaigns, tenants, type CampaignSend } from "@/lib/db/schema";
import { logEvent } from "@/lib/billing/engine";
import { normalizeMessageId } from "@/lib/marketing/send";
import { suppress, type SuppressionReason } from "@/lib/marketing/suppress";
import { getSendingDomain } from "@/lib/marketing/domains";
import type { MailgunEvent } from "@/lib/marketing/sender/types";

/**
 * Mailgun event ingestion (Task 7) — the read side of the send pipeline
 * (Task 5, ./send.ts): folds a verified, parsed MailgunEvent (see
 * sender/mailgun.ts's parseMailgunEvent) back into `campaign_sends` status,
 * contact suppression, and a campaign's `stats` JSON, plus a tenant-wide
 * reputation guard that auto-pauses sending if this tenant starts hurting
 * the shared Mailgun account's deliverability. Two halves:
 *
 *  - `resolveTenantIdForMailgunEvent` — tenant resolution for the (public,
 *    no-cookie) webhook route: prefers the `v:tenantId` user-variable Task 5
 *    stamps on every send, falls back to a cross-tenant sending-domain
 *    lookup for events that arrive without it. NEVER a default-tenant
 *    shortcut — the caller (the route) must treat a null result as "ignore
 *    this event", not "assume some tenant".
 *  - `applyEvent` — everything that happens once the tenant is known: takes
 *    tenantId EXPLICITLY and reads/writes via getTenantDbById(tenantId),
 *    never the ambient request-scoped `db` proxy, because this runs from a
 *    public server-to-server webhook with no session/cookie at all (same
 *    discipline as suppress.ts / domains.ts — see either's doc comment).
 */

// ─── tenant resolution (route-facing) ──────────────────────────────────────

/** Tiny unknown-payload guard — mirrors mailgun.ts's own `prop()` (deliberately duplicated rather than imported: that file is Task 3's and stays untouched here). */
function prop(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * Best-effort extraction of the SENDING domain (not the recipient's domain —
 * that's `event-data.recipient-domain`, useless here) from a raw Mailgun
 * webhook payload, for the tenant-resolution fallback below. Mailgun's real
 * event-data carries `envelope.sender` — the exact From/MAIL-FROM address
 * MailgunSender.send used for this call (`from.email` on `fromDomain`), so
 * its domain half IS the tenant's registered sending domain
 * (lib/marketing/domains.ts). Falls back to the raw `message.headers.from`
 * header (`"Name" <addr>`) if envelope.sender is absent. Returns null (never
 * throws) if neither is present or parseable — the caller treats that as
 * "can't resolve by domain", not an error.
 */
function extractSendingDomain(payload: unknown): string | null {
  const data = prop(payload, "event-data") ?? payload;

  const sender = prop(prop(data, "envelope"), "sender");
  if (typeof sender === "string" && sender.includes("@")) {
    const domain = domainOf(sender);
    if (domain) return domain;
  }

  const from = prop(prop(prop(data, "message"), "headers"), "from");
  if (typeof from === "string") {
    const match = from.match(/@([^\s<>]+)>?\s*$/);
    if (match) return match[1].trim().toLowerCase();
  }

  return null;
}

/**
 * Cross-tenant resolver: which tenant (if any) has this domain connected as
 * its sending domain. `sending_domains` lives INSIDE each tenant's own
 * SQLite file (no tenant_id column — see domains.ts's module comment), so
 * there's no single indexed lookup for this; at today's tenant count a
 * linear scan over the control-plane tenant registry is entirely fine (this
 * fires once per inbound webhook event, not in a hot request path).
 * Inactive tenants are skipped — an offboarded tenant must never receive
 * another tenant's — or its own stale — webhook traffic.
 *
 * Only matches a row whose `state` is `'verified'`. A domain string alone
 * isn't a safe match: two tenants can each type the SAME domain into
 * "connect a sending domain" (domains.ts's connectDomain) before either one
 * finishes DNS verification, so matching on `domain` alone could resolve an
 * event to the wrong (unverified) tenant. A verified domain is unique per
 * Mailgun account, which makes it the only unambiguous match.
 */
export function findTenantIdBySendingDomain(domain: string): number | null {
  const clean = domain.trim().toLowerCase();
  if (!clean) return null;

  const rows = controlDb.select({ id: tenants.id, isActive: tenants.isActive }).from(tenants).all();
  for (const t of rows) {
    if (!t.isActive) continue;
    const record = getSendingDomain(t.id);
    if (record && record.domain === clean && record.state === "verified") return t.id;
  }
  return null;
}

/**
 * Resolve which tenant a Mailgun event belongs to, for the webhook route.
 * Prefers `event.tenantId` (validated against the live tenant registry — a
 * stale/offboarded tenant id falls through to the domain lookup rather than
 * being trusted blindly); falls back to `findTenantIdBySendingDomain` using
 * the raw payload's sending domain. Returns null if neither resolves —
 * callers MUST treat that as "ignore this event" (200, no-op), never assume
 * a default tenant (see this module's doc comment).
 */
export function resolveTenantIdForMailgunEvent(event: MailgunEvent, rawPayload: unknown): number | null {
  if (event.tenantId != null) {
    const t = getTenantById(event.tenantId);
    if (t && t.isActive) return t.id;
  }

  const domain = extractSendingDomain(rawPayload);
  if (domain) {
    const tenantId = findTenantIdBySendingDomain(domain);
    if (tenantId != null) return tenantId;
  }

  return null;
}

// ─── event -> campaign_sends status + suppression mapping ─────────────────

type SendStatus = CampaignSend["status"];

/**
 * A `bounced`/`complained`/`unsubscribed` status is a LOCK, mirroring
 * suppress.ts's own "irreversible ... the FIRST reason recorded wins"
 * philosophy: once a row lands in one of these, no later event (e.g. a
 * stray `opened` for a since-bounced address) may ever move it again.
 * Everything else is a forward-only progression ranked by PROGRESS_RANK —
 * `failed` (a temporary/soft bounce) ranks BELOW `delivered`/`opened`/
 * `clicked` deliberately: Mailgun retries a temporary failure internally and
 * often still delivers, so a later `delivered` must be able to overwrite an
 * earlier `failed`, while a stray late `failed` must never downgrade a
 * confirmed `delivered`.
 */
const TERMINAL_STATUSES: ReadonlySet<SendStatus> = new Set(["bounced", "complained", "unsubscribed"]);
const PROGRESS_RANK: Partial<Record<SendStatus, number>> = {
  queued: 0,
  sent: 0,
  failed: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
};

/** True if `next` may replace `current` on a campaign_sends row — see TERMINAL_STATUSES/PROGRESS_RANK above. */
export function shouldApplyStatus(current: SendStatus, next: SendStatus): boolean {
  if (TERMINAL_STATUSES.has(current)) return false;
  if (TERMINAL_STATUSES.has(next)) return true;
  return (PROGRESS_RANK[next] ?? 0) >= (PROGRESS_RANK[current] ?? 0);
}

interface EventMapping {
  status: SendStatus;
  /** Non-null for bounce(permanent)/complaint/unsubscribe — the hard suppression gate. A temporary bounce is null (no suppress). */
  suppressReason: SuppressionReason | null;
}

/** Maps a parsed MailgunEvent to the campaign_sends status it represents (+ whether it should suppress the recipient). Exhaustive over MailgunEvent["event"]. */
function mapEventToStatus(event: MailgunEvent): EventMapping {
  switch (event.event) {
    case "delivered":
      return { status: "delivered", suppressReason: null };
    case "opened":
      return { status: "opened", suppressReason: null };
    case "clicked":
      return { status: "clicked", suppressReason: null };
    case "complained":
      return { status: "complained", suppressReason: "complaint" };
    case "unsubscribed":
      return { status: "unsubscribed", suppressReason: "unsubscribe" };
    case "failed":
      return event.severity === "permanent"
        ? { status: "bounced", suppressReason: "bounce" }
        : { status: "failed", suppressReason: null };
  }
}

// ─── stats recompute ────────────────────────────────────────────────────────

interface CampaignStats {
  counts: Record<string, number>;
  note?: string;
}

/** Cumulative per-status counts across every campaign_sends row for this campaign — mirrors send.ts's own (private) countsByStatus exactly. */
function countsByStatus(tdb: TenantDb, campaignId: number): Record<string, number> {
  const rows = tdb
    .select({ status: campaignSends.status, n: sql<number>`count(*)` })
    .from(campaignSends)
    .where(eq(campaignSends.campaignId, campaignId))
    .groupBy(campaignSends.status)
    .all();
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = Number(r.n);
  return counts;
}

/**
 * Recompute a campaign's `stats` JSON from `campaign_sends` — a fresh
 * aggregate query every time, never an incremental increment/decrement — so
 * replaying the same webhook event twice can never corrupt the counts (the
 * idempotency the brief requires). Preserves an existing `note` (e.g. a
 * prior pause/fail reason from send.ts or the reputation guard below) unless
 * the caller supplies a new one.
 */
function recomputeCampaignStats(tdb: TenantDb, campaignId: number, note?: string): void {
  const campaign = tdb
    .select({ stats: emailCampaigns.stats })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.id, campaignId))
    .get();
  if (!campaign) return; // no matching campaign row — nothing to update (campaign_sends carries no FK; see schema.ts's comment)

  let preservedNote: string | undefined;
  if (campaign.stats) {
    try {
      const parsed: unknown = JSON.parse(campaign.stats);
      if (parsed && typeof parsed === "object" && typeof (parsed as { note?: unknown }).note === "string") {
        preservedNote = (parsed as { note: string }).note;
      }
    } catch {
      // malformed existing JSON — fall through and just write fresh counts, no note
    }
  }

  const stats: CampaignStats = { counts: countsByStatus(tdb, campaignId) };
  const finalNote = note ?? preservedNote;
  if (finalNote) stats.note = finalNote;

  tdb.update(emailCampaigns).set({ stats: JSON.stringify(stats) }).where(eq(emailCampaigns.id, campaignId)).run();
}

/** Live per-status send counts for a campaign — powers the campaigns/[id] stats view. Explicit-tenant (page.tsx already knows the current tenant id). */
export function getCampaignSendCounts(tenantId: number, campaignId: number): Record<string, number> {
  const tdb = getTenantDbById(tenantId);
  return countsByStatus(tdb, campaignId);
}

// ─── reputation guard ───────────────────────────────────────────────────────

// "Recent" = the tenant's last N campaign_sends rows (across every
// campaign), most-recently-updated first — a simple, deterministic window
// that doesn't need a separate time-bucketing query. MIN_SAMPLE guards
// against over-reacting to a tiny volume (e.g. a brand-new tenant's first 2
// sends, one of which bounces, is NOT a 50% reputation crisis) while still
// being small enough that a real tenant sending in any real volume trips it
// quickly once genuinely over threshold.
const REPUTATION_WINDOW = 500;
const REPUTATION_MIN_SAMPLE = 20;
const COMPLAINT_RATE_THRESHOLD = 0.001; // 0.1%
const HARD_BOUNCE_RATE_THRESHOLD = 0.05; // 5%

/** Every 'sending' campaign for this tenant -> 'paused', with a human-readable reason recorded in each one's stats.note, plus one control-plane billing_events row (type 'marketing_paused') for operator visibility. A no-op if nothing is currently sending. */
function pauseAllSendingCampaigns(
  tdb: TenantDb,
  tenantId: number,
  metrics: { complaintRate: number; bounceRate: number; sampleSize: number },
): void {
  const sending = tdb
    .select({ id: emailCampaigns.id })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.status, "sending"))
    .all();
  if (sending.length === 0) return;

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const note =
    `Auto-paused: tenant reputation guard tripped (complaint rate ${pct(metrics.complaintRate)}, ` +
    `hard-bounce rate ${pct(metrics.bounceRate)} over the last ${metrics.sampleSize} send(s)). ` +
    `Protects the shared Mailgun account — review contacts/suppressions before resuming.`;

  for (const c of sending) {
    tdb.update(emailCampaigns).set({ status: "paused" }).where(eq(emailCampaigns.id, c.id)).run();
    recomputeCampaignStats(tdb, c.id, note);
  }

  try {
    logEvent(
      tenantId,
      "marketing_paused",
      { ...metrics, pausedCampaignIds: sending.map((c) => c.id) },
      "system",
    );
  } catch (err) {
    // Never let billing_events logging take down event ingestion — the pause
    // above already happened and is what actually protects the account.
    console.error(`[marketing] logEvent(marketing_paused) failed for tenant ${tenantId}:`, err);
  }
}

/**
 * Tenant-wide reputation check, run after every applied event. Complaint/
 * hard-bounce rate over the tenant's recent campaign_sends (across ALL of
 * its campaigns, not just the one this event touched) — Mailgun's account-
 * level sender reputation is shared across every tenant on it, so one
 * tenant's bad list can hurt every other tenant's deliverability if left
 * sending.
 */
function enforceReputationGuard(tdb: TenantDb, tenantId: number): void {
  const recent = tdb
    .select({ status: campaignSends.status })
    .from(campaignSends)
    .orderBy(desc(campaignSends.updatedAt))
    .limit(REPUTATION_WINDOW)
    .all();
  if (recent.length < REPUTATION_MIN_SAMPLE) return;

  const sampleSize = recent.length;
  const complaints = recent.filter((r) => r.status === "complained").length;
  const bounces = recent.filter((r) => r.status === "bounced").length;
  const complaintRate = complaints / sampleSize;
  const bounceRate = bounces / sampleSize;

  if (complaintRate > COMPLAINT_RATE_THRESHOLD || bounceRate > HARD_BOUNCE_RATE_THRESHOLD) {
    pauseAllSendingCampaigns(tdb, tenantId, { complaintRate, bounceRate, sampleSize });
  }
}

// ─── the main entry point ──────────────────────────────────────────────────

/**
 * Apply one verified, parsed Mailgun event for a known tenant. Called by the
 * webhook route as `runWithTenant(tenantId, () => applyEvent(tenantId, event))`
 * once tenant resolution has succeeded. NEVER THROWS to the caller in normal
 * operation — every DB op here is synchronous better-sqlite3 (no network,
 * no await), so the only realistic failure is a genuinely corrupt DB, which
 * the route's own try/catch around this call still backstops.
 *
 * Idempotent by construction: the status transition is gated by
 * shouldApplyStatus (terminal statuses lock; replays of an already-applied
 * status are a harmless same-value rewrite), suppress() is idempotent on its
 * own (suppress.ts), and stats are always a fresh recompute from the rows,
 * never an incremental counter.
 */
export function applyEvent(tenantId: number, event: MailgunEvent): void {
  const tdb = getTenantDbById(tenantId);
  const normalizedId = normalizeMessageId(event.messageId);
  const mapped = mapEventToStatus(event);

  const row = tdb
    .select()
    .from(campaignSends)
    .where(eq(campaignSends.providerMessageId, normalizedId))
    .get();

  if (row) {
    if (shouldApplyStatus(row.status, mapped.status)) {
      tdb
        .update(campaignSends)
        .set({ status: mapped.status, updatedAt: new Date() })
        .where(eq(campaignSends.id, row.id))
        .run();
    }
    // Always recompute (not just on a status change) — a pure aggregate of
    // current rows, so a same-value replay is a correct no-op, not a skip.
    recomputeCampaignStats(tdb, row.campaignId);
  }

  // Suppress regardless of whether a matching row was found — the hard
  // do-not-email gate must hold for this recipient even if, for some
  // reason, the specific send record can't be located.
  if (mapped.suppressReason) {
    suppress(tenantId, event.recipient, mapped.suppressReason);
  }

  enforceReputationGuard(tdb, tenantId);
}
