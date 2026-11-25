// Run: npm test -- src/lib/leadFlows/calls.test.ts
//
// Log a call and Schedule a call against a scratch tenant, a fake sender
// and a fixed clock: each outcome moves the card to its column and starts
// that column's flow; a call at a time books the lead, puts the call in the
// diary, confirms now, reminds an hour before and alerts staff 10 minutes
// before; a day without a time reminds staff that morning and starts Call
// back later the morning after if they were not reached; no day starts it
// after its own delay.
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
  const { listStages, resolveStageIdByRole } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");
  const calls = requireLocal("./calls") as typeof import("./calls");
  const runs = requireLocal("./runs") as typeof import("./runs");
  const { saveLeadFlowSettings } = requireLocal("./settings") as typeof import("./settings");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");

  const s = h.makeScratchTenant("lead-flow-calls-test");
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
      const H = 3_600_000;
      const DAY = 86_400_000;
      const WED_10 = Date.parse("2030-01-16T10:00:00Z");
      const clock = h.fakeClock(WED_10);
      const STAFF = 4242; // a user id for the in-app alerts
      const dispatch = (at: number) => dispatchDueAutomationQueue(s.tid, at, "http://app.test");
      const col = (key: string) => listStages().find((c) => c.systemKey === key)!.id;
      const queued = (leadId: number) =>
        tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"))).all();
      const active = (leadId: number) => runs.leadFlowStatus(leadId).flow;
      for (const k of ["lead_no_answer", "lead_call_back", "lead_call_booked", "lead_thinking"]) h.setFlowEnabled(s.tid, k, true);
      saveLeadFlowSettings({ window: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: "+353870000099" });
      const newLead = (tag: string) => upsertLead({ source: "manual", actor: "user", fullName: `Call ${tag}`, email: `${tag}@example.com`, phone: "+353870000030" }).lead;

      // Log a call: each outcome moves the card and starts the column's flow.
      const a = newLead("noanswer");
      ok(calls.logCall(a.id, { outcome: "no_answer" }, STAFF).ok && getLead(a.id)!.stageId === col("no_answer") && active(a.id) === "No answer", "No answer: column and flow");
      const firstRun = runs.activeRun(a.id, "lead_no_answer")!.id;
      calls.logCall(a.id, { outcome: "no_answer", note: "Tried again" }, STAFF);
      ok(runs.activeRun(a.id, "lead_no_answer")!.id !== firstRun, "no answer again: the flow starts again");
      ok(getLeadMessages(a.id).some((m) => m.direction === "note" && m.content === "Call logged: No answer. Tried again"), "a note on the lead");
      ok(calls.listLeadCalls(a.id).length === 2, "both calls are in the call history");
      ok(calls.logCall(a.id, { outcome: "spoke" }, STAFF).ok && getLead(a.id)!.stageId === resolveStageIdByRole("engaged") && active(a.id) === null, "Spoke to them: Hot lead, follow-ups stop");
      calls.logCall(a.id, { outcome: "thinking" }, STAFF);
      ok(getLead(a.id)!.stageId === col("thinking") && active(a.id) === "Thinking about it", "Thinking about it: column and flow");
      calls.logCall(a.id, { outcome: "booked" }, STAFF);
      ok(getLead(a.id)!.stageId === resolveStageIdByRole("booked") && active(a.id) === null, "Booked a treatment: booked column");
      ok(!calls.logCall(a.id, { outcome: "maybe" as never }, STAFF).ok, "an unknown outcome is refused");

      // Schedule a call at a time: Thursday 10:30.
      const b = newLead("timed");
      const callAt = Date.parse("2030-01-17T10:30:00Z");
      ok(!calls.scheduleCall(b.id, { at: WED_10 - MIN }, STAFF).ok, "a time that has passed is refused");
      const booked = calls.scheduleCall(b.id, { at: callAt }, STAFF);
      ok(booked.ok && booked.message.includes("Thursday 17 January at 10:30"), "booked, and said back");
      ok(getLead(b.id)!.stageId === resolveStageIdByRole("booked") && active(b.id) === "Call booked", "booked column, Call booked flow");
      const event = tdb.select().from(schema.calendarEvents).all().find((e) => e.title === "Call: Call timed");
      ok(!!event && event.date === "2030-01-17" && event.startTime === "10:30" && event.endTime === "10:45", "in the diary, 15 minutes");
      const msgs = queued(b.id).filter((q) => q.kind === "message").map((q) => q.dueAt.getTime()).sort((x, y) => x - y);
      ok(msgs[0] === WED_10 && msgs[1] === callAt - H, "confirmation now, reminder an hour before");
      const staff = queued(b.id).find((q) => q.kind === "staff_alert" && q.triggerKey === "call_alert")!;
      ok(staff.dueAt.getTime() === callAt - 10 * MIN && JSON.parse(staff.payload!).userId === STAFF, "the staff alert 10 minutes before");
      clock.set(callAt - 10 * MIN);
      await dispatch(callAt - 10 * MIN);
      const bell = tdb.select().from(schema.notifications).all().find((x) => x.title === "Call in 10 minutes: Call timed");
      ok(!!bell && bell.forUserId === STAFF && bell.body === "+353870000030", "in their bell, with the number");

      // Rescheduling replaces the diary entry.
      clock.set(WED_10);
      calls.scheduleCall(b.id, { at: callAt + DAY }, STAFF);
      ok(tdb.select().from(schema.calendarEvents).all().filter((e) => e.title === "Call: Call timed").length === 1, "a new time replaces the old diary entry");

      // A day without a time: Saturday.
      const c = newLead("daylater");
      const res = calls.scheduleCall(c.id, { day: "2030-01-19" }, STAFF);
      ok(res.ok && getLead(c.id)!.stageId === col("call_back") && active(c.id) === null, "Call back later column; the flow waits");
      const morning = queued(c.id).find((q) => q.kind === "staff_alert" && q.triggerKey === "call_alert")!;
      ok(morning.dueAt.getTime() === Date.parse("2030-01-19T09:00:00Z") && /^Call back today: Call daylater/.test(JSON.parse(morning.payload!).whatsappText), "a reminder that morning, by WhatsApp to the alert number");
      clock.set(Date.parse("2030-01-19T09:00:00Z"));
      await dispatch(Date.parse("2030-01-19T09:00:00Z"));
      ok(fake.sent.some((x) => x.to === "number" && x.text.startsWith("Call back today: Call daylater")), "sent that morning");
      const endOfSat = Date.parse("2030-01-19T23:59:59.999Z");
      clock.set(endOfSat + 1);
      await dispatch(endOfSat + 1);
      ok(active(c.id) === "Call back later", "not reached by the end of the day: Call back later starts");
      const first = queued(c.id).filter((q) => q.kind === "message").map((q) => q.dueAt.getTime()).sort((x, y) => x - y)[0];
      ok(first === Date.parse("2030-01-21T09:00:00Z"), "its first message the next sending morning (Monday)");

      // Reached on the day: no follow-ups.
      clock.set(WED_10);
      const d = newLead("reached");
      calls.scheduleCall(d.id, { day: "2030-01-17" }, STAFF);
      calls.logCall(d.id, { outcome: "spoke" }, STAFF);
      ok(queued(d.id).filter((q) => q.kind === "callback_check").length === 0, "a call logged on the day cancels the check");

      // No day: Call back later starts with its own delay.
      const e = newLead("noday");
      calls.scheduleCall(e.id, {}, STAFF);
      const eFirst = queued(e.id).filter((q) => q.kind === "message").map((q) => q.dueAt.getTime()).sort((x, y) => x - y)[0];
      ok(getLead(e.id)!.stageId === col("call_back") && eFirst === WED_10 + 2 * DAY, "no day: the flow starts after 2 days");
      ok(!calls.scheduleCall(e.id, { day: "2030-01-01" }, STAFF).ok, "a past day is refused");

      // A later Log a call or Schedule a call replaces a call still to come: its diary entry goes.
      const diary = (tag: string) => tdb.select().from(schema.calendarEvents).all().filter((x) => x.title === `Call: Call ${tag}`).length;
      const f = newLead("planthink");
      calls.scheduleCall(f.id, { at: callAt }, STAFF);
      ok(diary("planthink") === 1, "a future call is in the diary");
      calls.logCall(f.id, { outcome: "thinking" }, STAFF);
      ok(diary("planthink") === 0, "logging Thinking about it before the call removes its diary entry");
      const g = newLead("plannoday");
      calls.scheduleCall(g.id, { at: callAt }, STAFF);
      ok(diary("plannoday") === 1, "another future call is in the diary");
      calls.scheduleCall(g.id, {}, STAFF);
      ok(diary("plannoday") === 0, "Call back later with no day removes the old diary entry");
    });
    console.log(`calls: ${n} checks passed.`);
  } finally {
    fake.restore();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
