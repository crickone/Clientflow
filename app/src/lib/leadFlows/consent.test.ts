// Run: npm test -- src/lib/leadFlows/consent.test.ts
//
// Marketing consent for leads, against a scratch tenant with a fake sender:
// Long-term nurture needs it; consenting adds the address to Contacts; every
// nurture email carries the signed unsubscribe link; an unsubscribe clears
// consent and stops the flows; a staff tick never overrides an unsubscribe;
// a bounce only stops the emails; a lead posted in with consent has it.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq, sql } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead, getLead } = requireLocal("../leads") as typeof import("../leads");
  const runs = requireLocal("./runs") as typeof import("./runs");
  const consent = requireLocal("./consent") as typeof import("./consent");
  const { isConsentYes } = requireLocal("./consentModel") as typeof import("./consentModel");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const { suppress } = requireLocal("../marketing/suppress") as typeof import("../marketing/suppress");
  const { parseUnsubscribeToken } = requireLocal("../marketing/unsubscribeToken") as typeof import("../marketing/unsubscribeToken");

  const s = h.makeScratchTenant("lead-flow-consent-test");
  const fake = h.installFakeTransport();
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const WED_10 = Date.parse("2030-01-16T10:00:00Z");
      h.fakeClock(WED_10);
      const queued = (leadId: number) =>
        tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"))).all();
      h.setFlowEnabled(s.tid, "lead_nurture", true);
      h.setFlowEnabled(s.tid, "lead_no_answer", true);

      ok(isConsentYes(true) && isConsentYes("Yes") && isConsentYes("1") && isConsentYes("on"), "yes in its usual forms");
      ok(!isConsentYes(false) && !isConsentYes("no") && !isConsentYes(undefined) && !isConsentYes(""), "and nothing else");

      const { lead } = upsertLead({ source: "manual", fullName: "Con Sent", email: "consent@example.com", phone: "+353870000006" });
      ok(runs.startFlow(lead.id, "lead_nurture").skipped === "no marketing consent", "no consent: no nurture");

      ok(consent.setLeadMarketingConsent(lead.id, true, "staff").ok, "staff records a yes");
      ok(getLead(lead.id)!.marketingConsentAt === WED_10 && getLead(lead.id)!.marketingConsentSource === "staff", "when and how are kept");
      const contact = tdb.select().from(schema.contacts).where(sql`lower(${schema.contacts.email}) = 'consent@example.com'`).get();
      ok(!!contact && JSON.parse(contact.tags ?? "[]").includes("leads") && contact.status === "subscribed", "the address joins Contacts, tagged leads");

      // The nurture email carries the signed unsubscribe link.
      ok(runs.startFlow(lead.id, "lead_nurture").runId != null, "with consent, nurture starts");
      await dispatchDueAutomationQueue(s.tid, WED_10, "http://app.test");
      const email = fake.sent.find((x) => x.to === "email");
      ok(!!email, "the first nurture email went");
      const link = /http:\/\/app\.test\/u\/([A-Za-z0-9_\-.]+)/.exec(email!.html ?? "");
      ok(!!link && parseUnsubscribeToken(link[1])?.contactId === contact!.id, "its link is a valid token for this contact");
      ok(/Unsubscribe: http:\/\/app\.test\/u\//.test(email!.text ?? ""), "and the plain-text part has it too");

      // An unsubscribe clears consent and stops the flows.
      runs.startFlow(lead.id, "lead_no_answer");
      suppress(s.tid, "consent@example.com", "unsubscribe");
      ok(getLead(lead.id)!.marketingConsentAt === null, "consent cleared");
      ok(queued(lead.id).length === 0, "every flow stopped");
      ok(!consent.setLeadMarketingConsent(lead.id, true, "staff").ok, "a staff tick cannot override their unsubscribe");
      ok(consent.setLeadMarketingConsent(lead.id, true, "form").ok && getLead(lead.id)!.marketingConsentAt !== null, "a fresh yes from them can");
      ok(!tdb.select().from(schema.suppressions).where(sql`lower(${schema.suppressions.email}) = 'consent@example.com'`).get(), "and lifts the unsubscribe");

      // A bounce stops the emails only.
      runs.startFlow(lead.id, "lead_nurture");
      runs.startFlow(lead.id, "lead_no_answer");
      tdb.insert(schema.automationQueue).values({ triggerKey: "lead_no_answer", leadId: lead.id, kind: "message", channel: "email", subject: "x", body: "x", sendTo: "consent@example.com", dueAt: new Date(WED_10 + 60_000) }).run();
      suppress(s.tid, "consent@example.com", "bounce");
      ok(queued(lead.id).every((q) => q.channel !== "email") && queued(lead.id).some((q) => q.channel === "whatsapp"), "a bounce cancels the emails and leaves the WhatsApps");
      ok(getLead(lead.id)!.marketingConsentAt !== null, "a bounce is not an unsubscribe");

      // No secret, no marketing email.
      tdb.delete(schema.suppressions).run();
      const { lead: noSecret } = upsertLead({ source: "manual", fullName: "No Secret", email: "nosecret@example.com" });
      consent.setLeadMarketingConsent(noSecret.id, true, "api");
      runs.startFlow(noSecret.id, "lead_nurture");
      const saved = process.env.EMAIL_TOKEN_SECRET;
      delete process.env.EMAIL_TOKEN_SECRET;
      try {
        await dispatchDueAutomationQueue(s.tid, WED_10 + 1, "http://app.test");
      } finally {
        if (saved === undefined) delete process.env.EMAIL_TOKEN_SECRET;
        else process.env.EMAIL_TOKEN_SECRET = saved;
      }
      const blocked = tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, noSecret.id), eq(schema.automationQueue.status, "failed"))).get();
      ok(!!blocked && /unsubscribe link/i.test(blocked.error ?? ""), "without the unsubscribe secret a nurture email is never sent");

      // Withdrawn consent stops nurture.
      consent.setLeadMarketingConsent(noSecret.id, false, "staff");
      ok(queued(noSecret.id).length === 0, "a no stops Long-term nurture");

      // A STOP on WhatsApp withdraws the lead's marketing consent and stops nurture.
      const { lead: stopper } = upsertLead({ source: "manual", fullName: "Stop Per", email: "stopper@example.com", phone: "+353870000016" });
      consent.setLeadMarketingConsent(stopper.id, true, "form");
      runs.startFlow(stopper.id, "lead_nurture");
      ok(queued(stopper.id).length > 0, "nurture is queued before the STOP");
      ok(!consent.withdrawConsentOnStopReply(stopper.id, "Thanks, see you Thursday"), "an ordinary reply changes nothing");
      ok(getLead(stopper.id)!.marketingConsentAt !== null, "consent stays after an ordinary reply");
      ok(consent.withdrawConsentOnStopReply(stopper.id, " Stop. "), "STOP withdraws consent");
      ok(getLead(stopper.id)!.marketingConsentAt === null && getLead(stopper.id)!.marketingConsentSource === null, "consent cleared");
      ok(queued(stopper.id).length === 0, "and nurture stopped");

      // Posted in with consent.
      const { lead: posted } = upsertLead({ source: "website", sourceLeadId: "website:posted@example.com", fullName: "Posted In", email: "posted@example.com", marketingConsent: "api" });
      ok(getLead(posted.id)!.marketingConsentSource === "api", "a lead posted in with consent has it");

      // A replayed post (same source and sourceLeadId) never lifts the person's own unsubscribe.
      const replay = { source: "website", sourceLeadId: "website:replay@example.com", fullName: "Re Play", email: "replay@example.com" };
      const { lead: first } = upsertLead(replay);
      ok(getLead(first.id)!.marketingConsentAt === null, "no consent on the first post");
      suppress(s.tid, "replay@example.com", "unsubscribe");
      const again = upsertLead({ ...replay, marketingConsent: "api" });
      ok(!again.created && again.lead.id === first.id, "the re-post is the same lead");
      ok(getLead(first.id)!.marketingConsentAt === null, "a re-post with a yes leaves consent empty after an unsubscribe");
      ok(!!tdb.select().from(schema.suppressions).where(sql`lower(${schema.suppressions.email}) = 'replay@example.com'`).get(), "and the unsubscribe stays");

      // An operator's do-not-email is never lifted by a yes.
      const { lead: manual } = upsertLead({ source: "manual", fullName: "Do Notmail", email: "manual@example.com" });
      suppress(s.tid, "manual@example.com", "manual");
      ok(!consent.setLeadMarketingConsent(manual.id, true, "api").ok, "an api yes cannot lift a manual suppression");
      ok(!consent.setLeadMarketingConsent(manual.id, true, "form").ok, "nor a form yes");
      ok(getLead(manual.id)!.marketingConsentAt === null, "no consent recorded");
      ok(!!tdb.select().from(schema.suppressions).where(sql`lower(${schema.suppressions.email}) = 'manual@example.com'`).get(), "the manual suppression stays");
    });
    console.log(`consent: ${n} checks passed.`);
  } finally {
    fake.restore();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
