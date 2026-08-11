import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { getTenantDbById, type TenantDb } from "@/lib/db/tenant";
import { campaignSends, contacts, emailCampaigns, suppressions, type EmailCampaign } from "@/lib/db/schema";
import { getSendingDomain } from "@/lib/marketing/domains";
import { getCampaignSender, type CampaignSender, type CampaignSendResult } from "@/lib/marketing/sender";
import { createUnsubscribeToken } from "@/lib/marketing/unsubscribeToken";
import type { CampaignAudience } from "@/lib/marketing/campaigns";
import {
  assertCreditsAvailable,
  costForRecipients,
  getEmailBalanceCents,
  recordCreditSpend,
} from "@/lib/email/credits";
import { escapeHtml, renderEmailShell, textToParagraphs } from "@/lib/email";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getThemeForTenant } from "@/lib/settings";

/**
 * The send pipeline (Task 5) — ties together every earlier task into the
 * actual "click Send, throttled batches go out through Mailgun" path:
 * Task 1's credit ledger, Task 2's contacts/suppressions, Task 3's
 * CampaignSender + sending domains, Task 4's campaign model, and Task 6's
 * unsubscribe token + suppress(). Two halves:
 *
 *  - `precheckCampaign` — a fast, side-effect-free validation the "Send"
 *    button calls before committing to anything: domain verified, audience
 *    shape recognized, recipients > 0, balance covers the cost.
 *  - `runCampaignSend` — the actual throttled batch engine, kicked off as a
 *    DETACHED continuation (mirrors the agent chat route's `void
 *    runWithTenant(tenantId, async () => {...})` pattern) so the request that
 *    clicked "Send" returns immediately while sending continues in the
 *    background.
 *
 * Deliberately does NOT reuse lib/marketing/campaigns.ts's `getCampaign` /
 * `resolveAudience` here, for two reasons (see that module's own doc
 * comment: "A background job ... should follow domains.ts's explicit-tenant
 * pattern instead, not call these directly"):
 *   1. Background-safety — everything below takes tenantId EXPLICITLY and
 *      reads/writes via getTenantDbById(tenantId), never the ambient,
 *      request-scoped `db` proxy, so this stays correct even if it's ever
 *      invoked from a context `runWithTenant` doesn't wrap.
 *   2. Fail-CLOSED audience parsing — campaigns.ts's parseCampaignAudience
 *      silently falls back to `{kind:'all_subscribed'}` on malformed JSON
 *      (the right call for the composer UI, which always has a *valid*
 *      in-memory audience to save). That would be a compliance disaster on
 *      the send path: a corrupted audience column must never silently
 *      resolve to "email everyone". See parseAudienceStrict below.
 */

// ─── small pure helpers (exported — Task 7's webhook route imports normalizeMessageId too) ───

/**
 * Strip Mailgun's send-time bracketing (`<id@domain>`) and lowercase, so a
 * `campaign_sends.provider_message_id` stored at send time matches the
 * (already unbracketed) `message.headers["message-id"]` Task 7's webhook
 * parses out of `parseMailgunEvent`. Idempotent — safe to call on an
 * already-normalized id.
 */
export function normalizeMessageId(id: string): string {
  return id.trim().replace(/^<|>$/g, "").toLowerCase();
}

/** Strip CR/LF from a value bound for an outgoing header (here: the from
 *  name). Belt-and-suspenders: MailgunSender's own formatAddress already
 *  strips `"<>\r\n` and the value is form-encoded over the wire either way,
 *  but a header value must never carry a raw newline regardless. */
export function sanitizeHeader(s: string): string {
  return s.replace(/[\r\n]/g, "").trim();
}

/** The domain half of an email address, lowercased. Empty string if there's no '@'. */
function domainPart(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

/**
 * True if a base URL points at localhost — used by precheckCampaign's
 * production guard below. getAppBaseUrl() (lib/appUrl.ts) falls back to
 * `http://localhost:3000` whenever APP_URL/NEXT_PUBLIC_APP_URL is unset AND
 * there's no request to derive a forwarded host from — exactly the position
 * runCampaignSend's DETACHED continuation is in, which is why that function
 * never calls getAppBaseUrl() itself and instead takes baseUrl as a
 * parameter computed in-request by sendCampaignAction (see the review-fix
 * doc comments on precheckCampaign and runCampaignSend below).
 */
function isLocalhostUrl(baseUrl: string): boolean {
  return /localhost/i.test(baseUrl);
}

/**
 * Strict audience parse — unlike campaigns.ts's parseCampaignAudience, this
 * returns `null` (never a default) for anything that isn't EXACTLY one of
 * the two recognized shapes. See the module doc comment for why the send
 * path can't reuse the lenient parser.
 */
function parseAudienceStrict(raw: string): CampaignAudience | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const kind = (v as { kind?: unknown }).kind;
  if (kind === "all_subscribed") return { kind: "all_subscribed" };
  if (kind === "tag") {
    const tag = (v as { tag?: unknown }).tag;
    if (typeof tag === "string" && tag.trim()) return { kind: "tag", tag };
    return null;
  }
  return null;
}

/** Mirrors campaigns.ts's private parseContactTags — contacts.tags is a JSON string[]. */
function parseContactTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function getCampaignRow(tdb: TenantDb, campaignId: number): EmailCampaign | undefined {
  return tdb.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)).get();
}

interface EligibleRecipient {
  contactId: number;
  email: string;
  name: string | null;
}

/**
 * The recipients THIS campaign may still send to, right now: audience match
 * (kind='all_subscribed' or the contact's tags include the campaign's tag)
 * AND contacts.status='subscribed' AND NOT in `suppressions` (case-
 * insensitive — checked independently of contacts.status because a
 * suppression is meant to be permanent even if a contact row's status is
 * ever reset; see suppress.ts's doc comment) AND has NO existing
 * `campaign_sends` row for this campaign yet (idempotent/resumable — calling
 * this again after a partial run only ever returns what's left to send).
 */
function resolveEligibleRecipients(
  tdb: TenantDb,
  campaignId: number,
  audience: CampaignAudience,
): EligibleRecipient[] {
  const subscribed = tdb
    .select({ id: contacts.id, email: contacts.email, name: contacts.name, tags: contacts.tags })
    .from(contacts)
    .where(eq(contacts.status, "subscribed"))
    .all();

  const matches =
    audience.kind === "all_subscribed"
      ? subscribed
      : subscribed.filter((c) => parseContactTags(c.tags).includes(audience.tag));
  if (matches.length === 0) return [];

  const suppressedEmails = new Set(
    tdb
      .select({ email: suppressions.email })
      .from(suppressions)
      .all()
      .map((r) => r.email.toLowerCase()),
  );

  const alreadySent = new Set(
    tdb
      .select({ contactId: campaignSends.contactId })
      .from(campaignSends)
      .where(eq(campaignSends.campaignId, campaignId))
      .all()
      .map((r) => r.contactId)
      .filter((id): id is number => id != null),
  );

  return matches
    .filter((c) => !suppressedEmails.has(c.email.toLowerCase()))
    .filter((c) => !alreadySent.has(c.id))
    .map((c) => ({ contactId: c.id, email: c.email, name: c.name }));
}

// ─── precheck ───────────────────────────────────────────────────────────────

export type PrecheckResult =
  | { ok: true; recipients: number; costCents: number }
  | { ok: false; error: string };

/**
 * Everything the "Send" button must verify BEFORE anything is committed:
 * draft status, a verified sending domain the from-address actually lives
 * on, a recognized (fail-closed) audience shape, at least one eligible
 * recipient, and enough balance to cover them all at today's price. Pure
 * read — never mutates anything, safe to call speculatively (e.g. to render
 * a cost preview) as well as right before sending.
 */
export async function precheckCampaign(
  tenantId: number,
  campaignId: number,
  baseUrl: string,
): Promise<PrecheckResult> {
  try {
    const tdb = getTenantDbById(tenantId);
    const campaign = getCampaignRow(tdb, campaignId);
    if (!campaign) return { ok: false, error: "Campaign not found." };
    if (campaign.status !== "draft") {
      return { ok: false, error: `This campaign is already "${campaign.status}" and can no longer be sent.` };
    }

    const domain = getSendingDomain(tenantId);
    if (!domain) {
      return { ok: false, error: "Connect a sending domain before sending a campaign." };
    }
    if (domain.state !== "verified") {
      return { ok: false, error: "Your sending domain isn't verified yet — finish DNS verification and try again." };
    }
    if (domainPart(campaign.fromEmail) !== domain.domain.toLowerCase()) {
      return { ok: false, error: `The from address must use your verified sending domain (${domain.domain}).` };
    }

    if (!process.env.EMAIL_TOKEN_SECRET) {
      return { ok: false, error: "Email sending isn't fully configured (missing EMAIL_TOKEN_SECRET)." };
    }

    // Review fix — belt-and-suspenders for the compliance-critical
    // unsubscribe links the (detached) send builds: `baseUrl` is computed
    // ONCE, in-request, by sendCampaignAction and reused for both this check
    // and the actual send (runCampaignSend takes the identical value as a
    // required parameter — see its doc comment below). In production, a
    // localhost base means APP_URL/NEXT_PUBLIC_APP_URL isn't configured and
    // there was no request to derive a host from — fail loudly here rather
    // than silently shipping broken List-Unsubscribe/footer links.
    if (process.env.NODE_ENV === "production" && isLocalhostUrl(baseUrl)) {
      return { ok: false, error: "APP_URL not configured — cannot build unsubscribe links." };
    }

    const audience = parseAudienceStrict(campaign.audience);
    if (!audience) {
      return {
        ok: false,
        error: "This campaign's audience couldn't be read — reopen it, re-pick the audience, and save before sending.",
      };
    }

    const recipients = resolveEligibleRecipients(tdb, campaignId, audience);
    if (recipients.length === 0) {
      return { ok: false, error: "There are no eligible recipients (check the audience, contacts, and suppressions)." };
    }

    const costCents = costForRecipients(recipients.length);
    const balance = getEmailBalanceCents(tenantId);
    if (balance < costCents) {
      return { ok: false, error: `Insufficient email credits: balance is ${balance}c, need ${costCents}c.` };
    }

    return { ok: true, recipients: recipients.length, costCents };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't validate the campaign." };
  }
}

// ─── draft -> sending transition ───────────────────────────────────────────

export type MarkSendingResult = { ok: true } | { ok: false; error: string };

/**
 * Flip a campaign draft -> sending, ATOMICALLY guarded on the current status
 * still being 'draft' (a conditional `UPDATE ... WHERE status = 'draft'`, the
 * same "guarded write as mutex" shape as billing/engine.ts's invoice claim
 * and platform/openToken.ts's one-time consume). Called by
 * sendCampaignAction right after precheckCampaign passes, and right before
 * runCampaignSend is kicked off as a detached continuation — if two admins
 * click Send at the same moment, at most one of these calls wins; the other
 * gets a clean {ok:false} instead of a double-send.
 */
export function markCampaignSending(tenantId: number, campaignId: number): MarkSendingResult {
  const tdb = getTenantDbById(tenantId);
  const result = tdb
    .update(emailCampaigns)
    .set({ status: "sending" })
    .where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.status, "draft")))
    .run();
  if (result.changes === 0) {
    return { ok: false, error: "This campaign can no longer be sent (it may already be sending or sent)." };
  }
  return { ok: true };
}

// ─── stats + status-transition helpers ─────────────────────────────────────

interface CampaignStats {
  counts: Record<string, number>;
  note?: string;
}

/** Cumulative per-status counts across EVERY campaign_sends row for this
 *  campaign (not just this run) — correct whether this is the first run or a
 *  later resume. Same groupBy+count shape as lib/memberships.ts. */
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

function finalizeCampaignSent(tdb: TenantDb, campaignId: number): void {
  const stats: CampaignStats = { counts: countsByStatus(tdb, campaignId) };
  tdb
    .update(emailCampaigns)
    .set({ status: "sent", sentAt: new Date(), stats: JSON.stringify(stats) })
    .where(eq(emailCampaigns.id, campaignId))
    .run();
}

/** Recoverable stop (e.g. ran out of credits mid-send) — an operator can top
 *  up and a future "resume" can re-arm status='sending' + call
 *  runCampaignSend again; the idempotent recipient resolution above picks up
 *  exactly where this left off. */
function pauseCampaign(tdb: TenantDb, campaignId: number, note: string): void {
  const stats: CampaignStats = { counts: countsByStatus(tdb, campaignId), note };
  tdb
    .update(emailCampaigns)
    .set({ status: "paused", stats: JSON.stringify(stats) })
    .where(eq(emailCampaigns.id, campaignId))
    .run();
  console.warn(`[marketing] campaign ${campaignId} paused: ${note}`);
}

function failCampaign(tdb: TenantDb, campaignId: number, note: string): void {
  const stats: CampaignStats = { counts: countsByStatus(tdb, campaignId), note };
  tdb
    .update(emailCampaigns)
    .set({ status: "failed", stats: JSON.stringify(stats) })
    .where(eq(emailCampaigns.id, campaignId))
    .run();
  console.error(`[marketing] campaign ${campaignId} failed: ${note}`);
}

// ─── the throttled batch engine ────────────────────────────────────────────

const BATCH_SIZE = 50;
const BATCH_SLEEP_MS = 1000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RunCampaignSendOpts {
  /** Test-only injection point — a fake CampaignSender so tests never hit real Mailgun. Defaults to getCampaignSender(tenantId). */
  sender?: CampaignSender;
}

/**
 * The throttled batch send engine — mirrors automations/scheduler.ts's
 * backfillVideosForTenant (lines ~120-147) shape: a bounded loop, a sleep
 * between chunks of work, and a bail-out that leaves the job cleanly resumable
 * rather than half-mutated. Always call this wrapped in
 * `runWithTenant(tenantId, ...)` (sendCampaignAction does) — this function
 * itself never touches the ambient `db` proxy (getTenantDbById everywhere),
 * but downstream identity helpers (getBusinessProfileForTenant/
 * getThemeForTenant) are already tenant-explicit regardless, so this stays
 * correct even without that wrapper.
 *
 * `baseUrl` is REQUIRED and must be computed in-request by the caller
 * (sendCampaignAction calls getAppBaseUrl() before kicking this off) — this
 * function must NEVER call getAppBaseUrl() itself. It runs as a DETACHED
 * continuation with no request scope, so getAppBaseUrl() can't read a
 * forwarded host there and would silently fall back to
 * `http://localhost:3000` whenever APP_URL/NEXT_PUBLIC_APP_URL is unset —
 * shipping broken List-Unsubscribe/footer links in production. See
 * precheckCampaign's matching production guard above for the "fail loudly
 * instead" half of this fix.
 *
 * NEVER throws to the caller — the whole body is wrapped in try/catch; any
 * unexpected failure marks the campaign 'failed' (best-effort) and logs,
 * rather than propagating into the detached continuation's void Promise
 * (which would otherwise surface only as an unhandled rejection).
 */
export async function runCampaignSend(
  tenantId: number,
  campaignId: number,
  baseUrl: string,
  opts: RunCampaignSendOpts = {},
): Promise<void> {
  try {
    const tdb = getTenantDbById(tenantId);
    const campaign = getCampaignRow(tdb, campaignId);
    // Guard against double-run (two overlapping invocations, a stale retry,
    // or being called before markCampaignSending ever ran) — only ever
    // proceed from 'sending'.
    if (!campaign || campaign.status !== "sending") return;

    const audience = parseAudienceStrict(campaign.audience);
    if (!audience) {
      failCampaign(tdb, campaignId, "Audience became unreadable before sending.");
      return;
    }

    const domain = getSendingDomain(tenantId);
    if (!domain || domain.state !== "verified") {
      failCampaign(tdb, campaignId, "Sending domain is no longer connected or verified.");
      return;
    }

    const recipients = resolveEligibleRecipients(tdb, campaignId, audience);
    if (recipients.length === 0) {
      // Nothing left to do — e.g. a resumed run after everything already
      // sent. Finalize rather than error: this is a successful (no-op) run.
      finalizeCampaignSent(tdb, campaignId);
      return;
    }

    const sender = opts.sender ?? getCampaignSender(tenantId);
    const profile = getBusinessProfileForTenant(tenantId);
    const theme = getThemeForTenant(tenantId);
    const businessName = profile.businessName || "Our business";
    const fromName = sanitizeHeader(campaign.fromName);

    let cursor = campaign.cursor;

    for (let start = 0; start < recipients.length; start += BATCH_SIZE) {
      const batch = recipients.slice(start, start + BATCH_SIZE);

      // Never send a batch we can't pay for — re-checked every batch (not
      // just once up-front) so a campaign that runs the balance dry mid-send
      // stops cleanly instead of sending on credit.
      try {
        assertCreditsAvailable(tenantId, costForRecipients(batch.length));
      } catch {
        pauseCampaign(tdb, campaignId, "Paused: ran out of email credits mid-send. Top up credits to resume.");
        return;
      }

      let sentInBatch = 0;
      for (const contact of batch) {
        const token = createUnsubscribeToken(tenantId, contact.contactId);
        const unsubUrl = `${baseUrl}/u/${token}`;

        const bodyHtml =
          textToParagraphs(campaign.bodyHtml) +
          `<p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">` +
          `Don't want to receive these emails? <a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe</a>.` +
          `</p>`;
        const footer =
          `${escapeHtml(businessName)}` +
          `${profile.location ? ` — ${escapeHtml(profile.location)}` : ""}` +
          `<br/><a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe from these emails</a>`;
        const html = renderEmailShell({
          businessName,
          accent: theme.accent,
          bodyHtml,
          footer,
        });
        // Plain-text part (review fix — deliverability): campaign.bodyHtml
        // actually stores the RAW plain-text/light-markup body (see its
        // column comment in db/schema.ts — it's wrapped via
        // textToParagraphs -> renderEmailShell above only for the html
        // part), so it doubles as the text part's content as-is, no
        // escaping needed. Includes its own plain-text unsubscribe line so
        // the compliance-critical unsubscribe mechanism isn't html-only.
        const text =
          `${campaign.bodyHtml}\n\n` +
          `${businessName}${profile.location ? ` — ${profile.location}` : ""}\n` +
          `Unsubscribe: ${unsubUrl}`;

        let res: CampaignSendResult;
        try {
          res = await sender.send(
            domain.domain,
            { name: fromName, email: campaign.fromEmail },
            {
              to: contact.email,
              toName: contact.name ?? undefined,
              subject: campaign.subject,
              html,
              text,
              headers: {
                "List-Unsubscribe": `<${unsubUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
              campaignId,
              contactId: contact.contactId,
              tenantId,
            },
          );
        } catch (err) {
          // CampaignSender's contract says "never throws" — this is belt-
          // and-suspenders so one misbehaving send can't take down the rest
          // of the batch (or the whole run).
          res = { ok: false, error: err instanceof Error ? err.message : "Unexpected send error." };
        }

        // Review fix — onConflictDoNothing: idx_campaign_sends_unique
        // (UNIQUE(campaign_id, contact_id); see schema.ts + tenant.ts's
        // ensureTenantTables) turns a racing duplicate write (e.g. two
        // overlapping runCampaignSend invocations that both passed the
        // resolveEligibleRecipients pre-filter above before either had
        // inserted) into a DB no-op instead of a second row. `changes === 0`
        // means THIS call's insert lost the race — a send record for this
        // contact already exists — so this contact must NOT be (re-)counted
        // into sentInBatch below, or it would be charged twice for one
        // email actually sent once.
        const insertResult = tdb
          .insert(campaignSends)
          .values({
            campaignId,
            contactId: contact.contactId,
            email: contact.email,
            providerMessageId: res.ok ? normalizeMessageId(res.providerId) : null,
            status: res.ok ? "sent" : "failed",
            error: res.ok ? null : res.error,
          })
          .onConflictDoNothing()
          .run();

        if (res.ok && insertResult.changes > 0) sentInBatch++;
        cursor++;
      }

      tdb.update(emailCampaigns).set({ cursor }).where(eq(emailCampaigns.id, campaignId)).run();

      // Charge per BATCH for emails actually sent, never per email — at the
      // default price, costForRecipients(1) ceil-rounds a fraction of a cent
      // up to a whole cent, which would overcharge a batch of N by roughly
      // N× versus costForRecipients(N) charged once. Guard cost > 0: a €0
      // price (or an all-failed batch) must never call recordCreditSpend,
      // which rejects cents <= 0.
      const cost = costForRecipients(sentInBatch);
      if (cost > 0) {
        try {
          recordCreditSpend(tenantId, cost, campaignId, "system");
        } catch (err) {
          // The balance raced dry between assertCreditsAvailable above and
          // here (a concurrent campaign spent it first) — this batch's sends
          // already went out uncharged. Log it and stop rather than crash;
          // an operator can reconcile from the campaign_sends/ledger rows.
          pauseCampaign(
            tdb,
            campaignId,
            `Paused: credit spend failed mid-run (${sentInBatch} email(s) in this batch already sent, possibly uncharged) — ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return;
        }
      }

      // Throttle BETWEEN batches only — skipping the trailing sleep after the
      // last batch (a deliberate divergence from scheduler.ts's simpler
      // "sleep after every item", which has nothing after its last item to
      // usefully delay) means a single-batch send (<= BATCH_SIZE recipients)
      // never pays the throttle cost at all.
      const isLastBatch = start + BATCH_SIZE >= recipients.length;
      if (!isLastBatch) await sleep(BATCH_SLEEP_MS);
    }

    finalizeCampaignSent(tdb, campaignId);
  } catch (err) {
    console.error(`[marketing] runCampaignSend failed (tenant ${tenantId}, campaign ${campaignId}):`, err);
    try {
      const tdb = getTenantDbById(tenantId);
      failCampaign(tdb, campaignId, err instanceof Error ? err.message : "Unexpected error while sending.");
    } catch (inner) {
      // Even the failure write failed — nothing more we can safely do here.
      console.error(`[marketing] runCampaignSend: also failed to mark campaign ${campaignId} failed:`, inner);
    }
  }
}
