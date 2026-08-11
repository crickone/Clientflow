// Run: npm test -- src/lib/marketing/events.test.ts
//
// Mailgun event ingestion (Task 7) — against a real scratch tenant + a real
// (temp) tenant SQLite file via getTenantDbById, cleaned up in `finally`
// (same pattern as suppress.test.ts / send.test.ts). Covers:
//   1. applyEvent transitions: a 'delivered' event updates the matching
//      campaign_sends row (found by normalizeMessageId — the incoming id is
//      deliberately bracketed + uppercase to prove it matches a stored,
//      already-normalized id).
//   2. A permanent bounce ('failed' + severity 'permanent') updates the row
//      to 'bounced' AND suppresses the recipient (reason 'bounce').
//   3. A complaint updates the row to 'complained' AND suppresses (reason
//      'complaint'); an unsubscribe updates to 'unsubscribed' AND suppresses
//      (reason 'unsubscribe').
//   4. A temporary bounce (severity 'temporary', or severity omitted
//      entirely) updates the row to 'failed' but does NOT suppress.
//   5. Terminal statuses (bounced/complained/unsubscribed) LOCK — a later
//      opened/clicked event for the same message id never downgrades them.
//   6. Replaying the exact same event is idempotent: no duplicate row, no
//      duplicate suppression, status unchanged, stats unchanged.
//   7. The campaign's `stats` JSON recomputes correctly as a fresh aggregate
//      over campaign_sends (matches lib/marketing/events.ts's exported
//      getCampaignSendCounts — the same function the campaigns/[id] stats
//      view reads).
//   8. An event with no matching campaign_sends row still suppresses (the
//      hard do-not-email gate holds even if the specific send record can't
//      be found) and never throws.
//   9. resolveTenantIdForMailgunEvent: prefers event.tenantId (validated
//      against the live tenant registry — a stale id falls through rather
//      than being trusted); falls back to findTenantIdBySendingDomain via
//      the raw payload's envelope.sender / message.headers.from; resolves to
//      null (never a default tenant) when nothing matches. Also:
//      findTenantIdBySendingDomain never matches an UNVERIFIED
//      sending_domains row (only 'verified' is a safe cross-tenant match —
//      see its doc comment in events.ts) but does match the same row once
//      its state flips to 'verified'.
//  10. The reputation guard: once the tenant's recent hard-bounce/complaint
//      rate crosses threshold, EVERY 'sending' campaign (not just the one
//      tied to the triggering event) is auto-paused with a note, one
//      billing_events row (type 'marketing_paused') is logged, a 'draft'
//      campaign is left untouched, and a second trigger while everything is
//      already paused does not log a duplicate event.
//  11. shouldApplyStatus / normalizeMessageId as pure-function checks.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

// ./events -> @/lib/db/tenant (react `cache`) and, separately, -> ./send ->
// @/lib/email -> @/lib/gmail -> @/lib/db (the ambient `db` proxy) ->
// @/lib/tenants -> @/lib/auth -> `next/navigation`. Same two-part shim as
// send.test.ts / campaigns.test.ts (see either's comment) — events.ts pulls
// in send.ts's full module graph just to reuse its `normalizeMessageId`.
// Installed via a dynamic require (below), not a static import, since a
// static `import ... from "./events"` would be hoisted and evaluated before
// this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in events.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Type-only — erased at compile time, never touches the shimmed loader above.
import type { TenantDb } from "../db/tenant";
import type { MailgunEvent } from "./sender/types";

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx compiles .ts to CJS, where top-level await
// is unsupported (same reasoning as send.test.ts).
(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { contacts, suppressions, sendingDomains, emailCampaigns, campaignSends } =
    requireLocal("../db/schema") as typeof import("../db/schema");
  const { normalizeMessageId } = requireLocal("./send") as typeof import("./send");
  const {
    applyEvent,
    resolveTenantIdForMailgunEvent,
    findTenantIdBySendingDomain,
    getCampaignSendCounts,
    shouldApplyStatus,
  } = requireLocal("./events") as typeof import("./events");

  // ── scratch tenant (control row + a real tenant db file) ──
  const slug = "marketing-events-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Marketing Events Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM billing_events WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    const tdb: TenantDb = getTenantDbById(tid);

    function makeCampaign(status: "draft" | "sending" | "sent" | "paused" | "failed" = "sending") {
      return tdb
        .insert(emailCampaigns)
        .values({
          name: "Events Test Campaign",
          subject: "Subject line",
          fromName: "Test Sender",
          fromEmail: "news@evtest7-mail.example.com",
          bodyHtml: "Hello there.",
          audience: JSON.stringify({ kind: "all_subscribed" }),
          status,
        })
        .returning()
        .get();
    }
    function getCampaignRow(campaignId: number) {
      return tdb.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)).get()!;
    }
    function getSendByMsgId(msgId: string) {
      return tdb.select().from(campaignSends).where(eq(campaignSends.providerMessageId, msgId)).get();
    }
    function campaignStats(campaignId: number): { counts: Record<string, number>; note?: string } {
      return JSON.parse(getCampaignRow(campaignId).stats!) as { counts: Record<string, number>; note?: string };
    }

    // ── fixture contacts + one 'sending' campaign every send below belongs to ──
    const c1 = makeCampaign("sending");
    const alice = tdb.insert(contacts).values({ email: "alice@example.com", status: "subscribed" }).returning().get();
    const bob = tdb.insert(contacts).values({ email: "bob@example.com", status: "subscribed" }).returning().get();
    const cara = tdb.insert(contacts).values({ email: "cara@example.com", status: "subscribed" }).returning().get();
    const dave = tdb.insert(contacts).values({ email: "dave@example.com", status: "subscribed" }).returning().get();
    const erin = tdb.insert(contacts).values({ email: "erin@example.com", status: "subscribed" }).returning().get();
    const finn = tdb.insert(contacts).values({ email: "finn@example.com", status: "subscribed" }).returning().get();

    tdb.insert(campaignSends).values({
      campaignId: c1.id, contactId: alice.id, email: alice.email,
      providerMessageId: "evt-alice-msg@mail.example.com", status: "sent",
    }).run();
    tdb.insert(campaignSends).values({
      campaignId: c1.id, contactId: bob.id, email: bob.email,
      providerMessageId: "evt-bob-msg@mail.example.com", status: "sent",
    }).run();
    tdb.insert(campaignSends).values({
      campaignId: c1.id, contactId: cara.id, email: cara.email,
      providerMessageId: "evt-cara-msg@mail.example.com", status: "delivered",
    }).run();
    tdb.insert(campaignSends).values({
      campaignId: c1.id, contactId: dave.id, email: dave.email,
      providerMessageId: "evt-dave-msg@mail.example.com", status: "opened",
    }).run();
    tdb.insert(campaignSends).values({
      campaignId: c1.id, contactId: erin.id, email: erin.email,
      providerMessageId: "evt-erin-msg@mail.example.com", status: "sent",
    }).run();
    tdb.insert(campaignSends).values({
      campaignId: c1.id, contactId: finn.id, email: finn.email,
      providerMessageId: "evt-finn-msg@mail.example.com", status: "sent",
    }).run();

    // ── 1. delivered event updates the row — messageId is bracketed +
    // UPPERCASE on the wire, proving the lookup goes through
    // normalizeMessageId to match the stored (already lowercased/
    // unbracketed) provider_message_id. ──
    applyEvent(tid, {
      event: "delivered",
      recipient: alice.email,
      messageId: "<EVT-ALICE-MSG@Mail.Example.com>",
    });
    assert.equal(getSendByMsgId("evt-alice-msg@mail.example.com")?.status, "delivered");

    // ── replay the SAME event: idempotent — still exactly one row for
    // alice, status unchanged, no phantom second row. ──
    applyEvent(tid, {
      event: "delivered",
      recipient: alice.email,
      messageId: "<EVT-ALICE-MSG@Mail.Example.com>",
    });
    const aliceRows = tdb.select().from(campaignSends).where(eq(campaignSends.email, alice.email)).all();
    assert.equal(aliceRows.length, 1, "replaying a delivered event never duplicates the row");
    assert.equal(aliceRows[0].status, "delivered");

    // ── 2. permanent bounce -> 'bounced' + suppressed (reason 'bounce'),
    // contacts.status flips to 'bounced' (suppress.ts's own mapping). ──
    applyEvent(tid, {
      event: "failed",
      severity: "permanent",
      recipient: bob.email,
      messageId: "EVT-BOB-MSG@Mail.Example.com", // uppercase, unbracketed this time
    });
    assert.equal(getSendByMsgId("evt-bob-msg@mail.example.com")?.status, "bounced");
    const bobSuppression = tdb.select().from(suppressions).where(eq(suppressions.email, "bob@example.com")).get();
    assert.equal(bobSuppression?.reason, "bounce");
    const bobContact = tdb.select().from(contacts).where(eq(contacts.id, bob.id)).get()!;
    assert.equal(bobContact.status, "bounced");

    // ── 5a. terminal lock: an 'opened' event for bob's (now bounced)
    // message id must NOT move him off 'bounced'. ──
    applyEvent(tid, { event: "opened", recipient: bob.email, messageId: "evt-bob-msg@mail.example.com" });
    assert.equal(getSendByMsgId("evt-bob-msg@mail.example.com")?.status, "bounced", "opened must not downgrade a bounced row");

    // ── 6. replay the ORIGINAL bounce event again: still exactly one
    // campaign_sends row, still exactly one suppressions row for bob (not
    // duplicated), status still 'bounced'. ──
    applyEvent(tid, {
      event: "failed",
      severity: "permanent",
      recipient: bob.email,
      messageId: "EVT-BOB-MSG@Mail.Example.com",
    });
    const bobRows = tdb.select().from(campaignSends).where(eq(campaignSends.email, bob.email)).all();
    assert.equal(bobRows.length, 1);
    assert.equal(bobRows[0].status, "bounced");
    const bobSuppressionRows = tdb.select().from(suppressions).where(eq(suppressions.email, "bob@example.com")).all();
    assert.equal(bobSuppressionRows.length, 1, "replaying a bounce never duplicates the suppression row");

    // ── 3a. complaint -> 'complained' + suppressed (reason 'complaint'),
    // starting from a non-'sent' initial status ('delivered') to prove the
    // transition isn't special-cased to only work from 'sent'. ──
    applyEvent(tid, { event: "complained", recipient: cara.email, messageId: "EVT-Cara-Msg@mail.example.com" });
    assert.equal(getSendByMsgId("evt-cara-msg@mail.example.com")?.status, "complained");
    assert.equal(
      tdb.select().from(suppressions).where(eq(suppressions.email, "cara@example.com")).get()?.reason,
      "complaint",
    );
    assert.equal(tdb.select().from(contacts).where(eq(contacts.id, cara.id)).get()!.status, "complained");

    // ── 5b. terminal lock, second example: 'clicked' after 'complained'
    // must not move cara off 'complained'. ──
    applyEvent(tid, { event: "clicked", recipient: cara.email, messageId: "evt-cara-msg@mail.example.com" });
    assert.equal(getSendByMsgId("evt-cara-msg@mail.example.com")?.status, "complained");

    // ── 3b. unsubscribe -> 'unsubscribed' + suppressed (reason
    // 'unsubscribe'); contacts.unsubscribedAt is set. ──
    applyEvent(tid, { event: "unsubscribed", recipient: dave.email, messageId: "evt-dave-msg@mail.example.com" });
    assert.equal(getSendByMsgId("evt-dave-msg@mail.example.com")?.status, "unsubscribed");
    assert.equal(
      tdb.select().from(suppressions).where(eq(suppressions.email, "dave@example.com")).get()?.reason,
      "unsubscribe",
    );
    const daveContact = tdb.select().from(contacts).where(eq(contacts.id, dave.id)).get()!;
    assert.equal(daveContact.status, "unsubscribed");
    assert.ok(daveContact.unsubscribedAt != null);

    // ── 4. temporary bounce (explicit severity) -> 'failed', NOT
    // suppressed. ──
    applyEvent(tid, { event: "failed", severity: "temporary", recipient: erin.email, messageId: "evt-erin-msg@mail.example.com" });
    assert.equal(getSendByMsgId("evt-erin-msg@mail.example.com")?.status, "failed");
    assert.equal(
      tdb.select().from(suppressions).where(eq(suppressions.email, "erin@example.com")).get(),
      undefined,
      "a temporary bounce must never suppress",
    );

    // ── 4b. 'failed' with NO severity at all (defensive default) also ->
    // 'failed', NOT suppressed — only a CONFIRMED 'permanent' severity ever
    // suppresses. ──
    applyEvent(tid, { event: "failed", recipient: finn.email, messageId: "evt-finn-msg@mail.example.com" });
    assert.equal(getSendByMsgId("evt-finn-msg@mail.example.com")?.status, "failed");
    assert.equal(tdb.select().from(suppressions).where(eq(suppressions.email, "finn@example.com")).get(), undefined);

    // ── 7. stats recompute correctly: a fresh aggregate over all six rows
    // — delivered(alice) / bounced(bob) / complained(cara) /
    // unsubscribed(dave) / failed(erin, finn). Matches
    // getCampaignSendCounts exactly (the same function the campaigns/[id]
    // page reads for its live stats view). ──
    const expectedCounts = { delivered: 1, bounced: 1, complained: 1, unsubscribed: 1, failed: 2 };
    const statsBeforePause = campaignStats(c1.id);
    assert.deepEqual(statsBeforePause.counts, expectedCounts);
    assert.equal(statsBeforePause.note, undefined, "no pause has happened yet — no note");
    assert.deepEqual(getCampaignSendCounts(tid, c1.id), expectedCounts);

    // ── 8. an event with NO matching campaign_sends row still suppresses
    // (the hard gate holds even without a locatable send record) and never
    // throws. ──
    assert.doesNotThrow(() =>
      applyEvent(tid, { event: "complained", recipient: "ghost@example.com", messageId: "no-such-message@mail.example.com" }),
    );
    assert.equal(
      tdb.select().from(suppressions).where(eq(suppressions.email, "ghost@example.com")).get()?.reason,
      "complaint",
    );

    // ── 9. resolveTenantIdForMailgunEvent + findTenantIdBySendingDomain ──
    tdb.insert(sendingDomains).values({ domain: "evtest7-mail.example.com", state: "verified", dnsRecords: "[]" }).run();

    assert.equal(findTenantIdBySendingDomain("EvTest7-Mail.example.com"), tid, "case-insensitive direct lookup");
    assert.equal(findTenantIdBySendingDomain("unregistered-domain-zzz.test"), null);
    assert.equal(findTenantIdBySendingDomain(""), null, "blank domain never matches");

    const bareEvent: MailgunEvent = { event: "delivered", recipient: "x@example.com", messageId: "m-domain-fallback@mail.example.com" };

    assert.equal(
      resolveTenantIdForMailgunEvent(bareEvent, { "event-data": { envelope: { sender: "news@EvTest7-Mail.example.com" } } }),
      tid,
      "resolves via envelope.sender domain, case-insensitively",
    );
    assert.equal(
      resolveTenantIdForMailgunEvent(bareEvent, {
        "event-data": { message: { headers: { from: '"Some Business" <news@evtest7-mail.example.com>' } } },
      }),
      tid,
      "falls back to message.headers.from when envelope.sender is absent",
    );
    assert.equal(
      resolveTenantIdForMailgunEvent(bareEvent, { "event-data": { envelope: { sender: "someone@totally-unregistered-domain-xyz.test" } } }),
      null,
      "an unrecognized sending domain resolves to null, never a default tenant",
    );
    assert.equal(resolveTenantIdForMailgunEvent(bareEvent, {}), null, "no domain info at all -> null");
    assert.equal(
      resolveTenantIdForMailgunEvent({ ...bareEvent, tenantId: tid }, {}),
      tid,
      "event.tenantId is preferred outright — no domain lookup needed",
    );
    assert.equal(
      resolveTenantIdForMailgunEvent(
        { ...bareEvent, tenantId: 999_999_999 },
        { "event-data": { envelope: { sender: "news@evtest7-mail.example.com" } } },
      ),
      tid,
      "an unknown/stale event.tenantId falls through to the domain lookup instead of failing outright",
    );

    // ── 9b. Fix: findTenantIdBySendingDomain must require a VERIFIED
    // domain. Two tenants can both enter the SAME sending domain (only one
    // DNS-verified) — an unverified row must never resolve a webhook event
    // to the wrong tenant. Uses a dedicated scratch tenant + domain string
    // (distinct from evtest7-mail.example.com above) so this doesn't
    // interact with the fixture 9's assertions rely on, and cleans itself
    // up regardless of outcome. ──
    const domainGuardSlug = "marketing-events-test-domain-guard";
    const domainGuardDbFile = `tenants/${domainGuardSlug}/${domainGuardSlug}.db`;
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(domainGuardSlug);
    const domainGuardTenant = controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(domainGuardSlug, "Domain Verification Guard Test", domainGuardDbFile) as { id: number };
    const domainGuardTid = domainGuardTenant.id;
    try {
      const domainGuardTdb: TenantDb = getTenantDbById(domainGuardTid);
      const guardedDomain = "guarded-fallback-domain.example.com";
      const guardedDomainRow = domainGuardTdb
        .insert(sendingDomains)
        .values({ domain: guardedDomain, state: "unverified", dnsRecords: "[]" })
        .returning()
        .get();

      assert.equal(
        findTenantIdBySendingDomain(guardedDomain),
        null,
        "an UNVERIFIED sending_domains row must never match — only a verified domain is a safe cross-tenant match",
      );

      domainGuardTdb
        .update(sendingDomains)
        .set({ state: "verified" })
        .where(eq(sendingDomains.id, guardedDomainRow.id))
        .run();

      assert.equal(
        findTenantIdBySendingDomain(guardedDomain),
        domainGuardTid,
        "the SAME row, now verified, matches",
      );
    } finally {
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(domainGuardTid);
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", domainGuardSlug), { recursive: true, force: true });
      } catch {
        // best effort
      }
    }

    // ── 10. reputation guard: tenant-wide hard-bounce rate > 5% auto-pauses
    // EVERY 'sending' campaign (not just the one the triggering event
    // belongs to), records one billing_events row, and leaves a 'draft'
    // campaign untouched. ──
    const c2 = makeCampaign("sending");
    const c3 = makeCampaign("draft");
    for (let i = 0; i < 20; i++) {
      tdb.insert(campaignSends).values({
        campaignId: c2.id,
        email: `bulk-delivered-${i}@example.com`,
        providerMessageId: `bulk-delivered-${i}@mail.example.com`,
        status: "delivered",
      }).run();
    }
    for (let i = 0; i < 5; i++) {
      tdb.insert(campaignSends).values({
        campaignId: c2.id,
        email: `bulk-bounced-${i}@example.com`,
        providerMessageId: `bulk-bounced-${i}@mail.example.com`,
        status: "bounced",
      }).run();
    }
    assert.equal(getCampaignRow(c1.id).status, "sending", "sanity: c1 still sending before the guard evaluates");
    assert.equal(getCampaignRow(c2.id).status, "sending", "sanity: c2 still sending before the guard evaluates");

    // Inserting the bulk rows directly (above) doesn't itself evaluate
    // anything — the guard only runs as part of applyEvent. Any event works
    // to trigger evaluation, including one with no matching row.
    applyEvent(tid, { event: "opened", recipient: "trigger@example.com", messageId: "trigger-guard-eval@mail.example.com" });

    assert.equal(getCampaignRow(c1.id).status, "paused", "every 'sending' campaign for the tenant is paused, not just c2");
    assert.equal(getCampaignRow(c2.id).status, "paused");
    assert.equal(getCampaignRow(c3.id).status, "draft", "a draft campaign is never auto-paused");

    const c1StatsAfterPause = campaignStats(c1.id);
    assert.match(c1StatsAfterPause.note ?? "", /auto-paused/i);
    assert.deepEqual(c1StatsAfterPause.counts, expectedCounts, "pausing recomputes counts fresh — they must still match, unchanged");

    const pausedEvents = controlSqlite
      .prepare("SELECT * FROM billing_events WHERE tenant_id = ? AND type = ?")
      .all(tid, "marketing_paused") as { detail: string | null }[];
    assert.equal(pausedEvents.length, 1, "exactly one marketing_paused billing_events row logged");
    const detail = JSON.parse(pausedEvents[0].detail!) as {
      complaintRate: number; bounceRate: number; sampleSize: number; pausedCampaignIds: number[];
    };
    assert.ok(detail.bounceRate > 0.05, "logged bounce rate exceeds the 5% threshold");
    assert.deepEqual([...detail.pausedCampaignIds].sort((a, b) => a - b), [c1.id, c2.id].sort((a, b) => a - b));

    // A second trigger while every 'sending' campaign is already paused
    // finds nothing left to pause and does NOT log a duplicate event.
    applyEvent(tid, { event: "opened", recipient: "trigger2@example.com", messageId: "trigger-guard-eval-2@mail.example.com" });
    const pausedEventsAfter2nd = controlSqlite
      .prepare("SELECT * FROM billing_events WHERE tenant_id = ? AND type = ?")
      .all(tid, "marketing_paused") as unknown[];
    assert.equal(pausedEventsAfter2nd.length, 1, "no duplicate marketing_paused log once nothing is left 'sending'");

    console.log("events.test.ts: applyEvent + resolution + reputation-guard assertions passed");
  } finally {
    cleanup();
  }

  // ── shouldApplyStatus (pure) ──
  assert.equal(shouldApplyStatus("sent", "delivered"), true);
  assert.equal(shouldApplyStatus("delivered", "failed"), false, "a later temporary failure must not downgrade a confirmed delivered");
  assert.equal(shouldApplyStatus("failed", "delivered"), true, "delivered can overwrite an earlier temporary failure");
  assert.equal(shouldApplyStatus("complained", "opened"), false, "a terminal status locks");
  assert.equal(shouldApplyStatus("delivered", "opened"), true);
  assert.equal(shouldApplyStatus("clicked", "opened"), false, "opened must not downgrade a further-progressed clicked");
  assert.equal(shouldApplyStatus("opened", "clicked"), true);
  assert.equal(shouldApplyStatus("sent", "bounced"), true, "moving INTO a terminal status is always allowed");
  assert.equal(shouldApplyStatus("bounced", "complained"), false, "the first terminal status wins, mirroring suppress.ts");
  assert.equal(shouldApplyStatus("delivered", "delivered"), true, "a same-value replay is a harmless allowed rewrite");

  // ── normalizeMessageId (pure, re-verified here since it's the critical
  // cross-task join this whole file depends on) ──
  assert.equal(normalizeMessageId("<EVT-ALICE-MSG@Mail.Example.com>"), "evt-alice-msg@mail.example.com");
  assert.equal(normalizeMessageId("ALREADY-UPPER@Example.com"), "already-upper@example.com");

  console.log("events.test.ts: all assertions passed");
})();
