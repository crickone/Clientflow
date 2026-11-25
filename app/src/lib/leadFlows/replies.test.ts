// Run: npm test -- src/lib/leadFlows/replies.test.ts
//
// The Thinking about it reply check, with the triage faked (no AI): a reply
// stops the flow and waits for the triage; wanting to book makes a hot
// lead with an alert; anything else moves them to Long-term nurture 7 days
// later unless a person acts; no triage answer in 15 minutes counts as
// wanting to talk; with the flow off a reply is an ordinary reply; and an
// email reply stops a flow like any other.
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
  const stage = requireLocal("../pipeline/stage") as typeof import("../pipeline/stage");
  const { listStages, resolveStageIdByRole } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");
  const { saveLeadFlowSettings } = requireLocal("./settings") as typeof import("./settings");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const consent = requireLocal("./consent") as typeof import("./consent");

  const s = h.makeScratchTenant("lead-flow-replies-test");
  const fake = h.installFakeTransport();
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const MIN = 60_000;
      const DAY = 86_400_000;
      const WED_10 = Date.parse("2030-01-16T10:00:00Z");
      const clock = h.fakeClock(WED_10);
      const dispatch = (at: number) => dispatchDueAutomationQueue(s.tid, at, "http://app.test");
      const cols = listStages();
      const thinking = cols.find((c) => c.systemKey === "thinking")!;
      const nurture = cols.find((c) => c.systemKey === "nurture")!;
      const engaged = resolveStageIdByRole("engaged")!;
      const queued = (leadId: number) =>
        tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"))).all();
      saveLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: "+353870000099" });
      h.setFlowEnabled(s.tid, "lead_thinking", true);
      const thinker = (tag: string) => {
        const { lead } = upsertLead({ source: "manual", actor: "user", fullName: `Think ${tag}`, email: `${tag}@example.com`, phone: "+353870000020" });
        stage.setStageToId(lead.id, thinking.id);
        return lead;
      };

      // A reply that is not a yes.
      const a = thinker("maybe");
      ok(queued(a.id).some((q) => q.kind === "message"), "Thinking about it is running");
      stage.onInboundFromLead(a.id, { text: "What is the price of a session?", messageId: 101 });
      ok(getLead(a.id)!.stageId === thinking.id, "the reply does not make them hot on its own");
      ok(queued(a.id).length === 1 && queued(a.id)[0].kind === "reply_check", "the flow stops and waits for the inbox triage");
      stage.onLeadReplyTriaged(a.id, 101, { category: "faq", priority: "normal" });
      const move = queued(a.id);
      ok(move.length === 1 && move[0].kind === "move" && move[0].dueAt.getTime() === WED_10 + 7 * DAY, "a question: Long-term nurture in 7 days");
      clock.set(WED_10 + 7 * DAY);
      await dispatch(WED_10 + 7 * DAY);
      ok(getLead(a.id)!.stageId === nurture.id, "7 days on, in Long-term nurture");
      clock.set(WED_10);

      // A reply that is a yes.
      const b = thinker("yes");
      stage.onInboundFromLead(b.id, { text: "Yes, can I book Thursday?", messageId: 102 });
      stage.onLeadReplyTriaged(b.id, 102, { category: "booking", priority: "normal" });
      ok(getLead(b.id)!.stageId === engaged && queued(b.id).filter((q) => q.kind !== "staff_alert").length === 0, "wants to book: Hot lead, flow over");
      ok(queued(b.id).some((q) => q.kind === "staff_alert" && /Hot lead: Think yes replied: "Yes, can I book Thursday\?"/.test(JSON.parse(q.payload!).whatsappText)), "and the hot-lead alert");

      // No triage answer.
      const c = thinker("silent");
      stage.onInboundFromLead(c.id, { text: "Call me", messageId: 103 });
      await dispatch(WED_10 + 16 * MIN);
      ok(getLead(c.id)!.stageId === engaged, "no triage in 15 minutes: treated as wanting to talk");

      // A person acts before the 7 days are up.
      const d = thinker("acted");
      stage.onInboundFromLead(d.id, { text: "Not sure yet", messageId: 104 });
      stage.onLeadReplyTriaged(d.id, 104, { category: "other", priority: "low" });
      stage.setStageToId(d.id, resolveStageIdByRole("booked")!);
      ok(queued(d.id).length === 0, "a person moving the card cancels the move to nurture");

      // A triage result after a person moved them changes nothing.
      const e = thinker("late");
      stage.onInboundFromLead(e.id, { text: "Maybe", messageId: 105 });
      stage.setStageToId(e.id, resolveStageIdByRole("booked")!);
      stage.onLeadReplyTriaged(e.id, 105, { category: "booking", priority: "high" });
      ok(getLead(e.id)!.stageId === resolveStageIdByRole("booked"), "they stay where the person put them");

      // The flow off: an ordinary reply.
      h.setFlowEnabled(s.tid, "lead_thinking", false);
      const f = thinker("off");
      stage.onInboundFromLead(f.id, { text: "Hello", messageId: 106 });
      ok(getLead(f.id)!.stageId === engaged, "with the flow off, a reply makes them hot straight away");

      // An email reply stops Long-term nurture and makes them hot.
      h.setFlowEnabled(s.tid, "lead_nurture", true);
      const { lead: g } = upsertLead({ source: "manual", actor: "user", fullName: "Mail Reply", email: "mailreply@example.com" });
      consent.setLeadMarketingConsent(g.id, true, "staff");
      stage.setStageToId(g.id, nurture.id);
      ok(queued(g.id).some((q) => q.kind === "message"), "Long-term nurture running");
      stage.onLeadEmailReply(s.tid, "MailReply@Example.com", new Date(), "Thanks, how do I book?");
      ok(queued(g.id).filter((q) => q.kind === "message").length === 0 && getLead(g.id)!.stageId === engaged, "an email reply stops it and makes them hot");
      const { lead: old } = upsertLead({ source: "manual", actor: "user", fullName: "Old Mail", email: "oldmail@example.com" });
      consent.setLeadMarketingConsent(old.id, true, "staff");
      stage.setStageToId(old.id, nurture.id);
      stage.onLeadEmailReply(s.tid, "oldmail@example.com", new Date(Date.now() - 3 * 3_600_000), "old");
      ok(queued(old.id).some((q) => q.kind === "message") && getLead(old.id)!.stageId === nurture.id, "an email from hours ago (a first sync) changes nothing");
    });
    console.log(`replies: ${n} checks passed.`);
  } finally {
    fake.restore();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
