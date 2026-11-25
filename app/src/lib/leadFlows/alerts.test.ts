// Run: npm test -- src/lib/leadFlows/alerts.test.ts
//
// Assigning leads and the alerts that follow, against a scratch tenant with
// two fake staff and a fake sender: the business default assignee, the
// assignee's own in-app alert (nobody else's bell), the WhatsApp alert to
// the business's alert number with the agreed wording, the hot-lead alert
// on a reply that makes them hot (once), and no WhatsApp alert when no
// number is set.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead, getLead } = requireLocal("../leads") as typeof import("../leads");
  const stage = requireLocal("../pipeline/stage") as typeof import("../pipeline/stage");
  const assignment = requireLocal("./assignment") as typeof import("./assignment");
  const { saveLeadFlowSettings } = requireLocal("./settings") as typeof import("./settings");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const { listForUser } = requireLocal("../notifications/store") as typeof import("../notifications/store");

  const s = h.makeScratchTenant("lead-flow-alerts-test");
  const fake = h.installFakeTransport();
  const emails = ["staff-one@example.com", "staff-two@example.com"];
  const cleanupUsers = () => {
    for (const e of emails) {
      const u = controlSqlite.prepare("SELECT id FROM users WHERE email = ?").get(e) as { id: number } | undefined;
      if (u) {
        controlSqlite.prepare("DELETE FROM memberships WHERE user_id = ?").run(u.id);
        controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
      }
    }
  };
  cleanupUsers();
  const [one, two] = emails.map((email, i) => {
    const id = (controlSqlite.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, 'x') RETURNING id").get(email, i === 0 ? "Staff One" : "Staff Two") as { id: number }).id;
    controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, 'staff')").run(id, s.tid);
    return id;
  });
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const WED_10 = Date.parse("2030-01-16T10:00:00Z");
      h.fakeClock(WED_10);
      const alertRows = () =>
        tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.kind, "staff_alert"), eq(schema.automationQueue.status, "queued"))).all();

      ok(assignment.listAssignableStaff(s.tid).map((x) => x.name).join() === "Staff One,Staff Two", "both staff can be assigned");

      // No settings: nobody assigned, no WhatsApp alert.
      const { lead: plain } = upsertLead({ source: "website", sourceLeadId: "website:plain@example.com", fullName: "Plain Lead", email: "plain@example.com" });
      ok(getLead(plain.id)!.assignedUserId === null && alertRows().length === 0, "nothing set: no assignee, no alert");

      // The business default and the alert number.
      saveLeadFlowSettings({ window: null, defaultAssigneeUserId: one, alertWhatsAppTo: "+353870000099", alertUserId: null });
      const { lead } = upsertLead({ source: "website", sourceLeadId: "website:ann@example.com", fullName: "Ann Example", email: "ann@example.com", phone: "+353870000010" });
      ok(getLead(lead.id)!.assignedUserId === one, "new leads go to the default assignee");
      const mine = listForUser(one, "staff");
      ok(mine.some((x) => x.title === "New lead for you: Ann Example"), "the assignee's own alert is in their bell");
      ok(!listForUser(two, "staff").some((x) => x.title.startsWith("New lead for you")), "and nobody else's");
      const wa = alertRows();
      ok(wa.length === 1 && JSON.parse(wa[0].payload!).whatsappText === `New lead: Ann Example, From the website. +353870000010. Open: http://app.test/leads/${lead.id}`, "the WhatsApp alert, as agreed");
      await dispatchDueAutomationQueue(s.tid, WED_10, "http://app.test");
      ok(fake.sent.some((x) => x.to === "number" && x.address === "+353870000099" && x.text.startsWith("New lead: Ann Example")), "sent to the alert number from the business WhatsApp");

      // A lead staff type in themselves is not alerted.
      upsertLead({ source: "manual", actor: "user", fullName: "Typed In", phone: "+353870000016" });
      ok(alertRows().length === 0, "a lead staff typed in raises no alert");

      // Assigning by hand.
      ok(assignment.assignLead(lead.id, two).ok && getLead(lead.id)!.assignedUserId === two, "reassigned");
      ok(!assignment.assignLead(lead.id, 987654).ok, "only someone on this account");
      ok(assignment.assignLead(lead.id, null).ok && getLead(lead.id)!.assignedUserId === null, "unassigned");
      assignment.assignLead(lead.id, two);

      // A reply makes them hot: the hot-lead alert, once.
      const reply = "Yes please. Could you ring me on Tuesday after lunch? I am free from two until five, any time then is fine, thanks a million for the message";
      stage.onInboundFromLead(lead.id, { text: reply, channel: "whatsapp" });
      ok(listForUser(two, "staff").some((x) => x.title === "Hot lead: Ann Example"), "the assignee gets the hot-lead alert");
      const hot = alertRows().map((r) => JSON.parse(r.payload!).whatsappText as string);
      ok(hot.length === 1 && hot[0].startsWith('Hot lead: Ann Example replied: "Yes please.') && hot[0].endsWith(`". Open: http://app.test/leads/${lead.id}`), "the hot-lead WhatsApp, as agreed");
      stage.onInboundFromLead(lead.id, { text: "And another thing", channel: "whatsapp" });
      ok(alertRows().length === 1, "already hot: no second alert");

      // No number set: no WhatsApp alert is queued, and a queued one is not sent.
      saveLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: null, alertUserId: null });
      await dispatchDueAutomationQueue(s.tid, WED_10 + 1, "http://app.test");
      const cancelled = tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.kind, "staff_alert"), eq(schema.automationQueue.status, "cancelled"))).all();
      ok(cancelled.length === 1 && /No WhatsApp alert number/.test(cancelled[0].error ?? ""), "a queued alert with no number set is dropped, not sent");
      upsertLead({ source: "facebook", sourceLeadId: "fb-alert-1", fullName: "No Number", phone: "+353870000017" });
      ok(alertRows().length === 0, "no number: nothing queued");
    });
    console.log(`alerts: ${n} checks passed.`);
  } finally {
    fake.restore();
    cleanupUsers();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
