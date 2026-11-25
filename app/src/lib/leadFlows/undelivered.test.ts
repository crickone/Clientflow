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
      fake.restore();
      fake = h.installFakeTransport();

      // An outage, a rate limit or an expired token is not the lead's fault: a failed row, no move.
      const t0 = WED_10 + 2 * DAY + 10;
      for (const [tag, text, phone] of [
        ["six", "WhatsApp send failed (503): service unavailable", "+353870000031"],
        ["sixb", "fetch failed", "+353870000032"],
        ["sixc", "WhatsApp send failed (429): Too many requests", "+353870000033"],
      ] as const) {
        const lead = enquiry(tag, { email: `${tag}@example.com`, phone });
        fake.failWhatsAppWith.set(lead.id, text);
        await dispatch(t0);
        ok(msgRows(lead.id).some((r) => r.channel === "whatsapp" && r.status === "failed" && r.error === text), `${tag}: the row fails with the provider's reason`);
        ok(getLead(lead.id)!.stageId !== undelivered.id, `${tag}: the card does not move`);
        ok(msgRows(lead.id).filter((r) => r.status === "queued" && r.channel === "whatsapp").length > 0, `${tag}: the rest of the flow stays on WhatsApp`);
      }

      // A late "failed" status after the lead replied (the run is over) changes nothing.
      const stage = requireLocal("../pipeline/stage") as typeof import("../pipeline/stage");
      const seven = enquiry("seven", { email: "seven@example.com", phone: "+353870000018" });
      await dispatch(t0 + 1);
      const sevenWa = msgRows(seven.id).find((r) => r.channel === "whatsapp" && r.status === "sent")!;
      stage.onInboundFromLead(seven.id, { text: "Hi, yes I saw it", channel: "whatsapp" });
      const sevenStage = getLead(seven.id)!.stageId;
      await onWhatsAppDeliveryFailed(s.tid, sevenWa.providerMessageId!);
      ok(getLead(seven.id)!.stageId === sevenStage && sevenStage !== undelivered.id, "a failed status after a reply does not move the card");
      ok(notes(seven.id).length === 0, "and adds no note");
      ok(!tdb.select().from(schema.automationQueue).where(eq(schema.automationQueue.id, sevenWa.id)).get()!.error?.startsWith("Undelivered:"), "nor marks the message");

      // Two due WhatsApps of one run in one batch: the first is undeliverable, so the second goes by email, not WhatsApp.
      tdb.delete(schema.automationMessages).where(eq(schema.automationMessages.triggerKey, "new_lead")).run();
      tdb.insert(schema.automationMessages)
        .values([
          { triggerKey: "new_lead", position: 0, channel: "whatsapp", template: "First message for [FIRST_NAME].", delayValue: 0, delayUnit: "days" },
          { triggerKey: "new_lead", position: 1, channel: "whatsapp", template: "Second message for [FIRST_NAME].", delayValue: 0, delayUnit: "days" },
        ])
        .run();
      const eight = enquiry("eight", { email: "eight@example.com", phone: "+353870000019" });
      fake.failWhatsAppFor.add(eight.id);
      const sentBefore = fake.sent.length;
      await dispatch(t0 + 2);
      const eightRows = msgRows(eight.id).sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
      ok(eightRows.length === 2 && eightRows[0].status === "failed" && /^Undelivered:/.test(eightRows[0].error ?? ""), "the first WhatsApp is marked undelivered");
      ok(eightRows[1].channel === "email" && eightRows[1].status === "sent" && eightRows[1].sendTo === "eight@example.com", "the second row went by email, from its fresh state");
      ok(fake.sent.slice(sentBefore).filter((x) => x.to === "lead" && x.leadId === eight.id).length === 0, "no WhatsApp reached the lead");
      ok(fake.sent.slice(sentBefore).some((x) => x.to === "email" && x.address === "eight@example.com" && /Second message/.test(x.text)), "the email carries the second message");
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
