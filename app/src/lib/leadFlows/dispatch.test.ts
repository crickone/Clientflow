// Run: npm test -- src/lib/leadFlows/dispatch.test.ts
//
// The dispatch of lead-flow rows, against a real scratch tenant with a fake
// sender and a fixed clock: due messages go, a message outside sending
// hours waits for the next window, a call reminder that would go late is
// dropped, an unsubscribed address is never mailed, WhatsApp not connected
// fails visibly, the finish move moves the card, and a run with nothing
// left is closed.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead, getLead } = requireLocal("../leads") as typeof import("../leads");
  const runs = requireLocal("./runs") as typeof import("./runs");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const { saveLeadFlowSettings } = requireLocal("./settings") as typeof import("./settings");
  const { listStages } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");

  const s = h.makeScratchTenant("lead-flow-dispatch-test");
  const fake = h.installFakeTransport();
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const DAY = 86_400_000;
      const WED_10 = Date.parse("2030-01-16T10:00:00Z");
      const clock = h.fakeClock(WED_10);
      const rows = (leadId: number) => tdb.select().from(schema.automationQueue).where(eq(schema.automationQueue.leadId, leadId)).all();
      const dispatch = (at: number) => dispatchDueAutomationQueue(s.tid, at, "http://app.test");

      h.setFlowEnabled(s.tid, "lead_no_answer", true);
      const { lead } = upsertLead({ source: "manual", fullName: "Disp Atch", email: "dispatch@example.com", phone: "+353870000003" });
      const run = runs.startFlow(lead.id, "lead_no_answer");

      // The first WhatsApp is due now.
      ok((await dispatch(WED_10)) === 1, "one message sent");
      ok(fake.sent.length === 1 && fake.sent[0].to === "lead" && fake.sent[0].leadId === lead.id, "by WhatsApp to the lead");
      const first = rows(lead.id).find((r) => r.kind === "message" && r.status === "sent")!;
      ok(first.providerMessageId === "fake-1", "the provider's id is kept for delivery statuses");
      ok(tdb.select().from(schema.automationLog).where(eq(schema.automationLog.channel, "whatsapp")).all().length === 1, "the Sent view shows it");

      // Sending hours: the second message comes due on a Saturday evening.
      saveLeadFlowSettings({ window: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: null });
      const second = rows(lead.id).find((r) => r.kind === "message" && r.status === "queued")!;
      const satEvening = Date.parse("2030-01-19T19:00:00Z");
      tdb.update(schema.automationQueue).set({ dueAt: new Date(satEvening) }).where(eq(schema.automationQueue.id, second.id)).run();
      ok((await dispatch(satEvening)) === 0, "nothing goes outside sending hours");
      const waited = rows(lead.id).find((r) => r.id === second.id)!;
      ok(waited.status === "queued" && waited.dueAt.getTime() === Date.parse("2030-01-21T09:00:00Z"), "it waits for Monday at 9, never dropped");

      // A call reminder that sending hours would push past the call is dropped.
      const late = tdb.insert(schema.automationQueue)
        .values({ triggerKey: "lead_call_booked", leadId: lead.id, kind: "message", channel: "whatsapp", body: "reminder", sendTo: lead.phone, dueAt: new Date(satEvening), payload: JSON.stringify({ notAfter: satEvening + 3_600_000 }) })
        .returning({ id: schema.automationQueue.id })
        .get().id;
      await dispatch(satEvening);
      ok(rows(lead.id).find((r) => r.id === late)?.status === "cancelled", "a reminder that would land after the call is dropped");
      saveLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: null });

      // A reminder whose call time has already passed is dropped even inside sending hours.
      const stale = tdb.insert(schema.automationQueue)
        .values({ triggerKey: "lead_call_booked", leadId: lead.id, kind: "message", channel: "whatsapp", body: "stale reminder", sendTo: lead.phone, dueAt: new Date(WED_10), payload: JSON.stringify({ notAfter: WED_10 + 1_000 }) })
        .returning({ id: schema.automationQueue.id })
        .get().id;
      const sentBefore = fake.sent.length;
      await dispatch(WED_10 + 5_000);
      const staleRow = rows(lead.id).find((r) => r.id === stale)!;
      ok(staleRow.status === "cancelled" && /call time has passed/.test(staleRow.error ?? "") && fake.sent.length === sentBefore, "a reminder after the call time is dropped inside sending hours too");

      // An unsubscribed address is never mailed.
      tdb.insert(schema.suppressions).values({ email: "dispatch@example.com", reason: "unsubscribe" }).run();
      const mail = tdb.insert(schema.automationQueue)
        .values({ triggerKey: "new_lead", leadId: lead.id, kind: "message", channel: "email", subject: "Hi", body: "Hello", sendTo: "Dispatch@Example.com", dueAt: new Date(WED_10) })
        .returning({ id: schema.automationQueue.id })
        .get().id;
      await dispatch(WED_10 + 1);
      ok(rows(lead.id).find((r) => r.id === mail)?.status === "cancelled" && !fake.sent.some((x) => x.to === "email"), "suppressed: cancelled, not sent");

      // WhatsApp not connected fails visibly.
      fake.restore();
      const offline = h.installFakeTransport({ connected: false });
      const { lead: off } = upsertLead({ source: "manual", fullName: "Off Line", phone: "+353870000004" });
      runs.startFlow(off.id, "lead_no_answer");
      await dispatch(WED_10 + 2);
      const failed = rows(off.id).find((r) => r.kind === "message" && r.status === "failed");
      ok(!!failed && /WhatsApp is not connected/.test(failed.error ?? "") && offline.sent.length === 0, "not connected: failed with the reason, nothing sent");
      offline.restore();
      tdb.update(schema.automationQueue).set({ status: "cancelled" }).where(eq(schema.automationQueue.leadId, off.id)).run();
      const back = h.installFakeTransport();

      // The finish move moves the card, and the finished run is closed.
      tdb.update(schema.automationQueue).set({ status: "cancelled" }).where(and(eq(schema.automationQueue.leadId, lead.id), eq(schema.automationQueue.kind, "message"), eq(schema.automationQueue.status, "queued"))).run();
      clock.set(WED_10 + 5 * DAY);
      await dispatch(WED_10 + 5 * DAY);
      const nurture = listStages().find((c) => c.systemKey === "nurture")!;
      ok(getLead(lead.id)!.stageId === nurture.id, "No answer ended with no reply: the card is in Long-term nurture");
      const runRow = tdb.select().from(schema.leadFlowRuns).where(eq(schema.leadFlowRuns.id, run.runId!)).get()!;
      ok(runRow.status !== "active", "the run is closed");
      ok(back.sent.length === 0, "the move sends nothing");

      // A deleted lead is never written to.
      const { lead: gone } = upsertLead({ source: "manual", fullName: "Gone Lead", phone: "+353870000005" });
      runs.startFlow(gone.id, "lead_no_answer");
      tdb.delete(schema.leads).where(eq(schema.leads.id, gone.id)).run();
      // Dispatched well after the whole flow came due (it was started at WED_10 + 5 days).
      await dispatch(WED_10 + 12 * DAY);
      ok(rows(gone.id).filter((r) => r.status === "queued").length === 0 && back.sent.length === 0, "a deleted lead's rows are cancelled");
      back.restore();
    });
    console.log(`dispatch: ${n} checks passed.`);
  } finally {
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
