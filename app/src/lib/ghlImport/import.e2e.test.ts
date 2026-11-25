// Run: npm test -- src/lib/ghlImport/import.e2e.test.ts
//
// A small made-up GoHighLevel export imported twice into a scratch business
// set up like Optimal Health, with a fake sender and a fixed clock. Checks
// where people land, the runs and their steps, held rows for a flow that is
// off, do not contact, that nothing is sent and no alert, notification or
// Meta event fires, that a second run changes nothing, and that the medical
// note reaches no AI tool, message or dry run.
import "../leadFlows/testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("../leadFlows/testing/harness") as typeof import("../leadFlows/testing/harness");
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq, sql } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { saveLeadFlowSettings } = requireLocal("../leadFlows/settings") as typeof import("../leadFlows/settings");
  const { saveTrigger, setTriggerEnabled } = requireLocal("../automations") as typeof import("../automations");
  const { FLOW_PRESETS } = requireLocal("../leadFlows/presets") as typeof import("../leadFlows/presets");
  const runs = requireLocal("../leadFlows/runs") as typeof import("../leadFlows/runs");
  const { listStages } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");
  const { getLeadHealthTool } = requireLocal("../agents/tools.sales") as typeof import("../agents/tools.sales");
  const ghl = requireLocal("./run") as typeof import("./run");
  const store = requireLocal("./store") as typeof import("./store");
  const { GHL_CONSENT_SOURCE } = requireLocal("./mapping") as typeof import("./mapping");
  const { spreadMs } = requireLocal("./plan") as typeof import("./plan");
  const { localParts } = requireLocal("../leadFlows/sendingWindow") as typeof import("../leadFlows/sendingWindow");

  const s = h.makeScratchTenant("ghl-import-e2e-test");
  const fake = h.installFakeTransport();
  const staffEmail = "ghl-e2e-staff@example.com";
  const dropStaff = () => {
    const u = controlSqlite.prepare("SELECT id FROM users WHERE email = ?").get(staffEmail) as { id: number } | undefined;
    if (u) {
      controlSqlite.prepare("DELETE FROM memberships WHERE user_id = ?").run(u.id);
      controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    }
  };
  dropStaff();
  const staffId = (controlSqlite.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, 'Sandra Example', 'x') RETURNING id").get(staffEmail) as { id: number }).id;
  controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, 'staff')").run(staffId, s.tid);

  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };
  const MED = "FAKE-MEDICAL-E2E-SENTINEL";

  const CONTACT_HEAD = "Contact Id,First Name,Last Name,Phone,Email,Business Name,Created,Last Activity,Tags,DND,Date of Birth,Source,utm Campaign ,Treatment interested in,Location,Medical Condition,Used treatments before?";
  const c = (id: string, first: string, phone: string, email: string, extra: { tags?: string; dnd?: string; treatment?: string } = {}) =>
    `${id},${first},Example,${phone},${email},,2029-10-01T10:00:00+01:00,,"${extra.tags ?? ""}",${extra.dnd ?? ""},,Facebook,,${extra.treatment ?? ""},Clonmel,${MED} ${first},no`;
  const CONTACTS = [
    CONTACT_HEAD,
    c("g-aoife", "Aoife", "+353870000101", "aoife@example.com", { treatment: "Infrared Therapy" }),
    c("g-brian", "Brian", "+353870000102", "brian@example.com"),
    c("g-ciara", "Ciara", "+353870000103", "ciara@example.com"),
    c("g-declan", "Declan", "+353870000104", "declan@example.com"),
    c("g-eimear", "Eimear", "+353870000105", "eimear@example.com"),
    c("g-fiona", "Fiona", "+353870000106", "fiona@example.com", { dnd: "true" }),
    c("g-gavin", "Gavin", "+353870000107", "gavin@example.com", { tags: "member" }),
    c("g-hannah", "Hannah", "", "hannah@example.com"),
    c("g-ivan", "Ivan", "+353870000109", "ivan@example.com"),
    c("g-joan", "Joan", "+353870000110", "joan@example.com"),
    c("g-kevin", "Kevin", "+353870000111", "kevin@example.com"),
    c("g-laura", "Laura", "+353870000112", "laura@example.com"),
    c("g-mary", "Mary", "", "hannah@example.com"),
  ].join("\n");
  const OPP_HEAD = "Opportunity name,Contact Name,phone,email,pipeline,stage,Lead Value,source,assigned,Created on,Updated on,lost reason ID,lost reason name,Followers,Notes,tags,Engagement score,status,Opportunity ID,Contact ID,Pipeline Stage ID,Pipeline ID,Days since last stage change ,Days since last status change ,Days since last update ";
  const o = (contactId: string, stage: string, days: string) =>
    `X,X Example,,,Main Leads,${stage},0,Facebook,Sandra Example,2029-10-01T09:00:00.000Z,2029-12-01T09:00:00.000Z,,,,Rang once,,0,open,o-${contactId},${contactId},s,p,${days},${days},${days}`;
  const OPPS = [
    OPP_HEAD,
    o("g-aoife", "Long Term Nurture", "10 Days"),
    o("g-brian", "Call Back Later", "3 Days"),
    o("g-ciara", "Thinking About It", "40 Days"),
    o("g-declan", "Won", "100 Days"),
    o("g-eimear", "Lost", "20 Days"),
    o("g-fiona", "Long Term Nurture", "5 Days"),
    o("g-ivan", "Call Back Later", "20 Days"),
    o("g-joan", "Long Term Nurture", "30 Days"),
    o("g-kevin", "Holding", "10 Days"),
    o("g-laura", "Message Undelivered", "20 Days"),
  ].join("\n");

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const DAY = 86_400_000;
      const NOW = Date.parse("2030-01-16T10:00:00Z"); // a Wednesday
      const clock = h.fakeClock(NOW);
      const WINDOW = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" };
      saveLeadFlowSettings({ window: WINDOW, defaultAssigneeUserId: null, alertWhatsAppTo: "+353870000099" });
      // Each person's messages are spread across sending hours by contact id; a fresh start begins on the next sending day.
      const spread = (contactId: string) => spreadMs(contactId, WINDOW);
      const inWindow = (at: number) => {
        const lp = localParts(at);
        return WINDOW.days.includes(lp.weekday) && lp.minutes >= 9 * 60 && lp.minutes < 18 * 60;
      };
      const TOMORROW_OPEN = Date.parse("2030-01-17T09:00:00Z"); // Thursday, a sending day
      const IMPORT_DAY_ENDS = Date.parse("2030-01-17T00:00:00Z");
      // Optimal Health's copy, saved the way the editor saves it; Call back later is off.
      for (const key of ["new_lead", "lead_no_answer", "lead_call_back", "lead_thinking", "lead_nurture"]) {
        saveTrigger({ key, enabled: key !== "lead_call_back", externalEnabled: false, messages: FLOW_PRESETS["optimal-health"][key] });
      }
      const col = (k: string) => listStages().find((x) => x.systemKey === k)!.id;

      // Already in Adonis: Ivan (old move, by phone in national format), Joan (in a flow, phone only).
      const ivanId = tdb.insert(schema.leads).values({ source: "manual", firstName: "Ivan", phone: "087 000 0109", stageId: listStages()[0].id, createdAt: new Date("2029-06-01T00:00:00Z") }).returning({ id: schema.leads.id }).get().id;
      const joanId = tdb.insert(schema.leads).values({ source: "manual", firstName: "Joan", phone: "+353870000110", stageId: listStages()[0].id }).returning({ id: schema.leads.id }).get().id;
      ok(runs.startFlow(joanId, "lead_no_answer").runId != null, "Joan is in an Adonis flow");
      const updatedBefore = (id: number) => tdb.select({ u: schema.leads.updatedAt }).from(schema.leads).where(eq(schema.leads.id, id)).get()!.u.getTime();
      const ivanUpdated = updatedBefore(ivanId);
      const joanUpdated = updatedBefore(joanId);
      const queueBefore = tdb.select().from(schema.automationQueue).all().length;

      const input = { contactsText: CONTACTS, opportunitiesText: OPPS, exportDay: "2030-01-16" };

      // Impossible export days are refused.
      ok(ghl.checkExportDay("2030-02-31", NOW) != null && ghl.checkExportDay("2030-13-01", NOW) != null && ghl.checkExportDay("2030-01-16", NOW) === null, "an impossible export day is refused");

      // The dry run writes nothing and carries no medical note.
      const dry = ghl.dryRunGhlImport(s.tid, input);
      assert.ok(dry.ok);
      n++;
      ok(!JSON.stringify(dry).includes(MED), "the dry run carries no medical note");
      ok(tdb.select().from(schema.ghlImportPeople).all().length === 0 && tdb.select().from(schema.automationQueue).all().length === queueBefore, "the dry run writes nothing");

      // The import.
      const first = ghl.runGhlImport(s.tid, input);
      assert.ok(first.ok);
      n++;
      if (!first.ok) return;
      const r = first.result;
      ok(r.failed === 0 && r.errors.length === 0, "no failures");
      ok(r.leadsCreated === 8, "Aoife, Brian, Ciara, Declan, Eimear, Fiona, Kevin and Laura are new leads");
      ok(r.leadsUpdated === 2, "Ivan moved, Joan filled");
      ok(r.clientsCreated === 2 && r.contactsAdded === 1 && r.doNotContact === 1 && r.skipped === 1, "two clients, one contact, one do not contact, Mary skipped");
      ok(r.runsPlaced === 4 && r.runsWaiting === 1 && r.holdingCreated, "four runs (one waiting) and the Holding column");

      const lead = (contactId: string) => tdb.select().from(schema.leads).where(eq(schema.leads.sourceLeadId, contactId)).get()!;
      const queued = (leadId: number) => tdb.select().from(schema.automationQueue).where(eq(schema.automationQueue.leadId, leadId)).all();

      // Aoife: nurture, week 3 infrared WhatsApp first, on Monday 21 January at the opening plus her spread (the 20th is a Sunday).
      const aoife = lead("g-aoife");
      ok(aoife.source === "gohighlevel" && aoife.stageId === col("nurture") && aoife.assignedUserId === staffId, "Aoife: nurture, assigned to Sandra");
      ok(aoife.marketingConsentSource === GHL_CONSENT_SOURCE && aoife.marketingConsentAt === NOW, "consent carried over, with the operator's decision as the source");
      ok(aoife.createdAt.getTime() === Date.parse("2029-10-01T10:00:00+01:00"), "created date from GoHighLevel");
      const aMsgs = queued(aoife.id).filter((x) => x.kind === "message").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      ok(aMsgs.length === 5 && aMsgs[0].dueAt.getTime() === Date.parse("2030-01-21T09:00:00Z") + spread("g-aoife") && aMsgs[0].channel === "whatsapp" && /infrared/i.test(aMsgs[0].body), "week 3 infrared WhatsApp first, Monday at her spread");
      ok(aMsgs.every((x) => inWindow(x.dueAt.getTime())), "all her messages inside sending hours");
      const ev = tdb.select().from(schema.leadStageEvents).where(eq(schema.leadStageEvents.leadId, aoife.id)).all();
      ok(ev.length === 1 && ev[0].at.getTime() === Date.parse("2030-01-06T09:00:00Z"), "the stage event is dated when she entered the stage in GoHighLevel");
      ok(!!tdb.select().from(schema.contacts).where(sql`lower(${schema.contacts.email}) = 'aoife@example.com'`).get(), "she is on the marketing contacts");

      // Brian: Call back later is off: his rows are held.
      const brian = lead("g-brian");
      ok(brian.stageId === col("call_back") && queued(brian.id).length === 2 && queued(brian.id).every((x) => x.status === "held"), "Brian: held until Call back later is switched on");

      // Ciara: stale, nurture from week 1, starting on the next sending day; nothing on the import day.
      const ciara = lead("g-ciara");
      const cMsgs = queued(ciara.id).filter((x) => x.kind === "message").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      ok(ciara.stageId === col("nurture") && cMsgs.length > 0 && cMsgs.every((x) => x.dueAt.getTime() >= IMPORT_DAY_ENDS), "Ciara: nurture week 1, no message on the import day");
      ok(cMsgs[0].dueAt.getTime() === TOMORROW_OPEN + spread("g-ciara") && inWindow(cMsgs[0].dueAt.getTime()), "Ciara: week 1 tomorrow at her spread");
      ok(spread("g-aoife") !== spread("g-ciara"), "two contact ids get different minutes");

      // Declan: won, a client; Eimear: lost; Fiona: do not contact.
      const declan = lead("g-declan");
      ok(declan.clientId != null && declan.pipelineStage === "sale" && queued(declan.id).length === 0, "Declan: a client and a sale, no flow");
      const eimear = lead("g-eimear");
      ok(eimear.status === "lost" && eimear.marketingConsentAt == null && queued(eimear.id).length === 0, "Eimear: lost, no consent, nothing queued");
      const fiona = lead("g-fiona");
      ok(fiona.doNotContact && fiona.doNotCall && fiona.marketingConsentAt == null && queued(fiona.id).length === 0, "Fiona: do not contact");
      ok(tdb.select().from(schema.suppressions).where(sql`lower(${schema.suppressions.email}) = 'fiona@example.com'`).get()?.reason === "manual", "Fiona is on the do-not-email list");

      // Gavin: a client only. Hannah: a contact only. Mary: Hannah's twin, skipped.
      ok(tdb.select().from(schema.clients).where(eq(schema.clients.email, "gavin@example.com")).all().length === 1 && !tdb.select().from(schema.leads).where(eq(schema.leads.sourceLeadId, "g-gavin")).get(), "Gavin: client, not a lead");
      const hannahContact = tdb.select().from(schema.contacts).where(eq(schema.contacts.email, "hannah@example.com")).get();
      ok(hannahContact?.status === "subscribed" && (hannahContact.tags ?? "").includes("gohighlevel"), "Hannah: an email contact");

      // Ivan: matched, moved to nurture; Joan: still in her own flow, email filled.
      const ivan = tdb.select().from(schema.leads).where(eq(schema.leads.id, ivanId)).get()!;
      ok(ivan.stageId === col("nurture") && ivan.source === "manual" && queued(ivanId).some((x) => x.kind === "message"), "Ivan: moved to nurture, keeps his own source");
      const iMsgs = queued(ivanId).filter((x) => x.kind === "message").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      ok(iMsgs.every((x) => x.dueAt.getTime() >= IMPORT_DAY_ENDS) && iMsgs[0].dueAt.getTime() === TOMORROW_OPEN + spread("g-ivan"), "Ivan: Call back later ended, nurture from week 1 tomorrow at his spread");
      const joan = tdb.select().from(schema.leads).where(eq(schema.leads.id, joanId)).get()!;
      ok(joan.email === "joan@example.com" && runs.activeRun(joanId, "lead_no_answer") != null, "Joan: email filled, her flow untouched");

      ok(updatedBefore(ivanId) === ivanUpdated && updatedBefore(joanId) === joanUpdated, "Ivan and Joan keep their updated time, so nothing is rescored");

      // Kevin: the new Holding column. Laura: Message undelivered, no flow there.
      const holding = listStages().find((x) => x.name === "Holding");
      ok(!!holding && lead("g-kevin").stageId === holding.id && holding.role == null, "Kevin: Holding");
      ok(lead("g-laura").stageId === col("undelivered") && queued(lead("g-laura").id).length === 0, "Laura: Message undelivered, no flow");

      // Nothing was sent, and nothing told anyone.
      ok(fake.sent.length === 0, "nothing sent");
      ok(tdb.select().from(schema.notifications).all().length === 0, "no notifications");
      ok(tdb.select().from(schema.automationQueue).all().every((x) => x.triggerKey !== "alert" && x.kind !== "staff_alert"), "no staff alerts queued");
      ok((controlSqlite.prepare("SELECT count(*) AS n FROM capi_events WHERE tenant_id = ?").get(s.tid) as { n: number }).n === 0, "no Meta events");
      ok(tdb.select().from(schema.automationLog).all().length === 0, "nothing in the Sent log");

      // The medical note: on the import record, nowhere else.
      ok(store.getImportedPerson({ leadId: aoife.id })?.staffMedicalNote === `${MED} Aoife`, "the staff can see it on the lead");
      ok(store.getImportedPerson({ clientId: tdb.select().from(schema.clients).where(eq(schema.clients.email, "gavin@example.com")).get()!.id })?.staffMedicalNote === `${MED} Gavin`, "and on the client");
      const everything = JSON.stringify([
        tdb.select().from(schema.leads).all(),
        tdb.select().from(schema.clients).all(),
        tdb.select().from(schema.automationQueue).all(),
        tdb.select().from(schema.contacts).all(),
      ]);
      ok(!everything.includes(MED), "not in any lead, client, message or contact");
      const tool = getLeadHealthTool({ tenantId: s.tid }, { leadId: aoife.id });
      ok(!tool.text.includes(MED), "not in what Adonis reads about the lead");
      ok(!tdb.select().from(schema.ghlImportPeople).where(eq(schema.ghlImportPeople.ghlContactId, "g-hannah")).get()!.staffMedicalNote, "not kept for a contact-only person");

      // A second run of the same files changes nothing.
      const counts = () => ({
        leads: tdb.select().from(schema.leads).all().length,
        clients: tdb.select().from(schema.clients).all().length,
        contacts: tdb.select().from(schema.contacts).all().length,
        queue: tdb.select().from(schema.automationQueue).all().length,
        runs: tdb.select().from(schema.leadFlowRuns).all().length,
        events: tdb.select().from(schema.leadStageEvents).all().length,
        stages: listStages().length,
      });
      const before = counts();
      const second = ghl.runGhlImport(s.tid, input);
      ok(second.ok && second.result.alreadyImported === 13 && second.result.leadsCreated === 0, "second run: everyone already imported");
      assert.deepEqual(counts(), before);
      n++;

      // Call back later switched on two days later: Brian's passed WhatsApp is skipped, the move still comes.
      clock.set(NOW + 2 * DAY);
      setTriggerEnabled("lead_call_back", true);
      const b = queued(brian.id);
      ok(b.find((x) => x.kind === "message")!.status === "cancelled" && b.find((x) => x.kind === "move")!.status === "queued", "switched on: the passed step skipped, the move kept");

      // Forgetting a deleted person keeps the id (no re-import), drops the note.
      store.forgetImportedPerson({ leadId: aoife.id });
      const forgotten = tdb.select().from(schema.ghlImportPeople).where(eq(schema.ghlImportPeople.ghlContactId, "g-aoife")).get()!;
      ok(forgotten.staffMedicalNote === null && forgotten.leadId === null && forgotten.tags === null, "forgotten: personal fields cleared, id kept");

      // Allow contact again clears only the do-not-contact flag.
      ok(store.allowContactAgain(fiona.id) && !tdb.select().from(schema.leads).where(eq(schema.leads.id, fiona.id)).get()!.doNotContact, "a person can allow contact again");
    });
    console.log(`ghl import e2e: ${n} checks passed.`);
  } finally {
    fake.restore();
    dropStaff();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
