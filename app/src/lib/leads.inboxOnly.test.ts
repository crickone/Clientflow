// Run: npm test -- src/lib/leads.inboxOnly.test.ts
//
// A direct message from someone new is a conversation, not a lead: it is kept
// (so the Inbox has it) but is on no board, has no stage, is never moved,
// followed up, scored or counted. "Add as lead" puts it on the board with a
// new lead's welcome; a card taken off the board and put back keeps its
// column. A Messenger ad form is an enquiry, so it goes on the board.
import "./leadFlows/testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./leadFlows/testing/harness") as typeof import("./leadFlows/testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("./db/tenant") as typeof import("./db/tenant");
  const schema = requireLocal("./db/schema") as typeof import("./db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const leads = requireLocal("./leads") as typeof import("./leads");
  const stage = requireLocal("./pipeline/stage") as typeof import("./pipeline/stage");
  const { listStages, resolveEntryStageId } = requireLocal("./pipeline/stageRepo") as typeof import("./pipeline/stageRepo");
  const runs = requireLocal("./leadFlows/runs") as typeof import("./leadFlows/runs");
  const sales = requireLocal("./dashboard/metrics/salesQueries") as typeof import("./dashboard/metrics/salesQueries");
  const { recordDmEvent } = requireLocal("./social/dm") as typeof import("./social/dm");
  const { dispatchDueAutomationQueue } = requireLocal("./leadFlows/dispatch") as typeof import("./leadFlows/dispatch");

  const s = h.makeScratchTenant("inbox-only-leads-test");
  const fake = h.installFakeTransport();
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const events = (leadId: number) => tdb.select().from(schema.leadStageEvents).where(eq(schema.leadStageEvents.leadId, leadId)).all();
      const onBoardIds = () => leads.listLeadsForBoard().map((l) => l.id);
      h.setFlowEnabled(s.tid, "new_lead", true);

      // WhatsApp from an unknown number.
      const { lead: conv } = leads.upsertLead({ source: "whatsapp", phone: "+353870000011", notes: "Inbound WhatsApp from an unknown number.", inboxOnly: true });
      ok(conv.inboxOnly === true && conv.stageId == null, "kept as a conversation, with no column");
      ok(events(conv.id).length === 0, "no stage history");
      ok(!onBoardIds().includes(conv.id), "not on the board");
      ok(!leads.listLeads().some((l) => l.id === conv.id), "not in the lead list");
      ok(sales.countLeadsIn(0, Date.now() + 60_000) === 0, "not counted as a new lead");

      // A reply, an automatic move, a flow: none of them touch it.
      stage.onInboundFromLead(conv.id, { text: "Hi, how much is a session?", channel: "whatsapp" });
      ok(tdb.select().from(schema.leads).where(eq(schema.leads.id, conv.id)).get()!.stageId == null, "a reply does not make it a Hot lead");
      const first = listStages().find((c) => c.position === Math.min(...listStages().map((x) => x.position)))!;
      stage.setStageToId(conv.id, first.id);
      ok(tdb.select().from(schema.leads).where(eq(schema.leads.id, conv.id)).get()!.stageId == null, "the stage writer leaves it alone");
      ok(runs.startFlow(conv.id, "new_lead").skipped === "inbox only", "no follow-up starts");

      // Add as lead.
      const added = leads.addToPipeline(conv.id, "user");
      ok(added?.added === true && added.lead.inboxOnly === false, "on the board");
      ok(added!.lead.stageId === resolveEntryStageId(added!.lead.pipelineId), "in the first column");
      ok(events(conv.id).length === 1 && events(conv.id)[0].actor === "user", "its first stage is in the history, by the person who added it");
      ok(onBoardIds().includes(conv.id) && sales.countLeadsIn(0, Date.now() + 60_000) === 1, "now listed and counted");
      ok(leads.addToPipeline(conv.id, "user")?.added === false && events(conv.id).length === 1, "adding twice changes nothing");

      // A card that was on the board, taken off, and put back keeps its column.
      const { lead: worked } = leads.upsertLead({ source: "messenger", sourceLeadId: "page:psid-1", fullName: "Worked Example" });
      const later = listStages().find((c) => c.id !== worked.stageId && c.systemKey === "thinking") ?? listStages()[2];
      stage.setStageToId(worked.id, later.id);
      tdb.update(schema.leads).set({ inboxOnly: true }).where(eq(schema.leads.id, worked.id)).run();
      ok(!onBoardIds().includes(worked.id), "taken off the board");
      const before = events(worked.id).length;
      const back = leads.addToPipeline(worked.id, "user");
      ok(back?.lead.stageId === later.id && events(worked.id).length === before, "back in its own column, no second welcome");

      // A follow-up already queued when a card is taken off the board never goes out.
      const { lead: queued } = leads.upsertLead({ source: "manual", fullName: "Queued Example", email: "queued@example.com", phone: "+353870000013" });
      h.setFlowEnabled(s.tid, "lead_no_answer", true);
      const WED_10 = Date.parse("2030-01-16T10:00:00Z");
      h.fakeClock(WED_10);
      ok((runs.startFlow(queued.id, "lead_no_answer").queued ?? 0) > 0, "a flow queued for a lead");
      tdb.update(schema.leads).set({ inboxOnly: true }).where(eq(schema.leads.id, queued.id)).run();
      await dispatchDueAutomationQueue(s.tid, WED_10 + 60_000, "http://app.test");
      const rows = tdb.select().from(schema.automationQueue).where(eq(schema.automationQueue.leadId, queued.id)).all();
      ok(fake.sent.length === 0 && rows.some((r) => r.status === "cancelled" && /conversation only/.test(r.error ?? "")), "taken off the board: nothing sent, the message cancelled with a reason");

      // Messenger: a new sender stays in the Inbox; an ad's form goes on the board.
      const page = { pageId: "page-1", pageAccessToken: "not-a-token" };
      const dm = await recordDmEvent(
        { channel: "messenger", accountId: "page-1", customerId: "psid-new", isEcho: false, messageId: "m-1", text: "Hi, are you open Saturday?", timestamp: Date.now(), attachments: [] },
        page,
      );
      const dmLead = tdb.select().from(schema.leads).where(eq(schema.leads.id, dm!.ownerId)).get()!;
      ok(dm?.ownerType === "lead" && dmLead.inboxOnly === true && dmLead.stageId == null, "a direct message is a conversation");
      const form = await recordDmEvent(
        {
          channel: "messenger",
          accountId: "page-1",
          customerId: "psid-ad",
          isEcho: false,
          messageId: "m-2",
          text: "Full name: Ad Example\nEmail: ad@example.com\nPhone number: 087 000 0012",
          timestamp: Date.now(),
          attachments: [],
        },
        page,
      );
      const adLead = tdb.select().from(schema.leads).where(eq(schema.leads.id, form!.ownerId)).get()!;
      ok(adLead.inboxOnly === false && adLead.stageId != null && adLead.email === "ad@example.com", "an ad's Messenger form is a lead on the board");
    });
    console.log(`inbox-only leads: ${n} checks passed.`);
  } finally {
    fake.restore();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
