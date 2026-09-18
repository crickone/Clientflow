// Run: npm test -- src/lib/dispatch/dispatch.test.ts
//
// The three things the dispatch ticker sends, each tested at the library
// level with a fixed clock, in a scratch tenant, with NO network:
//
//   - social posts (lib/social/schedule): booking validates the time and the
//     design; a due post without a Meta connection is left "scheduled" with
//     the not-connected note (once), never marked failed; cancel works;
//   - email sends (lib/marketing/schedule): schedule/unschedule flip status
//     and time; a due send whose precheck fails (no sending domain here)
//     goes BACK to draft with the reason on its stats and the time cleared;
//   - the nurture sequence (lib/automations/nurture): a lead created on a
//     campaign is enrolled with the default three messages spaced by their
//     delays; only the due one is attempted; a lead marked lost is
//     cancelled; the trigger can be switched off; parseWhen reads Irish
//     local time correctly in summer and winter.
//
// Sending itself is not exercised (no email provider is configured here):
// the attempted message is asserted to be recorded as failed in
// automation_log, which is the honest outcome for this environment.
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
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("next/navigation.redirect() stub called unexpectedly in dispatch.test.ts"); } };
  }
  if (request === "next/cache") return { revalidatePath: () => {} };
  if (request === "next/headers") return { headers: () => { throw new Error("no request"); }, cookies: () => { throw new Error("no request"); } };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { db, schema } = requireLocal("../db") as typeof import("../db");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { createCarousel, addSlide } = requireLocal("../image/carousels") as typeof import("../image/carousels");
  const social = requireLocal("../social/schedule") as typeof import("../social/schedule");
  const email = requireLocal("../marketing/schedule") as typeof import("../marketing/schedule");
  const { createCampaign: createEmailCampaign, getCampaign: getEmailCampaign } =
    requireLocal("../marketing/campaigns") as typeof import("../marketing/campaigns");
  const nurture = requireLocal("../automations/nurture") as typeof import("../automations/nurture");
  const { upsertLead } = requireLocal("../leads") as typeof import("../leads");
  const { setStageToId } = requireLocal("../pipeline/stage") as typeof import("../pipeline/stage");
  const { resolveStageIdByRole } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");
  const { parseWhen } = requireLocal("../agents/tools.schedule") as typeof import("../agents/tools.schedule");

  const slug = "dispatch-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Dispatch Test", dbFile) as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    getTenantDbById(tid);
    const HOUR = 3_600_000;
    const DAY = 24 * HOUR;

    // ── parseWhen: Irish local time, not the server's ──
    assert.equal(parseWhen("2026-07-01T09:00")!.toISOString(), "2026-07-01T08:00:00.000Z", "summer: 09:00 Dublin is 08:00Z");
    assert.equal(parseWhen("2026-01-15T09:00")!.toISOString(), "2026-01-15T09:00:00.000Z", "winter: 09:00 Dublin is 09:00Z");
    assert.equal(parseWhen("2026-07-01T09:00:00+02:00")!.toISOString(), "2026-07-01T07:00:00.000Z", "an explicit offset is honoured");
    assert.equal(parseWhen("nonsense"), null);

    await runWithTenant(tid, async () => {
      // ── social posts ──
      const design = createCarousel({ name: "Mon post" });
      const empty = createCarousel({ name: "Empty" });
      addSlide({ carouselSetId: design.id, slotKey: "carousel-content", templateId: "carousel-cover", aspectRatio: "1:1", caption: "cap" });
      const soon = new Date(Date.now() + 2 * HOUR);
      assert.equal(social.schedulePost({ carouselSetId: 999_999, scheduledFor: soon }).ok, false, "unknown design refused");
      assert.equal(social.schedulePost({ carouselSetId: empty.id, scheduledFor: soon }).ok, false, "a design with no slides refused");
      assert.equal(social.schedulePost({ carouselSetId: design.id, scheduledFor: new Date(Date.now() - HOUR) }).ok, false, "a past time refused");
      const booked = social.schedulePost({ carouselSetId: design.id, scheduledFor: soon, channels: ["instagram"] });
      assert.ok(booked.ok, "a future time on a real design books");
      if (!booked.ok) throw new Error("unreachable");
      assert.deepEqual(booked.post.channels, ["instagram"]);
      assert.equal(social.listScheduledPosts().length, 1);

      // Not due yet: nothing happens.
      assert.equal(await social.dispatchDueScheduledPosts(tid, "http://localhost:3000", Date.now()), 0);
      assert.equal(social.listScheduledPosts()[0].error, null, "an undue post is untouched");
      // Due, no Meta connection: stays scheduled, labelled once.
      assert.equal(await social.dispatchDueScheduledPosts(tid, "http://localhost:3000", soon.getTime() + 60_000), 0);
      let row = social.listScheduledPosts()[0];
      assert.equal(row.status, "scheduled", "without a connection the post is NOT failed");
      assert.equal(row.error, social.NOT_CONNECTED_MESSAGE);
      await social.dispatchDueScheduledPosts(tid, "http://localhost:3000", soon.getTime() + 120_000);
      row = social.listScheduledPosts()[0];
      assert.equal(row.status, "scheduled");
      assert.ok(social.cancelScheduledPost(row.id).ok, "cancel works");
      assert.equal(social.listScheduledPosts().length, 0, "a cancelled post leaves the live schedule");
      assert.equal(social.listScheduledPosts({ includeDone: true })[0].status, "cancelled");

      // ── email sends ──
      const ec = createEmailCampaign({ name: "Announce", subject: "Hi", fromName: "Us", fromEmail: "us@example.com", bodyHtml: "<p>x</p>" });
      const sendAt = new Date(Date.now() + 3 * HOUR);
      assert.equal(email.scheduleEmailCampaign(ec.id, new Date(Date.now() - 1)).ok, false, "past time refused");
      const sched = email.scheduleEmailCampaign(ec.id, sendAt);
      assert.ok(sched.ok);
      assert.equal(getEmailCampaign(ec.id)!.status, "scheduled");
      assert.equal(getEmailCampaign(ec.id)!.scheduledAt, sendAt.getTime());
      assert.equal(email.listScheduledEmailCampaigns().length, 1);
      assert.ok(email.unscheduleEmailCampaign(ec.id).ok);
      assert.equal(getEmailCampaign(ec.id)!.status, "draft");
      assert.equal(getEmailCampaign(ec.id)!.scheduledAt, null);
      assert.ok(email.scheduleEmailCampaign(ec.id, sendAt).ok);

      assert.equal(await email.dispatchDueEmailCampaigns(tid, "http://localhost:3000", Date.now()), 0, "not due: nothing sent");
      assert.equal(getEmailCampaign(ec.id)!.status, "scheduled");
      const started = await email.dispatchDueEmailCampaigns(tid, "http://localhost:3000", sendAt.getTime() + 1);
      assert.equal(started, 0, "no sending domain here, so the send does not start");
      const after = getEmailCampaign(ec.id)!;
      assert.equal(after.status, "draft", "a failed precheck returns the campaign to draft");
      assert.equal(after.scheduledAt, null);
      assert.match(email.lastScheduleError(after) ?? "", /sending domain/i, "...with the reason on it");

      // ── nurture sequence ──
      const lead = upsertLead({ source: "landing", campaign: "Summer", firstName: "Aoife", email: "aoife@example.com" }).lead;
      const queued = nurture.listQueuedForLead(lead.id);
      assert.equal(queued.length, 3, "the default three-message sequence is queued at enrolment");
      const t0 = queued[0].dueAt.getTime();
      assert.ok(Math.abs(t0 - Date.now()) < 5_000, "the first message is due now");
      assert.ok(Math.abs(queued[1].dueAt.getTime() - (t0 + 2 * DAY)) < 5_000, "the second two days later");
      assert.ok(Math.abs(queued[2].dueAt.getTime() - (t0 + 5 * DAY)) < 5_000, "the third five days later");
      assert.match(queued[0].body, /Aoife/, "the message is rendered for the person at enrolment");
      assert.equal(queued[0].sendTo, "aoife@example.com");

      const noEmail = upsertLead({ source: "landing", campaign: "Summer", firstName: "Nobody" }).lead;
      assert.equal(nurture.listQueuedForLead(noEmail.id).length, 0, "no email address, nothing queued");
      const noCampaign = upsertLead({ source: "manual", firstName: "Walk", email: "walk@example.com" }).lead;
      assert.equal(nurture.listQueuedForLead(noCampaign.id).length, 0, "a lead with no campaign is not nurtured");

      // Only the due message is attempted; it fails here (no provider) and is logged as such.
      const sent = await nurture.dispatchDueAutomationQueue(tid, Date.now() + 60_000);
      assert.equal(sent, 0);
      const afterRun = db.select().from(schema.automationQueue).where(eq(schema.automationQueue.leadId, lead.id)).all();
      assert.deepEqual(afterRun.map((r) => r.status).sort(), ["failed", "queued", "queued"].sort(), "one attempted, two still waiting");
      const logged = db.select().from(schema.automationLog).where(eq(schema.automationLog.triggerKey, nurture.NURTURE_TRIGGER_KEY)).all();
      assert.equal(logged.length, 1, "the attempt is in the Sent log");
      assert.equal(logged[0].status, "failed");
      assert.equal(logged[0].sentTo, "aoife@example.com");

      // A lost lead drops out of the sequence.
      setStageToId(lead.id, resolveStageIdByRole("lost")!);
      assert.equal(nurture.listQueuedForLead(lead.id).length, 0, "marking the lead lost cancels what was queued");

      // The operator can switch the sequence off.
      db.insert(schema.automationTriggers).values({ key: nurture.NURTURE_TRIGGER_KEY, enabled: false }).run();
      const later = upsertLead({ source: "landing", campaign: "Summer", firstName: "Off", email: "off@example.com" }).lead;
      assert.equal(nurture.listQueuedForLead(later.id).length, 0, "a disabled trigger enrols nobody");
    });

    console.log("dispatch.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
