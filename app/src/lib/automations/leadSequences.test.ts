// Run: npm test -- src/lib/automations/leadSequences.test.ts
//
// Lead follow-up workflows, native (replacing GoHighLevel for the clinics
// that used it, 2026-11-11). Against a real scratch tenant database:
//   - an enquiry joins "New lead" when it is on, by WhatsApp and email,
//     skipping a channel the lead has no contact for
//   - a walk-in typed in by hand gets nothing
//   - with "New lead" off, an enquiry keeps getting the campaign sequence
//   - a reply stops the nudges; booking swaps them for the booked messages
//     (once, however often the card moves); a no-show swaps those for the
//     rebooking messages
//   - a WhatsApp message with WhatsApp not connected fails visibly (queue +
//     Sent log), it is never silently dropped
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead } = requireLocal("../leads") as typeof import("../leads");
  const stage = requireLocal("../pipeline/stage") as typeof import("../pipeline/stage");
  const { resolveStageIdByRole } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");
  const nurture = requireLocal("./nurture") as typeof import("./nurture");

  // Never reach a real provider.
  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

  const slug = "lead-sequences-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Lead Sequences Test", `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    await runWithTenant(tid, async () => {
      const tdb = getTenantDbById(tid);
      const queued = (leadId: number, trigger?: string) =>
        tdb
          .select()
          .from(schema.automationQueue)
          .where(
            and(
              eq(schema.automationQueue.leadId, leadId),
              eq(schema.automationQueue.status, "queued"),
              ...(trigger ? [eq(schema.automationQueue.triggerKey, trigger)] : []),
            ),
          )
          .all();
      const setTrigger = (key: string, enabled: boolean) =>
        tdb.insert(schema.automationTriggers).values({ key, enabled }).onConflictDoUpdate({ target: schema.automationTriggers.key, set: { enabled } }).run();

      // ── "New lead" off: an enquiry keeps the campaign sequence ──
      const { lead: early } = upsertLead({ source: "website", sourceLeadId: "website:early@x.ie", campaign: "Website enquiry", fullName: "Early Bird", email: "early@x.ie" });
      assert.ok(queued(early.id, "campaign_signup").length > 0, "while New lead is off, the campaign sequence runs as before");
      assert.equal(queued(early.id, "new_lead").length, 0);

      // ── switched on ──
      setTrigger("new_lead", true);
      setTrigger("lead_booked", true);
      setTrigger("lead_no_show", true);

      const { lead: aoife } = upsertLead({ source: "website", sourceLeadId: "website:aoife@x.ie", campaign: "Website enquiry", fullName: "Aoife Test", email: "aoife@x.ie", phone: "083 867 2844" });
      const seq = queued(aoife.id, "new_lead");
      assert.equal(seq.length, 4, "the default New lead sequence: WhatsApp, email, WhatsApp, WhatsApp");
      assert.deepEqual(seq.map((q) => q.channel).sort(), ["email", "whatsapp", "whatsapp", "whatsapp"]);
      assert.ok(seq.every((q) => !q.body.includes("[FIRST_NAME]") && q.body.includes("Aoife")), "personalised when queued");
      assert.equal(queued(aoife.id, "campaign_signup").length, 0, "not both sequences");

      const { lead: noPhone } = upsertLead({ source: "facebook", sourceLeadId: "fb-1", campaign: "Lead ad", fullName: "No Phone", email: "nophone@x.ie" });
      assert.deepEqual(queued(noPhone.id, "new_lead").map((q) => q.channel), ["email"], "no phone: only the email goes");

      const { lead: walkIn } = upsertLead({ source: "manual", fullName: "Walk In", email: "walkin@x.ie", phone: "0871234567" });
      assert.equal(queued(walkIn.id).length, 0, "a walk-in typed in by hand gets nothing");

      // ── a reply stops the nudges ──
      stage.onInboundFromLead(aoife.id);
      assert.equal(queued(aoife.id, "new_lead").length, 0, "they replied: a person takes over");

      // ── booking: nudges out, booked messages in, once ──
      const { lead: brian } = upsertLead({ source: "facebook", sourceLeadId: "fb-2", campaign: "Lead ad", fullName: "Brian Test", email: "brian@x.ie", phone: "0861112222" });
      assert.equal(queued(brian.id, "new_lead").length, 4);
      const booked = resolveStageIdByRole("booked", brian.pipelineId ?? undefined)!;
      const engaged = resolveStageIdByRole("engaged", brian.pipelineId ?? undefined)!;
      const noShow = resolveStageIdByRole("no_show", brian.pipelineId ?? undefined)!;
      stage.setStageToId(brian.id, booked);
      assert.equal(queued(brian.id, "new_lead").length, 0, "booking stops the come-and-book nudges");
      assert.equal(queued(brian.id, "lead_booked").length, 2);
      stage.setStageToId(brian.id, engaged);
      stage.setStageToId(brian.id, booked);
      assert.equal(queued(brian.id, "lead_booked").length, 2, "moving back and forth does not double the messages");

      // ── no-show: booked messages out, rebooking in ──
      stage.setStageToId(brian.id, noShow);
      assert.equal(queued(brian.id, "lead_booked").length, 0);
      assert.equal(queued(brian.id, "lead_no_show").length, 2);

      // ── sending: WhatsApp not connected fails visibly ──
      tdb.update(schema.automationQueue).set({ status: "cancelled" }).where(eq(schema.automationQueue.channel, "email")).run();
      const later = Date.UTC(2030, 0, 15, 14, 0, 0); // a weekday afternoon, well after everything is due
      await nurture.dispatchDueAutomationQueue(tid, later);
      const failed = tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, brian.id), eq(schema.automationQueue.triggerKey, "lead_no_show"), eq(schema.automationQueue.channel, "whatsapp"))).get();
      assert.equal(failed?.status, "failed");
      assert.match(failed?.error ?? "", /WhatsApp/);
      const log = tdb.select().from(schema.automationLog).where(eq(schema.automationLog.channel, "whatsapp")).all();
      assert.ok(log.length > 0 && log.every((l) => l.status === "failed"), "the Sent view shows the failure");
    });
    console.log("leadSequences: enrolment, channels, stop rules, booked/no-show swaps, visible WhatsApp failure; 21 checks passed.");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
