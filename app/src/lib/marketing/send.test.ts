// Run: npm test -- src/lib/marketing/send.test.ts
//
// The send pipeline (Task 5) — the money + compliance critical path. Covers,
// against a real scratch tenant + a real (temp) tenant SQLite file:
//   1. precheckCampaign failures: no sending domain, domain not verified,
//      from-address on the wrong domain, malformed/unrecognized audience
//      JSON (FAILS CLOSED — never silently falls back to all_subscribed),
//      insufficient credits — and the success shape (recipients, costCents).
//   2. markCampaignSending's atomic draft->sending guard (a second call on
//      an already-sending campaign is refused, not a double-transition).
//   3. runCampaignSend's actual batch loop, with an INJECTED fake
//      CampaignSender (never hits real Mailgun):
//        - unsubscribed + suppressed contacts excluded (suppression checked
//          independently of contacts.status, case-insensitively);
//        - tag-audience matching;
//        - List-Unsubscribe / List-Unsubscribe-Post headers + a visible
//          unsubscribe link + the business identity on every send;
//        - provider_message_id stored NORMALIZED (unbracketed, lowercased);
//        - a per-contact provider failure is recorded (status='failed') but
//          doesn't abort the run or get charged;
//        - credits charged ONCE PER BATCH for emails actually sent
//          (costForRecipients(sent), not sent * costForRecipients(1));
//        - a €0 price never calls (and never throws from) recordCreditSpend;
//        - idempotency: re-running a campaign that already has a
//          campaign_sends row for a contact skips it (never double-sends),
//          and re-invoking after the campaign is already 'sent' is a pure
//          no-op (the status guard);
//        - the html AND plain-text parts both carry the passed-in `baseUrl`
//          (never localhost) in their unsubscribe links;
//        - a racing duplicate write for the same (campaign_id, contact_id)
//          — simulated deterministically — hits the DB-level
//          idx_campaign_sends_unique constraint and is neither double-
//          recorded nor double-charged (review fix).
//   4. normalizeMessageId / sanitizeHeader pure-function behavior.
//   5. precheckCampaign's production-only guard against a localhost baseUrl
//      (review fix — belt-and-suspenders for the point above).
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

// ./send -> @/lib/db/tenant (react `cache`) and, separately, -> @/lib/email
// -> @/lib/gmail -> @/lib/db (the ambient `db` proxy) -> @/lib/tenants ->
// @/lib/auth -> `next/navigation`. Same two-part shim as campaigns.test.ts /
// tools.marketing.test.ts, for the same reason (see either file's comment).
// Installed via a dynamic require (below) rather than a static import, since
// a static `import ... from "./send"` would be hoisted and evaluated before
// this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in send.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Type-only — erased at compile time, never touches the shimmed loader above.
import type { CampaignMessage, CampaignSender, CampaignSendResult } from "./sender/types";

/** A CampaignSender fake that records every call instead of touching the network — never hits real Mailgun. */
function makeFakeSender(opts: { failTo?: Set<string> } = {}): { sender: CampaignSender; calls: CampaignMessage[] } {
  const calls: CampaignMessage[] = [];
  let n = 0;
  const sender: CampaignSender = {
    async registerDomain() {
      return { ok: true, id: "fake-domain-id", dnsRecords: [] };
    },
    async getDomainStatus() {
      return { ok: true, status: { state: "verified", dnsRecords: [] } };
    },
    async send(_fromDomain, _from, msg): Promise<CampaignSendResult> {
      calls.push(msg);
      if (opts.failTo?.has(msg.to)) {
        return { ok: false, error: "simulated provider failure" };
      }
      n++;
      // Deliberately bracketed + mixed-case, mirroring Mailgun's real
      // send-time response shape — proves normalizeMessageId's stripping/
      // lowercasing actually runs on the write path, not just in isolation.
      return { ok: true, providerId: `<Fake-${n}-${msg.to}@Mail.EXAMPLE.com>` };
    },
  };
  return { sender, calls };
}

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx compiles .ts to CJS, where top-level await
// is unsupported (same reasoning as campaigns.test.ts).
(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { contacts, suppressions, sendingDomains, emailCampaigns, campaignSends } =
    requireLocal("../db/schema") as typeof import("../db/schema");
  const {
    EMAIL_PRICE_KEY,
    DEFAULT_EMAIL_PRICE_PER_1000_CENTS,
    costForRecipients,
    getEmailBalanceCents,
    grantCredits,
    listLedger,
    setEmailPricePer1000Cents,
  } = requireLocal("../email/credits") as typeof import("../email/credits");
  const { precheckCampaign, markCampaignSending, runCampaignSend, normalizeMessageId, sanitizeHeader } =
    requireLocal("./send") as typeof import("./send");

  // ── scratch tenant (control row + a real tenant db file) ──
  const slug = "send-pipeline-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Send Pipeline Test", dbFile) as { id: number };
  const tid = t.id;

  // email_credit_price_cents is a GLOBAL platform_settings key — capture +
  // force a known value so cost math below is deterministic regardless of
  // what other test files (or the real app) left it at (same discipline as
  // credits.test.ts).
  const priceBefore = controlSqlite
    .prepare("SELECT value FROM platform_settings WHERE key = ?")
    .get(EMAIL_PRICE_KEY) as { value: string } | undefined;

  const originalSecret = process.env.EMAIL_TOKEN_SECRET;
  process.env.EMAIL_TOKEN_SECRET = "send-test-secret-do-not-use";

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM email_credit_ledger WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM email_credits WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    if (priceBefore) {
      controlSqlite.prepare("UPDATE platform_settings SET value = ? WHERE key = ?").run(priceBefore.value, EMAIL_PRICE_KEY);
    } else {
      controlSqlite.prepare("DELETE FROM platform_settings WHERE key = ?").run(EMAIL_PRICE_KEY);
    }
    if (originalSecret === undefined) delete process.env.EMAIL_TOKEN_SECRET;
    else process.env.EMAIL_TOKEN_SECRET = originalSecret;
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    setEmailPricePer1000Cents(DEFAULT_EMAIL_PRICE_PER_1000_CENTS);
    const tdb = getTenantDbById(tid);

    // Review fix: a non-localhost base URL threaded through every
    // precheckCampaign/runCampaignSend call below — proves neither ever
    // falls back to getAppBaseUrl()'s localhost default now that both take
    // it as a required parameter instead of computing it themselves.
    const fakeBaseUrl = "https://app.faketest.example.com";

    type Status = "draft" | "sending" | "sent" | "paused" | "failed";
    function forceStatus(campaignId: number, status: Status) {
      tdb.update(emailCampaigns).set({ status }).where(eq(emailCampaigns.id, campaignId)).run();
    }
    function getRow(campaignId: number) {
      return tdb.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)).get()!;
    }
    function makeCampaign(overrides: Partial<{ fromEmail: string; audience: string; bodyHtml: string }> = {}) {
      return tdb
        .insert(emailCampaigns)
        .values({
          name: "Test Campaign",
          subject: "Hello from the test suite",
          fromName: "Test Sender",
          fromEmail: overrides.fromEmail ?? "news@mail.example.com",
          bodyHtml: overrides.bodyHtml ?? "Hello there.\n\nThanks for reading this.",
          audience: overrides.audience ?? JSON.stringify({ kind: "all_subscribed" }),
        })
        .returning()
        .get();
    }

    // ── fixture contacts: alice/bob eligible; carol unsubscribed (status
    // filter); dave subscribed but separately suppressed (case-insensitive,
    // independent of contacts.status — see suppress.ts's "permanent" doc
    // comment); erin subscribed + tagged 'vip'. ──
    const alice = tdb.insert(contacts).values({ email: "alice@example.com", status: "subscribed" }).returning().get();
    const bob = tdb.insert(contacts).values({ email: "bob@example.com", status: "subscribed" }).returning().get();
    tdb.insert(contacts).values({ email: "carol@example.com", status: "unsubscribed" }).run();
    const dave = tdb.insert(contacts).values({ email: "Dave@Example.com", status: "subscribed" }).returning().get();
    // Suppressed directly (NOT via suppress(), which would also flip dave's
    // contacts.status) — proves the suppression check is a SEPARATE gate,
    // not just a proxy for contacts.status. Lowercased vs. dave's mixed-case
    // stored email proves the match is case-insensitive.
    tdb.insert(suppressions).values({ email: dave.email.toLowerCase(), reason: "manual" }).run();
    const erin = tdb
      .insert(contacts)
      .values({ email: "erin@example.com", status: "subscribed", tags: JSON.stringify(["vip"]) })
      .returning()
      .get();

    // ── 1. precheckCampaign: no sending domain connected yet ──
    const c1 = makeCampaign();
    const noDomain = await precheckCampaign(tid, c1.id, fakeBaseUrl);
    assert.equal(noDomain.ok, false);
    assert.match((noDomain as { error: string }).error, /sending domain/i);

    // ── 2. precheckCampaign: domain connected but not verified ──
    tdb.insert(sendingDomains).values({ domain: "mail.example.com", state: "unverified", dnsRecords: "[]" }).run();
    const notVerified = await precheckCampaign(tid, c1.id, fakeBaseUrl);
    assert.equal(notVerified.ok, false);
    assert.match((notVerified as { error: string }).error, /verif/i);

    // ── verify the domain for the rest of the suite ──
    tdb.update(sendingDomains).set({ state: "verified" }).run();

    // ── 3. precheckCampaign: from-address on the WRONG domain ──
    const wrongDomainCampaign = makeCampaign({ fromEmail: "news@othermail.example.com" });
    const wrongDomain = await precheckCampaign(tid, wrongDomainCampaign.id, fakeBaseUrl);
    assert.equal(wrongDomain.ok, false);
    assert.match((wrongDomain as { error: string }).error, /verified sending domain/i);

    // ── 4. precheckCampaign: insufficient credits (balance is still 0) ──
    assert.equal(getEmailBalanceCents(tid), 0, "no credits granted yet");
    const noCredits = await precheckCampaign(tid, c1.id, fakeBaseUrl);
    assert.equal(noCredits.ok, false);
    assert.match((noCredits as { error: string }).error, /credit/i);

    // ── 5. precheckCampaign: malformed / unrecognized audience JSON FAILS
    // CLOSED — never silently resolves to all_subscribed. ──
    const malformedJson = makeCampaign({ audience: "{not json" });
    const malformed1 = await precheckCampaign(tid, malformedJson.id, fakeBaseUrl);
    assert.equal(malformed1.ok, false, "invalid JSON audience must fail, not default to all_subscribed");
    assert.match((malformed1 as { error: string }).error, /audience/i);

    const unknownKind = makeCampaign({ audience: JSON.stringify({ kind: "everyone_on_earth" }) });
    const malformed2 = await precheckCampaign(tid, unknownKind.id, fakeBaseUrl);
    assert.equal(malformed2.ok, false, "an unrecognized audience 'kind' must fail closed too");

    const emptyTag = makeCampaign({ audience: JSON.stringify({ kind: "tag", tag: "  " }) });
    const malformed3 = await precheckCampaign(tid, emptyTag.id, fakeBaseUrl);
    assert.equal(malformed3.ok, false, "a blank tag is not a recognized shape either");

    // ── grant credits generously for the rest of the suite ──
    grantCredits(tid, 100_000, "test:setup");
    assert.equal(getEmailBalanceCents(tid), 100_000);

    // ── 6. precheckCampaign: success shape (3 eligible: alice, bob, erin —
    // all_subscribed sweeps in EVERY subscribed contact regardless of tags) ──
    const ok1 = await precheckCampaign(tid, c1.id, fakeBaseUrl);
    assert.equal(ok1.ok, true);
    if (ok1.ok) {
      assert.equal(ok1.recipients, 3, "alice + bob + erin — carol (unsubscribed) and dave (suppressed) excluded");
      assert.equal(ok1.costCents, costForRecipients(3));
    }

    // ── 6b. Review fix (belt-and-suspenders): in production, a localhost
    // baseUrl is refused outright — APP_URL/NEXT_PUBLIC_APP_URL must be
    // configured for the detached send's unsubscribe links to ever be
    // correct. NODE_ENV is typed readonly by Next.js's global.d.ts, hence
    // the `as any` — restored in `finally`. Scoped to just this call: every
    // OTHER precheckCampaign call in this suite uses fakeBaseUrl (non-
    // localhost) under the ambient (non-production) NODE_ENV and is never
    // rejected for this reason, proving the guard is production-only, not a
    // blanket localhost ban. spawnSync gives every test FILE its own child
    // process (see scripts/test.mjs), so mutating NODE_ENV here can't leak
    // into any other test file either. ──
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = "production";
      const prodLocalhost = await precheckCampaign(tid, c1.id, "http://localhost:3000");
      assert.equal(prodLocalhost.ok, false, "production + localhost baseUrl must fail closed");
      assert.match((prodLocalhost as { error: string }).error, /APP_URL/);
    } finally {
      // Mirrors this file's own EMAIL_TOKEN_SECRET restore idiom above —
      // process.env coerces `undefined` to the STRING "undefined" on plain
      // assignment, so an unset original must be `delete`d, not reassigned.
      if (originalNodeEnv === undefined) delete (process.env as any).NODE_ENV;
      else (process.env as any).NODE_ENV = originalNodeEnv;
    }

    // ── 7. EMAIL_TOKEN_SECRET missing -> precheck fails closed too ──
    delete process.env.EMAIL_TOKEN_SECRET;
    const noSecret = await precheckCampaign(tid, c1.id, fakeBaseUrl);
    assert.equal(noSecret.ok, false);
    assert.match((noSecret as { error: string }).error, /EMAIL_TOKEN_SECRET/);
    process.env.EMAIL_TOKEN_SECRET = "send-test-secret-do-not-use";

    // ── 8. markCampaignSending: draft -> sending, then refuses a repeat call ──
    const marked = markCampaignSending(tid, c1.id);
    assert.equal(marked.ok, true);
    assert.equal(getRow(c1.id).status, "sending");
    const markedAgain = markCampaignSending(tid, c1.id);
    assert.equal(markedAgain.ok, false, "already-sending campaign can't be marked sending again");

    // ── 9. runCampaignSend: the real batch loop, fake sender ──
    const { sender: sender1, calls: calls1 } = makeFakeSender();
    const balanceBeforeSend = getEmailBalanceCents(tid);
    await runCampaignSend(tid, c1.id, fakeBaseUrl, { sender: sender1 });

    assert.equal(calls1.length, 3, "alice + bob + erin were sent to (erin is subscribed, so all_subscribed includes her)");
    const sentTo = calls1.map((c) => c.to).sort();
    assert.deepEqual(sentTo, ["alice@example.com", "bob@example.com", "erin@example.com"]);
    assert.ok(!sentTo.includes("carol@example.com"), "unsubscribed contact excluded");
    assert.ok(!sentTo.includes("dave@example.com"), "suppressed contact excluded (case-insensitively)");

    // Compliance headers + visible unsubscribe link + business identity on every send.
    for (const call of calls1) {
      const listUnsub = call.headers?.["List-Unsubscribe"];
      assert.ok(listUnsub, "List-Unsubscribe header present");
      assert.ok(listUnsub!.startsWith("<") && listUnsub!.endsWith(">"), "List-Unsubscribe is angle-bracketed");
      assert.ok(listUnsub!.includes("/u/"), "List-Unsubscribe points at the /u/ unsubscribe route");
      assert.equal(call.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
      // Review fix 1: the unsubscribe link uses the baseUrl PASSED IN to
      // runCampaignSend, never a localhost fallback — proves this function
      // never calls getAppBaseUrl() itself (it's detached; see send.ts).
      assert.ok(listUnsub!.includes(fakeBaseUrl), "List-Unsubscribe uses the baseUrl passed into runCampaignSend");
      assert.ok(!listUnsub!.includes("localhost"), "List-Unsubscribe must never fall back to localhost");
      assert.ok(call.html.includes("/u/"), "a visible unsubscribe link is in the body");
      assert.ok(call.html.includes(fakeBaseUrl), "the visible html unsubscribe link uses the passed-in baseUrl");
      assert.ok(!call.html.includes("localhost"), "html must never contain a localhost link");
      assert.match(call.html, /unsubscribe/i);
      assert.ok(call.html.includes("Send Pipeline Test"), "the business identity appears in the email");
      // Review fix 3: a plain-text part is present (not HTML-only) and
      // carries the raw campaign body + the same unsubscribe link.
      assert.ok(call.text && call.text.length > 0, "a plain-text part is present");
      assert.ok(call.text!.includes("Hello there."), "the plain-text part contains the raw campaign body");
      assert.ok(!call.text!.includes("<p"), "the plain-text part is not HTML");
      assert.ok(call.text!.includes(fakeBaseUrl), "the plain-text part's unsubscribe link uses the passed-in baseUrl");
      assert.equal(call.campaignId, c1.id);
      assert.equal(call.tenantId, tid);
    }

    // provider_message_id stored NORMALIZED (unbracketed, lowercased) even
    // though the fake returned it bracketed + mixed-case.
    const sendRows1 = tdb.select().from(campaignSends).where(eq(campaignSends.campaignId, c1.id)).all();
    assert.equal(sendRows1.length, 3);
    for (const row of sendRows1) {
      assert.equal(row.status, "sent");
      assert.ok(row.providerMessageId, "provider message id stored");
      assert.equal(row.providerMessageId, row.providerMessageId!.toLowerCase(), "stored lowercased");
      assert.ok(!row.providerMessageId!.includes("<") && !row.providerMessageId!.includes(">"), "brackets stripped");
      // The fake sender returned e.g. "<Fake-1-alice@example.com@Mail.EXAMPLE.com>" — bracketed + mixed-case —
      // so a stored value equal to its own normalized form proves normalizeMessageId actually ran on the write path.
      assert.equal(row.providerMessageId, normalizeMessageId(row.providerMessageId!), "idempotent — already normalized");
    }

    // Campaign finalized.
    const afterSend1 = getRow(c1.id);
    assert.equal(afterSend1.status, "sent");
    assert.ok(afterSend1.sentAt != null, "sentAt is set");
    const stats1 = JSON.parse(afterSend1.stats!) as { counts: Record<string, number> };
    assert.equal(stats1.counts.sent, 3);

    // ── 10. Charged ONCE PER BATCH for emails actually sent, not per email
    // — proves the ~5x-overcharge bug the brief calls out doesn't happen. ──
    const ledgerAfterSend1 = listLedger(tid, 10);
    const sendLedgerRows1 = ledgerAfterSend1.filter((l) => l.campaignId === c1.id);
    assert.equal(sendLedgerRows1.length, 1, "exactly ONE ledger row for this campaign's send, not one per email");
    assert.equal(sendLedgerRows1[0].deltaCents, -costForRecipients(3));
    assert.ok(
      costForRecipients(3) < 3 * costForRecipients(1),
      "sanity check: batching must actually be cheaper than per-email charging at this price for the scenario to be meaningful",
    );
    assert.equal(getEmailBalanceCents(tid), balanceBeforeSend - costForRecipients(3));

    // ── 11. Re-invoking after the campaign is already 'sent' is a pure
    // no-op (the status guard) — never double-sends, never double-charges. ──
    await runCampaignSend(tid, c1.id, fakeBaseUrl, { sender: sender1 });
    assert.equal(calls1.length, 3, "no new sends after the campaign already finished");
    assert.equal(getEmailBalanceCents(tid), balanceBeforeSend - costForRecipients(3), "no double charge");

    // ── 12. Idempotency via the exclusion logic itself: a campaign_sends row
    // that already exists for a contact is skipped on a (simulated) resume,
    // not just when the whole campaign already finished. ──
    const c2 = makeCampaign();
    tdb
      .insert(campaignSends)
      .values({ campaignId: c2.id, contactId: alice.id, email: alice.email, providerMessageId: "prior-run-msg", status: "sent" })
      .run();
    forceStatus(c2.id, "sending"); // simulate a resumed run, bypassing markCampaignSending's draft-only guard
    const { sender: sender2, calls: calls2 } = makeFakeSender();
    await runCampaignSend(tid, c2.id, fakeBaseUrl, { sender: sender2 });
    assert.equal(calls2.length, 2, "bob + erin only — alice already had a campaign_sends row");
    assert.deepEqual(calls2.map((c) => c.to).sort(), ["bob@example.com", "erin@example.com"]);
    const sendRows2 = tdb.select().from(campaignSends).where(eq(campaignSends.campaignId, c2.id)).all();
    assert.equal(sendRows2.length, 3, "alice's pre-existing row + bob's + erin's new rows — no duplicate for alice");
    assert.equal(sendRows2.filter((r) => r.email === "alice@example.com").length, 1, "alice was never re-sent to");
    const stats2 = JSON.parse(getRow(c2.id).stats!) as { counts: Record<string, number> };
    assert.equal(stats2.counts.sent, 3, "cumulative count includes the pre-existing row");

    // ── 13. A per-contact provider failure is recorded, doesn't abort the
    // batch, and is NOT charged (only emails actually sent are charged). ──
    const c3 = makeCampaign();
    const { sender: sender3, calls: calls3 } = makeFakeSender({ failTo: new Set(["bob@example.com"]) });
    markCampaignSending(tid, c3.id);
    const balanceBefore3 = getEmailBalanceCents(tid);
    await runCampaignSend(tid, c3.id, fakeBaseUrl, { sender: sender3 });
    assert.equal(calls3.length, 3, "alice, bob, and erin were all attempted");
    const rows3 = tdb.select().from(campaignSends).where(eq(campaignSends.campaignId, c3.id)).all();
    const aliceRow3 = rows3.find((r) => r.email === "alice@example.com")!;
    const bobRow3 = rows3.find((r) => r.email === "bob@example.com")!;
    const erinRow3 = rows3.find((r) => r.email === "erin@example.com")!;
    assert.equal(aliceRow3.status, "sent");
    assert.equal(bobRow3.status, "failed");
    assert.equal(bobRow3.error, "simulated provider failure");
    assert.equal(bobRow3.providerMessageId, null);
    assert.equal(erinRow3.status, "sent");
    assert.equal(getRow(c3.id).status, "sent", "a partial failure still finalizes the campaign (not 'failed')");
    const stats3 = JSON.parse(getRow(c3.id).stats!) as { counts: Record<string, number> };
    assert.equal(stats3.counts.sent, 2, "alice + erin");
    assert.equal(stats3.counts.failed, 1, "bob");
    // Charged for the TWO successfully-sent emails only — bob's failure is free.
    assert.equal(getEmailBalanceCents(tid), balanceBefore3 - costForRecipients(2));

    // ── 14. A €0 price never calls (and so never throws from)
    // recordCreditSpend, which rejects cents <= 0. ──
    const c4 = makeCampaign();
    markCampaignSending(tid, c4.id);
    setEmailPricePer1000Cents(0);
    const ledgerCountBefore4 = listLedger(tid, 1000).length;
    const balanceBefore4 = getEmailBalanceCents(tid);
    await assert.doesNotReject(runCampaignSend(tid, c4.id, fakeBaseUrl, { sender: makeFakeSender().sender }));
    assert.equal(getRow(c4.id).status, "sent", "a 0-cost send still completes normally");
    assert.equal(listLedger(tid, 1000).length, ledgerCountBefore4, "no ledger row written for a 0-cost batch");
    assert.equal(getEmailBalanceCents(tid), balanceBefore4, "balance unchanged at price 0");
    setEmailPricePer1000Cents(DEFAULT_EMAIL_PRICE_PER_1000_CENTS);

    // ── 15. Tag-audience matching: only erin (tagged 'vip') is sent to. ──
    const c5 = makeCampaign({ audience: JSON.stringify({ kind: "tag", tag: "vip" }) });
    markCampaignSending(tid, c5.id);
    const { sender: sender5, calls: calls5 } = makeFakeSender();
    await runCampaignSend(tid, c5.id, fakeBaseUrl, { sender: sender5 });
    assert.equal(calls5.length, 1);
    assert.equal(calls5[0].to, erin.email);

    // ── 16. runCampaignSend never throws even on a completely bogus
    // campaignId, and is a silent no-op (nothing to guard against). ──
    await assert.doesNotReject(runCampaignSend(tid, 9_999_999, fakeBaseUrl, {}));

    // ── 17. Review fix 2 (onConflictDoNothing): a racing duplicate write
    // for the SAME (campaign_id, contact_id) — simulated deterministically
    // by having the fake sender itself insert a competing campaign_sends
    // row as a side effect of send() for alice, landing BETWEEN this run's
    // resolveEligibleRecipients (which still saw alice as eligible — no
    // campaign_sends row existed for c6 yet when it ran) and this run's own
    // post-send insert for alice — hits idx_campaign_sends_unique and
    // becomes a DB no-op (changes === 0). That contact must NOT be
    // double-counted/double-charged for this run. ──
    const c6 = makeCampaign();
    markCampaignSending(tid, c6.id);
    const raceCalls: CampaignMessage[] = [];
    let raceN = 0;
    const raceSender: CampaignSender = {
      async registerDomain() {
        return { ok: true, id: "race-domain-id", dnsRecords: [] };
      },
      async getDomainStatus() {
        return { ok: true, status: { state: "verified", dnsRecords: [] } };
      },
      async send(_fromDomain, _from, msg) {
        raceCalls.push(msg);
        if (msg.to === alice.email) {
          // A "racing" second runCampaignSend invocation recording alice's
          // send first — landed after this run's own eligibility check but
          // before this run's own insert below.
          tdb
            .insert(campaignSends)
            .values({
              campaignId: c6.id,
              contactId: alice.id,
              email: alice.email,
              providerMessageId: "racing-run-msg",
              status: "sent",
            })
            .run();
        }
        raceN++;
        return { ok: true, providerId: `<race-${raceN}-${msg.to}@mail.example.com>` };
      },
    };
    const balanceBefore6 = getEmailBalanceCents(tid);
    await runCampaignSend(tid, c6.id, fakeBaseUrl, { sender: raceSender });
    assert.equal(
      raceCalls.length,
      3,
      "alice + bob + erin were all attempted (the pre-filter didn't exclude alice — the race happens after it)",
    );
    const rows6 = tdb.select().from(campaignSends).where(eq(campaignSends.campaignId, c6.id)).all();
    const aliceRows6 = rows6.filter((r) => r.email === alice.email);
    assert.equal(
      aliceRows6.length,
      1,
      "still exactly one campaign_sends row for alice — this run's own insert was a no-op against the unique index",
    );
    assert.equal(aliceRows6[0].providerMessageId, "racing-run-msg", "the racing row won; this run never overwrote it");
    assert.equal(
      getEmailBalanceCents(tid),
      balanceBefore6 - costForRecipients(2),
      "charged for bob + erin only — alice's conflicted insert must not be double-charged",
    );

    // ── 18. Direct proof the DB actually enforces UNIQUE(campaign_id,
    // contact_id) (idx_campaign_sends_unique — schema.ts's Drizzle mirror +
    // tenant.ts's ensureTenantTables DDL, same name, kept in sync): a raw
    // duplicate insert WITHOUT onConflictDoNothing throws; the SAME insert
    // WITH it is a silent no-op (changes === 0) — exactly what send.ts
    // relies on above. ──
    const c7 = makeCampaign();
    tdb.insert(campaignSends).values({ campaignId: c7.id, contactId: bob.id, email: bob.email, status: "sent" }).run();
    assert.throws(
      () =>
        tdb
          .insert(campaignSends)
          .values({ campaignId: c7.id, contactId: bob.id, email: bob.email, status: "sent" })
          .run(),
      /UNIQUE constraint failed/i,
      "campaign_sends must enforce UNIQUE(campaign_id, contact_id) at the DB level",
    );
    const noopResult = tdb
      .insert(campaignSends)
      .values({ campaignId: c7.id, contactId: bob.id, email: bob.email, status: "sent" })
      .onConflictDoNothing()
      .run();
    assert.equal(noopResult.changes, 0, "onConflictDoNothing makes the duplicate insert a silent no-op instead of throwing");

    console.log("send.test.ts: batch-engine + precheck assertions passed");
  } finally {
    cleanup();
  }

  // ── normalizeMessageId (pure) ──
  assert.equal(normalizeMessageId("<20260101.abc@mail.example.com>"), "20260101.abc@mail.example.com");
  assert.equal(normalizeMessageId("ALREADY-UNBRACKETED@Mail.Example.com"), "already-unbracketed@mail.example.com");
  assert.equal(normalizeMessageId("  <Mixed-Case@Mail.Example.com>  "), "mixed-case@mail.example.com");
  assert.equal(normalizeMessageId("<no-trailing-bracket@mail.example.com"), "no-trailing-bracket@mail.example.com");

  // ── sanitizeHeader (pure) ──
  assert.equal(sanitizeHeader("Clean Name"), "Clean Name");
  assert.equal(sanitizeHeader("Evil\r\nInjected-Header: x"), "EvilInjected-Header: x");
  assert.equal(sanitizeHeader("  Trimmed  \n"), "Trimmed");

  console.log("send.test.ts: all assertions passed");
})();
