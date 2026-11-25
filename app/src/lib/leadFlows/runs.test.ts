// Run: npm test -- src/lib/leadFlows/runs.test.ts
//
// Starting and stopping flows, against a real scratch tenant on a fixed
// clock: off until switched on, the messages and the finish move, re-entry
// restarts, starting any flow stops the others, sending hours push steps
// back, versions by interest, a booked call's timing, and which flow a
// column starts.
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
  const runs = requireLocal("./runs") as typeof import("./runs");
  const defs = requireLocal("./definitions") as typeof import("./definitions");
  const { saveLeadFlowSettings } = requireLocal("./settings") as typeof import("./settings");
  const { listStages } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");

  const s = h.makeScratchTenant("lead-flow-runs-test");
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const DAY = 86_400_000;
      const WED_10 = Date.parse("2030-01-16T10:00:00Z"); // a Wednesday; winter, so Irish time = UTC
      const clock = h.fakeClock(WED_10);
      const queued = (leadId: number) =>
        tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"))).all();
      const runRows = (leadId: number) => tdb.select().from(schema.leadFlowRuns).where(eq(schema.leadFlowRuns.leadId, leadId)).all();

      const { lead } = upsertLead({ source: "manual", fullName: "Aoife Test", email: "aoife@example.com", phone: "+353870000000" });

      // Off until switched on.
      ok(runs.startFlow(lead.id, "lead_no_answer").skipped === "switched off", "a flow that is off starts nothing");
      ok(queued(lead.id).length === 0, "nothing queued");

      // On: the messages and the finish move.
      h.setFlowEnabled(s.tid, "lead_no_answer", true);
      const r1 = runs.startFlow(lead.id, "lead_no_answer");
      ok(r1.runId != null && r1.queued === 2, "two WhatsApps queued");
      const q1 = queued(lead.id);
      const msgs = q1.filter((q) => q.kind === "message").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      ok(msgs[0].dueAt.getTime() === WED_10 && msgs[1].dueAt.getTime() === WED_10 + 2 * DAY, "now, then two days on");
      ok(msgs.every((m) => m.runId === r1.runId && m.body.includes("Aoife") && !m.body.includes("[FIRST_NAME]")), "personalised, tied to the run");
      const move = q1.find((q) => q.kind === "move")!;
      ok(move.dueAt.getTime() === WED_10 + 4 * DAY && JSON.parse(move.payload!).column === "key:nurture", "the move to Long-term nurture after four days");

      // Re-entry restarts.
      clock.advance(DAY);
      const r2 = runs.startFlow(lead.id, "lead_no_answer");
      ok(r2.runId !== r1.runId && queued(lead.id).length === 3, "starting again replaces the old run");
      ok(runRows(lead.id).find((r) => r.id === r1.runId)?.status === "stopped", "the old run is stopped");

      // Starting another flow stops this one.
      h.setFlowEnabled(s.tid, "lead_thinking", true);
      runs.startFlow(lead.id, "lead_thinking");
      ok(queued(lead.id).every((q) => q.triggerKey === "lead_thinking"), "starting any flow stops every other flow");
      ok(runs.activeRun(lead.id, "lead_no_answer") === null && runs.activeRun(lead.id, "lead_thinking") !== null, "activeRun");
      ok(runs.startFlow(lead.id, "lead_thinking", { ifNotActive: true }).skipped === "already running", "an intake enrolment never doubles a running flow");
      ok(runs.leadFlowStatus(lead.id).flow === "Thinking about it" && runs.leadFlowStatus(lead.id).next.length === 2, "leadFlowStatus names the flow and its next messages");

      // stopFlows scopes.
      ok(runs.stopFlows(lead.id, "test", { only: ["lead_no_answer"] }) === 0 && queued(lead.id).length > 0, "only: leaves other flows");
      ok(runs.stopFlows(lead.id, "test", { except: ["lead_thinking"] }) === 0 && queued(lead.id).length > 0, "except: leaves the kept flow");
      ok(runs.stopFlows(lead.id, "replied") === 1 && queued(lead.id).length === 0, "all: stops it");
      const cancelled = tdb.select().from(schema.automationQueue).where(eq(schema.automationQueue.leadId, lead.id)).all().filter((q) => q.status === "cancelled");
      ok(cancelled.length > 0 && cancelled.every((q) => (q.error ?? "").startsWith("Stopped:")), "cancelled rows say why");

      // Sending hours push the first step back and the rest follow it.
      saveLeadFlowSettings({ window: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: null });
      clock.set(Date.parse("2030-01-19T19:00:00Z")); // Saturday evening
      runs.startFlow(lead.id, "lead_no_answer");
      const held = queued(lead.id).filter((q) => q.kind === "message").map((q) => q.dueAt.getTime()).sort((a, b) => a - b);
      ok(held[0] === Date.parse("2030-01-21T09:00:00Z"), "Saturday evening: Monday at 9");
      ok(held[1] === Date.parse("2030-01-23T09:00:00Z"), "the second step two days after the first");
      runs.stopFlows(lead.id, "reset");
      saveLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: null });
      clock.set(WED_10);

      // An email-only lead skips the WhatsApps but still moves on at the end.
      const { lead: emailOnly } = upsertLead({ source: "manual", fullName: "Email Only", email: "emailonly@example.com" });
      const r3 = runs.startFlow(emailOnly.id, "lead_no_answer");
      ok(r3.queued === 0 && queued(emailOnly.id).length === 1 && queued(emailOnly.id)[0].kind === "move", "no phone: no WhatsApps, the move still happens");

      // Versions by interest, from saved messages (on New lead here; Long-term nurture also needs consent, Task 9).
      h.setFlowEnabled(s.tid, "new_lead", true);
      tdb.insert(schema.automationMessages)
        .values([
          { triggerKey: "new_lead", position: 0, channel: "email", subject: "Week 1", template: "Hi [FIRST_NAME], week one.", delayValue: 0, delayUnit: "days" },
          { triggerKey: "new_lead", position: 1, channel: "email", subject: "HBOT", template: "About HBOT.", delayValue: 7, delayUnit: "days", matchInterest: "hbot, hyperbaric" },
          { triggerKey: "new_lead", position: 2, channel: "email", subject: "General", template: "About our therapies.", delayValue: 7, delayUnit: "days", matchInterest: "other" },
        ])
        .run();
      const subjects = (leadId: number) => queued(leadId).filter((q) => q.kind === "message").map((q) => q.subject).join("|");
      const { lead: hbot } = upsertLead({ source: "manual", fullName: "Hb Ot", email: "hbot@example.com", therapyInterest: "Hyperbaric oxygen" });
      runs.startFlow(hbot.id, "new_lead");
      ok(subjects(hbot.id) === "Week 1|HBOT", "an HBOT lead gets the HBOT version");
      const { lead: unsure } = upsertLead({ source: "manual", fullName: "Not Sure", email: "unsure@example.com", therapyInterest: "Not sure yet" });
      runs.startFlow(unsure.id, "new_lead");
      ok(subjects(unsure.id) === "Week 1|General", "anyone else gets the general one");

      // A booked call: confirmation now, reminder counted back from the call, by email with no phone.
      h.setFlowEnabled(s.tid, "lead_call_booked", true);
      const callAt = WED_10 + DAY + 30 * 60_000; // Thursday 10:30
      ok(runs.startFlow(lead.id, "lead_call_booked").skipped === "no call time", "a booked call needs its time");
      runs.startFlow(lead.id, "lead_call_booked", { callAt });
      const call = queued(lead.id).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      ok(call.length === 2 && call[0].dueAt.getTime() === WED_10 && call[1].dueAt.getTime() === callAt - 3_600_000, "confirmation now, reminder an hour before");
      ok(/Thursday 17 January at 10:30/.test(call[0].body), "the day and time are filled in");
      ok(JSON.parse(call[1].payload!).notAfter === callAt && !call.some((q) => q.kind === "move"), "the reminder is never sent late; no finish move");
      runs.startFlow(emailOnly.id, "lead_call_booked", { callAt });
      ok(queued(emailOnly.id).length === 2 && queued(emailOnly.id).every((q) => q.channel === "email" && (q.subject ?? "").startsWith("Your call with ")), "no phone: the call messages go by email");

      // A scheduled call's staff rows.
      tdb.insert(schema.automationQueue).values({ triggerKey: "call_alert", leadId: lead.id, kind: "staff_alert", channel: "chat", body: "alert", dueAt: new Date(callAt) }).run();
      ok(runs.cancelCallRows(lead.id, "moved") === 1, "cancelCallRows drops a call's staff alert");

      // Definitions: saved columns win over the defaults; "" means none.
      tdb.insert(schema.automationTriggers)
        .values({ key: "lead_thinking", enabled: true, startColumn: "", finishColumn: "key:undelivered", finishAfterValue: 3, finishAfterUnit: "days" })
        .onConflictDoUpdate({ target: schema.automationTriggers.key, set: { startColumn: "", finishColumn: "key:undelivered", finishAfterValue: 3, finishAfterUnit: "days" } })
        .run();
      const think = defs.getFlowDefinition("lead_thinking");
      ok(think.startColumn === null && think.finish?.column === "key:undelivered" && think.finish.afterMs === 3 * DAY, "saved settings override the defaults");
      const noAnswer = defs.getFlowDefinition("lead_no_answer");
      ok(noAnswer.startColumn === "key:no_answer" && noAnswer.finish?.afterMs === 4 * DAY, "no saved settings: the defaults");

      // A flow the lead cannot receive is skipped BEFORE its other flows are stopped. Email Only has no
      // phone and is on a booked-call run (two emails); Thinking about it is WhatsApp-only, and with no
      // finish move set there is nothing to queue, so the start is refused and the call emails stay.
      tdb.update(schema.automationTriggers).set({ finishColumn: "" }).where(eq(schema.automationTriggers.key, "lead_thinking")).run();
      const callRun = runs.activeRun(emailOnly.id, "lead_call_booked");
      const callRowsBefore = queued(emailOnly.id).length;
      const refused = runs.startFlow(emailOnly.id, "lead_thinking");
      ok(refused.skipped === "nothing this lead can receive" && refused.runId === null, "a WhatsApp-only flow with no finish move is refused for a lead with no phone");
      ok(callRun != null && runs.activeRun(emailOnly.id, "lead_call_booked")?.id === callRun.id && queued(emailOnly.id).length === callRowsBefore && callRowsBefore === 2, "the refused start leaves the lead's running flow and its queued messages alone");

      // Which flow a column starts.
      const cols = listStages();
      const naCol = cols.find((c) => c.systemKey === "no_answer")!;
      const thinkCol = cols.find((c) => c.systemKey === "thinking")!;
      ok(defs.flowForStage(naCol) === "lead_no_answer", "No answer starts the No answer flow");
      ok(defs.flowForStage(thinkCol) === null, "a flow pointed at no column starts from none");
      h.setFlowEnabled(s.tid, "lead_no_answer", false);
      ok(defs.flowForStage(naCol) === null, "switched off: nothing starts");
    });
    console.log(`runs: ${n} checks passed.`);
  } finally {
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
