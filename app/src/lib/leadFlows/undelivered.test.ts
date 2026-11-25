// Run: npm test -- src/lib/leadFlows/undelivered.test.ts
//
// When a flow's first WhatsApp can't be delivered (the send fails, or the
// provider later reports it failed), the card moves to Message undelivered
// and the rest of the flow goes by email. Only the first WhatsApp of a run
// counts, a repeated status changes nothing, no email means the WhatsApps
// stop, and WhatsApp not being connected is never treated as undelivered.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead, getLead, getLeadMessages } = requireLocal("../leads") as typeof import("../leads");
  const { activeRun } = requireLocal("./runs") as typeof import("./runs");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const { onWhatsAppDeliveryFailed } = requireLocal("./undelivered") as typeof import("./undelivered");
  const { listStages } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");

  const s = h.makeScratchTenant("lead-flow-undelivered-test");
  let fake = h.installFakeTransport();
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
      const dispatch = (at: number) => dispatchDueAutomationQueue(s.tid, at, "http://app.test");
      const msgRows = (leadId: number) =>
        tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.kind, "message"))).all();
      const notes = (leadId: number) => getLeadMessages(leadId).filter((m) => m.direction === "note");
      const undelivered = listStages().find((c) => c.systemKey === "undelivered")!;

      h.setFlowEnabled(s.tid, "new_lead", true);
      tdb.insert(schema.automationMessages)
        .values([
          { triggerKey: "new_lead", position: 0, channel: "whatsapp", template: "Hi [FIRST_NAME], thanks for getting in touch.", delayValue: 0, delayUnit: "days" },
          { triggerKey: "new_lead", position: 1, channel: "email", subject: "Thanks", template: "Hi [FIRST_NAME], thanks for your enquiry.", delayValue: 0, delayUnit: "days" },
          { triggerKey: "new_lead", position: 2, channel: "whatsapp", template: "Just checking you saw our message.", delayValue: 2, delayUnit: "days" },
          { triggerKey: "new_lead", position: 3, channel: "whatsapp", template: "Any questions, ask here.", delayValue: 4, delayUnit: "days" },
        ])
        .run();
      const enquiry = (tag: string, contact: { email?: string; phone?: string }) =>
        upsertLead({ source: "website", sourceLeadId: `website:${tag}`, fullName: `Lead ${tag}`, ...contact }).lead;

      // The send fails on the first WhatsApp.
      const one = enquiry("one", { email: "one@example.com", phone: "+353870000011" });
      fake.failWhatsAppFor.add(one.id);
      await dispatch(WED_10);
      ok(getLead(one.id)!.stageId === undelivered.id, "moved to Message undelivered");
      const rest = msgRows(one.id).filter((r) => r.status === "queued");
      ok(rest.length === 2 && rest.every((r) => r.channel === "email" && r.sendTo === "one@example.com" && !!r.subject), "the remaining WhatsApps go by email");
      ok(fake.sent.some((x) => x.to === "email" && x.address === "one@example.com"), "the welcome email still went");
      ok(notes(one.id).some((m) => /could not be delivered/.test(m.content)), "a note on the lead says so");
      ok(activeRun(one.id, "new_lead") !== null, "the flow keeps going");

      // The provider reports a sent first WhatsApp as failed.
      const two = enquiry("two", { email: "two@example.com", phone: "+353870000012" });
      await dispatch(WED_10 + 1);
      const firstWa = msgRows(two.id).find((r) => r.channel === "whatsapp" && r.status === "sent")!;
      ok(!!firstWa.providerMessageId && getLead(two.id)!.stageId !== undelivered.id, "sent, not moved yet");
      await onWhatsAppDeliveryFailed(s.tid, firstWa.providerMessageId!);
      ok(getLead(two.id)!.stageId === undelivered.id, "a failed delivery status moves the card");
      await onWhatsAppDeliveryFailed(s.tid, firstWa.providerMessageId!);
      ok(notes(two.id).length === 1, "the same status twice changes nothing more");

      // A later WhatsApp failing does not count.
      const three = enquiry("three", { email: "three@example.com", phone: "+353870000013" });
      await dispatch(WED_10 + 2);
      fake.failWhatsAppFor.add(three.id);
      clock.set(WED_10 + 2 * DAY);
      await dispatch(WED_10 + 2 * DAY);
      ok(msgRows(three.id).some((r) => r.channel === "whatsapp" && r.status === "failed") && getLead(three.id)!.stageId !== undelivered.id, "a later WhatsApp failing does not move the card");

      // No email: the WhatsApps stop.
      const four = enquiry("four", { phone: "+353870000014" });
      fake.failWhatsAppFor.add(four.id);
      await dispatch(WED_10 + 2 * DAY + 1);
      ok(msgRows(four.id).filter((r) => r.status === "queued").length === 0 && getLead(four.id)!.stageId === undelivered.id, "no email address: moved, and the WhatsApps stop");

      // WhatsApp not connected is not undelivered.
      fake.restore();
      fake = h.installFakeTransport({ connected: false });
      const five = enquiry("five", { email: "five@example.com", phone: "+353870000015" });
      await dispatch(WED_10 + 2 * DAY + 2);
      ok(getLead(five.id)!.stageId !== undelivered.id && msgRows(five.id).some((r) => r.status === "failed"), "not connected: a visible failure, no move");
    });
    console.log(`undelivered: ${n} checks passed.`);
  } finally {
    fake.restore();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
