// Run: npm test -- src/lib/leadFlows/importedRuns.test.ts
//
// Runs placed by the GoHighLevel import, on a scratch business with a fake
// sender and a fixed clock: the steps and times the importer worked out,
// held while the flow is off (nothing sent), released when it is switched
// on with past steps skipped, email only for Message undelivered, and do
// not contact refused everywhere.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const imported = requireLocal("./importedRuns") as typeof import("./importedRuns");
  const runs = requireLocal("./runs") as typeof import("./runs");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const { setTriggerEnabled } = requireLocal("../automations") as typeof import("../automations");

  const s = h.makeScratchTenant("lead-flow-imported-test");
  const fake = h.installFakeTransport();
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
      const NOW = Date.parse("2030-01-16T10:00:00Z"); // a Wednesday
      const clock = h.fakeClock(NOW);
      const newLead = (first: string, extra: Partial<typeof schema.leads.$inferInsert> = {}) =>
        tdb
          .insert(schema.leads)
          .values({ source: "gohighlevel", firstName: first, lastName: "Test", email: `${first.toLowerCase()}@example.com`, phone: "+353870000001", ...extra })
          .returning({ id: schema.leads.id })
          .get().id;
      const rowsOf = (leadId: number) => tdb.select().from(q).where(eq(q.leadId, leadId)).all();

      // 1. Flow on: the given steps at the given times, tied to an imported run.
      h.setFlowEnabled(s.tid, "lead_no_answer", true);
      const aoife = newLead("Aoife");
      const r1 = imported.placeImportedRun(aoife, { triggerKey: "lead_no_answer", steps: [{ step: 1, dueAt: NOW + 5 * DAY }], finishAt: NOW + 7 * DAY, emailOnly: false }, NOW);
      ok(r1.runId != null && r1.queued === 1 && !r1.held && r1.skipped === null, "placed: one message");
      const run1 = tdb.select().from(schema.leadFlowRuns).where(eq(schema.leadFlowRuns.id, r1.runId!)).get()!;
      ok(run1.source === "gohighlevel" && run1.status === "active", "the run is marked as imported");
      const a = rowsOf(aoife);
      const msg = a.find((r) => r.kind === "message")!;
      ok(msg.step === 1 && msg.status === "queued" && msg.dueAt.getTime() === NOW + 5 * DAY && msg.body.includes("Aoife") && msg.channel === "whatsapp", "the second No answer WhatsApp, personalised, at its time");
      ok(a.some((r) => r.kind === "move" && r.status === "queued" && r.dueAt.getTime() === NOW + 7 * DAY), "the finish move");

      // 2. Flow off: rows are held, and the ticker sends nothing.
      h.setFlowEnabled(s.tid, "lead_thinking", false);
      const brian = newLead("Brian");
      const r2 = imported.placeImportedRun(brian, { triggerKey: "lead_thinking", steps: [{ step: 0, dueAt: NOW + DAY }, { step: 1, dueAt: NOW + 6 * DAY }], finishAt: NOW + 8 * DAY, emailOnly: false }, NOW);
      ok(r2.held && r2.queued === 2, "a flow that is off: placed and held");
      ok(rowsOf(brian).every((r) => r.status === "held"), "every row held");
      clock.set(NOW + 2 * DAY);
      await dispatchDueAutomationQueue(s.tid, NOW + 2 * DAY, "http://app.test");
      ok(fake.sent.filter((x) => x.leadId === brian).length === 0 && rowsOf(brian).every((r) => r.status === "held"), "held rows are not sent");

      // 3. Switched on two days later: the passed message is skipped, the rest go at their times.
      setTriggerEnabled("lead_thinking", true);
      const b = rowsOf(brian);
      ok(b.find((r) => r.step === 0)!.status === "cancelled" && b.find((r) => r.step === 0)!.error === imported.SKIPPED_WHILE_OFF, "the passed message is skipped");
      ok(b.find((r) => r.step === 1)!.status === "queued" && b.find((r) => r.kind === "move")!.status === "queued", "the rest are released");

      // 4. Switched off again: a due imported row is held by the ticker, not sent.
      h.setFlowEnabled(s.tid, "lead_no_answer", false);
      clock.set(NOW + 5 * DAY);
      await dispatchDueAutomationQueue(s.tid, NOW + 5 * DAY, "http://app.test");
      ok(rowsOf(aoife).find((r) => r.kind === "message")!.status === "held", "the ticker holds an imported row whose flow is off");
      ok(fake.sent.filter((x) => x.leadId === aoife).length === 0, "and sends nothing");

      // 5. Stopping a flow cancels held rows too.
      runs.stopFlows(aoife, "test", "all");
      ok(rowsOf(aoife).every((r) => r.status === "cancelled"), "held rows are cancelled when the flow stops");

      // 6. Message undelivered: WhatsApp steps go by email.
      h.setFlowEnabled(s.tid, "lead_call_back", true);
      const ciara = newLead("Ciara");
      imported.placeImportedRun(ciara, { triggerKey: "lead_call_back", steps: [{ step: 0, dueAt: NOW + 3 * DAY }], finishAt: null, emailOnly: true }, NOW + 2 * DAY);
      const c = rowsOf(ciara).find((r) => r.kind === "message")!;
      ok(c.channel === "email" && c.sendTo === "ciara@example.com" && !!c.subject, "email only: the WhatsApp goes as an email");

      // 7. Long-term nurture needs marketing consent.
      h.setFlowEnabled(s.tid, "lead_nurture", true);
      const declan = newLead("Declan");
      ok(imported.placeImportedRun(declan, { triggerKey: "lead_nurture", steps: [{ step: 0, dueAt: NOW + 3 * DAY }], finishAt: null, emailOnly: false }).skipped === "no marketing consent", "nurture without consent: refused");

      // 8. Do not contact: refused by the import and by startFlow.
      const eimear = newLead("Eimear", { doNotContact: true });
      ok(imported.placeImportedRun(eimear, { triggerKey: "lead_no_answer", steps: [{ step: 0, dueAt: NOW + 3 * DAY }], finishAt: null, emailOnly: false }).skipped === "do not contact", "import refuses do not contact");
      h.setFlowEnabled(s.tid, "lead_no_answer", true);
      ok(runs.startFlow(eimear, "lead_no_answer").skipped === "do not contact", "startFlow refuses do not contact");
      ok(tdb.select().from(q).where(and(eq(q.leadId, eimear))).all().length === 0, "nothing queued for them");
    });
    console.log(`importedRuns: ${n} checks passed.`);
  } finally {
    fake.restore();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
