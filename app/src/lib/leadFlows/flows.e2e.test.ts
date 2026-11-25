// Run: npm test -- src/lib/leadFlows/flows.e2e.test.ts
//
// End to end, on a scratch business set up like Optimal Health (Monday to
// Saturday 09:00-18:00, a default assignee, a WhatsApp alert number), with
// a fake sender and a fake clock. Leads run through each flow from the way
// it starts to the way it ends, through the same entry points the app uses.
// Every message to a lead is sent inside sending hours, and nothing reaches
// a real provider.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, asc, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead, getLead } = requireLocal("../leads") as typeof import("../leads");
  const stage = requireLocal("../pipeline/stage") as typeof import("../pipeline/stage");
  const { listStages, resolveStageIdByRole } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");
  const calls = requireLocal("./calls") as typeof import("./calls");
  const runs = requireLocal("./runs") as typeof import("./runs");
  const { saveLeadFlowSettings } = requireLocal("./settings") as typeof import("./settings");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const { nextSendTime } = requireLocal("./sendingWindow") as typeof import("./sendingWindow");
  const { suppress } = requireLocal("../marketing/suppress") as typeof import("../marketing/suppress");

  const s = h.makeScratchTenant("lead-flow-e2e-test");
  const fake = h.installFakeTransport();
  const staffEmail = "e2e-staff@example.com";
  const dropStaff = () => {
    const u = controlSqlite.prepare("SELECT id FROM users WHERE email = ?").get(staffEmail) as { id: number } | undefined;
    if (u) {
      controlSqlite.prepare("DELETE FROM memberships WHERE user_id = ?").run(u.id);
      controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    }
  };
  dropStaff();
  const staffId = (controlSqlite.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, 'E2e Staff', 'x') RETURNING id").get(staffEmail) as { id: number }).id;
  controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, 'staff')").run(staffId, s.tid);
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const q = schema.automationQueue;
      const DAY = 86_400_000;
      const OH = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" };
      saveLeadFlowSettings({ window: OH, defaultAssigneeUserId: staffId, alertWhatsAppTo: "+353870000099", alertUserId: null });
      for (const k of ["new_lead", "lead_no_answer", "lead_call_back", "lead_call_booked", "lead_thinking", "lead_nurture"]) h.setFlowEnabled(s.tid, k, true);
      const clock = h.fakeClock(Date.parse("2030-01-19T19:30:00Z")); // a Saturday evening
      const col = (k: string) => listStages().find((c) => c.systemKey === k)!.id;
      const engaged = resolveStageIdByRole("engaged")!;

      /** Run the ticker at every due time up to `until`, the way it runs every minute. */
      async function runUntil(until: number) {
        for (let i = 0; i < 1000; i++) {
          const next = tdb.select({ dueAt: q.dueAt }).from(q).where(eq(q.status, "queued")).orderBy(asc(q.dueAt)).limit(1).get();
          if (!next || next.dueAt.getTime() > until) break;
          const at = Math.max(next.dueAt.getTime(), clock.now());
          clock.set(at);
          await dispatchDueAutomationQueue(s.tid, at, "http://app.test");
        }
        clock.set(Math.max(clock.now(), until));
      }
      const sent = (leadId: number) => tdb.select().from(q).where(and(eq(q.leadId, leadId), eq(q.kind, "message"), eq(q.status, "sent"))).all();
      const toNumber = (prefix: string) => fake.sent.some((x) => x.to === "number" && x.address === "+353870000099" && x.text.startsWith(prefix));

      // 1. A website enquiry on a Saturday evening: New lead, then Long-term nurture, then a reply.
      const { lead: aoife } = upsertLead({
        source: "website",
        sourceLeadId: "website:e2e-aoife@example.com",
        fullName: "Aoife Example",
        email: "e2e-aoife@example.com",
        phone: "+353870000040",
        therapyInterest: "Hyperbaric oxygen",
        marketingConsent: "form",
      });
      ok(getLead(aoife.id)!.assignedUserId === staffId, "assigned to the default person");
      await runUntil(clock.now());
      ok(toNumber("New lead: Aoife Example, From the website."), "the alert number hears at once");
      ok(sent(aoife.id).length === 0, "the lead hears nothing on a Saturday evening");
      await runUntil(Date.parse("2030-01-21T09:00:00Z"));
      ok(sent(aoife.id).some((r) => r.channel === "whatsapp" && r.sentAt!.getTime() === Date.parse("2030-01-21T09:00:00Z")), "the first WhatsApp goes Monday at 9");
      await runUntil(Date.parse("2030-02-05T09:00:00Z"));
      ok(sent(aoife.id).filter((r) => r.triggerKey === "new_lead" && r.channel === "whatsapp").length === 3, "New lead: all three WhatsApps went");
      ok(getLead(aoife.id)!.stageId === col("nurture"), "no reply: Long-term nurture");
      ok(runs.leadFlowStatus(aoife.id).flow === "Long-term nurture", "its flow runs, because she agreed to marketing");
      const nurtureMail = fake.sent.filter((x) => x.to === "email" && x.address === "e2e-aoife@example.com").at(-1);
      ok(!!nurtureMail && /http:\/\/app\.test\/u\//.test(nurtureMail.html ?? ""), "the nurture email carries the unsubscribe link");
      stage.onInboundFromLead(aoife.id, { text: "Yes, I'd like to book an HBOT session next week", channel: "whatsapp" });
      ok(getLead(aoife.id)!.stageId === engaged && runs.leadFlowStatus(aoife.id).flow === null, "a reply: Hot lead, and nurture stops");
      await runUntil(clock.now());
      ok(toNumber('Hot lead: Aoife Example replied: "Yes, I\'d like to book'), "the alert number hears she is hot");

      // 2. A Facebook lead: no answer, a call-back day, not reached, then a call at a time, then booked.
      clock.set(Date.parse("2030-02-05T11:00:00Z")); // Tuesday
      const { lead: brian } = upsertLead({ source: "facebook", sourceLeadId: "fb-e2e-brian", fullName: "Brian Example", phone: "+353870000041" });
      calls.logCall(brian.id, { outcome: "no_answer" }, staffId);
      await runUntil(clock.now());
      ok(sent(brian.id).filter((r) => r.triggerKey === "lead_no_answer").length === 1, "No answer: the tried-to-ring-you WhatsApp at once");
      stage.onInboundFromLead(brian.id, { text: "Ring me Thursday", channel: "whatsapp" });
      calls.scheduleCall(brian.id, { day: "2030-02-07" }, staffId);
      await runUntil(Date.parse("2030-02-07T09:00:00Z"));
      ok(toNumber("Call back today: Brian Example"), "Thursday morning: the call-back reminder");
      await runUntil(Date.parse("2030-02-08T09:00:00Z"));
      ok(runs.leadFlowStatus(brian.id).flow === "Call back later", "not reached on Thursday: Call back later starts");
      ok(sent(brian.id).some((r) => r.triggerKey === "lead_call_back" && r.sentAt!.getTime() === Date.parse("2030-02-08T09:00:00Z")), "its first message Friday at 9");
      const callAt = Date.parse("2030-02-11T10:30:00Z"); // Monday 10:30
      calls.scheduleCall(brian.id, { at: callAt }, staffId);
      await runUntil(callAt);
      const callMsgs = sent(brian.id).filter((r) => r.triggerKey === "lead_call_booked");
      ok(callMsgs.length === 2 && callMsgs.some((r) => r.sentAt!.getTime() === callAt - 3_600_000), "Call booked: the confirmation and the reminder an hour before");
      ok(tdb.select().from(schema.notifications).all().some((x) => x.title === "Call in 10 minutes: Brian Example" && x.forUserId === staffId), "the assignee's alert 10 minutes before");
      calls.logCall(brian.id, { outcome: "booked" }, staffId);
      ok(getLead(brian.id)!.stageId === resolveStageIdByRole("booked") && runs.leadFlowStatus(brian.id).flow === null, "Booked a treatment: in the booked column, no flow");

      // 3. Thinking about it: a question is not a yes, so Long-term nurture a week later; then an unsubscribe.
      const { lead: ciara } = upsertLead({
        source: "website",
        sourceLeadId: "website:e2e-ciara@example.com",
        fullName: "Ciara Example",
        email: "e2e-ciara@example.com",
        phone: "+353870000042",
        marketingConsent: "form",
      });
      calls.logCall(ciara.id, { outcome: "thinking" }, staffId);
      await runUntil(clock.now() + 6 * DAY);
      ok(sent(ciara.id).filter((r) => r.triggerKey === "lead_thinking").length === 1, "Thinking about it: the first check-in after 5 days");
      stage.onInboundFromLead(ciara.id, { text: "How much is a session?", messageId: 9001 });
      stage.onLeadReplyTriaged(ciara.id, 9001, { category: "faq", priority: "normal" });
      ok(getLead(ciara.id)!.stageId === col("thinking"), "a question is not a yes: she stays");
      await runUntil(clock.now() + 7 * DAY + 1);
      ok(getLead(ciara.id)!.stageId === col("nurture") && runs.leadFlowStatus(ciara.id).flow === "Long-term nurture", "a week on: Long-term nurture");
      suppress(s.tid, "e2e-ciara@example.com", "unsubscribe");
      ok(runs.leadFlowStatus(ciara.id).flow === null && getLead(ciara.id)!.marketingConsentAt === null, "an unsubscribe stops it");

      // 4. The first WhatsApp never arrives: Message undelivered, the rest by email.
      const { lead: dara } = upsertLead({ source: "website", sourceLeadId: "website:e2e-dara@example.com", fullName: "Dara Example", email: "e2e-dara@example.com", phone: "+353870000043" });
      fake.failWhatsAppFor.add(dara.id);
      await runUntil(clock.now() + DAY);
      const daraLeft = tdb.select().from(q).where(and(eq(q.leadId, dara.id), eq(q.status, "queued"), eq(q.kind, "message"))).all();
      ok(getLead(dara.id)!.stageId === col("undelivered") && daraLeft.length > 0 && daraLeft.every((r) => r.channel === "email"), "Message undelivered, and the rest goes by email");

      // Every message to a lead went inside sending hours, and nothing went anywhere real.
      const allSent = tdb.select().from(q).where(and(eq(q.kind, "message"), eq(q.status, "sent"))).all();
      ok(allSent.length >= 10 && allSent.every((r) => nextSendTime(r.sentAt!.getTime(), OH) === r.sentAt!.getTime()), "every message to a lead went Monday to Saturday, 09:00-18:00");
      ok(fake.sent.every((x) => x.to !== "number" || x.address === "+353870000099"), "staff alerts only ever went to the alert number");
    });
    console.log(`flows.e2e: ${n} checks passed.`);
  } finally {
    fake.restore();
    dropStaff();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
