// Run: npm test -- src/lib/leadFlows/columnEntry.test.ts
//
// What moving a card does to flows, through the real stage writer: a person
// moving a lead stops every flow and starts the column's own; the same
// column again only restarts when asked; a booking with its flow off still
// stops the nudges; a sale stops everything; a reply stops everything but a
// booked call's reminders.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead } = requireLocal("../leads") as typeof import("../leads");
  const stage = requireLocal("../pipeline/stage") as typeof import("../pipeline/stage");
  const { listStages, resolveStageIdByRole } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");
  const runs = requireLocal("./runs") as typeof import("./runs");

  const s = h.makeScratchTenant("lead-flow-column-entry-test");
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      h.fakeClock(Date.parse("2030-01-16T10:00:00Z"));
      const active = (leadId: number) =>
        tdb.select().from(schema.leadFlowRuns).where(and(eq(schema.leadFlowRuns.leadId, leadId), eq(schema.leadFlowRuns.status, "active"))).all();
      const queuedKeys = (leadId: number) =>
        [...new Set(tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"))).all().map((q) => q.triggerKey))];
      const col = (key: string) => listStages().find((c) => c.systemKey === key)!;

      for (const k of ["new_lead", "lead_no_answer", "lead_thinking", "lead_call_booked"]) h.setFlowEnabled(s.tid, k, true);

      const { lead } = upsertLead({ source: "website", sourceLeadId: "website:ce@example.com", fullName: "Column Entry", email: "ce@example.com", phone: "+353870000001" });
      ok(active(lead.id).map((r) => r.triggerKey).join() === "new_lead", "an enquiry starts New lead");

      // A person moves the card into No answer.
      stage.setStageToId(lead.id, col("no_answer").id);
      ok(active(lead.id).map((r) => r.triggerKey).join() === "lead_no_answer", "New lead stopped, No answer started");
      const first = active(lead.id)[0].id;

      // The same column again: nothing changes unless it is a re-entry.
      stage.setStageToId(lead.id, col("no_answer").id);
      ok(active(lead.id)[0].id === first, "writing the same column is not a re-entry");
      stage.setStageToId(lead.id, col("no_answer").id, "user", { reenter: true });
      ok(active(lead.id)[0].id !== first, "re-entry restarts the flow");

      // Moved by a person into a column with no flow: everything stops.
      stage.setStageToId(lead.id, resolveStageIdByRole("engaged")!);
      ok(active(lead.id).length === 0 && queuedKeys(lead.id).length === 0, "a person moving the card stops every flow");

      // startFlow false: the move stops flows but starts nothing.
      stage.setStageToId(lead.id, col("thinking").id, "user", { startFlow: false });
      ok(active(lead.id).length === 0, "Schedule a call style: the column's own flow does not start");

      // A booking with the booked flow off still stops the nudges, but not a booked call.
      stage.setStageToId(lead.id, col("thinking").id, "user", { reenter: true });
      ok(active(lead.id).map((r) => r.triggerKey).join() === "lead_thinking", "Thinking about it running");
      stage.writeStageId(lead.id, resolveStageIdByRole("booked")!, "booked by an appointment", "automation");
      ok(active(lead.id).length === 0, "an automatic booking stops the nudges");
      runs.startFlow(lead.id, "lead_call_booked", { callAt: Date.parse("2030-01-17T10:30:00Z") });
      stage.writeStageId(lead.id, resolveStageIdByRole("engaged")!, "test", "system");
      stage.writeStageId(lead.id, resolveStageIdByRole("booked")!, "booked again", "automation");
      ok(active(lead.id).map((r) => r.triggerKey).join() === "lead_call_booked", "a booking does not stop a booked call's reminders");

      // A reply stops the nudges but not the booked call. (Two flows never run at
      // once, so the nudge here is a row queued before runs existed.)
      tdb.insert(schema.automationQueue).values({ triggerKey: "new_lead", leadId: lead.id, kind: "message", channel: "whatsapp", body: "nudge", sendTo: lead.phone, dueAt: new Date(Date.parse("2030-01-18T10:00:00Z")) }).run();
      stage.onInboundFromLead(lead.id);
      ok(queuedKeys(lead.id).join() === "lead_call_booked", "a reply stops the nudges and keeps a booked call's reminder");

      // A no-show stops the booked call; a sale stops everything.
      stage.writeStageId(lead.id, resolveStageIdByRole("no_show")!, "no-show", "automation");
      ok(active(lead.id).length === 0, "a no-show stops the booked call's messages");
      runs.startFlow(lead.id, "lead_no_answer");
      tdb.insert(schema.automationQueue).values({ triggerKey: "call_alert", leadId: lead.id, kind: "staff_alert", channel: "chat", body: "alert", dueAt: new Date(Date.parse("2030-01-17T10:20:00Z")) }).run();
      stage.writeStageId(lead.id, resolveStageIdByRole("won")!, "paid", "system");
      ok(active(lead.id).length === 0 && queuedKeys(lead.id).length === 0, "a sale stops every flow and the call alerts");

      // An automatic move into a flow column starts it.
      const { lead: other } = upsertLead({ source: "manual", fullName: "Other Lead", phone: "+353870000002" });
      stage.writeStageId(other.id, col("no_answer").id, "automatic", "automation");
      ok(active(other.id).map((r) => r.triggerKey).join() === "lead_no_answer", "an automatic move into No answer starts its flow");
      stage.writeStageId(other.id, col("undelivered").id, "undelivered", "automation");
      ok(active(other.id).map((r) => r.triggerKey).join() === "lead_no_answer", "an automatic move into Message undelivered keeps the flow running");
    });
    console.log(`columnEntry: ${n} checks passed.`);
  } finally {
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
