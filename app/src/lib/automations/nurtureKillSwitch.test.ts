// Run: npm test -- src/lib/automations/nurtureKillSwitch.test.ts
//
// The platform "Email sending" switch holds the nurture sequence, as its card
// promises ("Campaign sends and nurture emails"). Against a real scratch tenant:
//   - with email stopped, a due email row is left exactly as it was: still
//     queued, no error, no sent time, and nothing is sent
//   - a due WhatsApp row is NOT covered by the switch and is still attempted
//   - once email is started again, the held row is picked up on the next
//     dispatch (it is attempted, not dropped)
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
  if (request === "next/headers") {
    return { cookies: () => { throw new Error("no request scope"); }, headers: () => { throw new Error("no request scope"); } };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { setKillSwitch } = requireLocal("../platform/killSwitch") as typeof import("../platform/killSwitch");
  const nurture = requireLocal("./nurture") as typeof import("./nurture");

  // Count every outbound call; never reach a real provider.
  let outbound = 0;
  globalThis.fetch = (async () => {
    outbound++;
    return new Response("{}", { status: 500 });
  }) as typeof fetch;

  const slug = "nurture-killswitch-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Nurture Killswitch Test", `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const cleanup = () => {
    setKillSwitch("email", false, "", "test");
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    const tdb = getTenantDbById(tid);
    const dueAt = new Date(Date.UTC(2030, 0, 14, 10, 0, 0));
    const later = Date.UTC(2030, 0, 15, 14, 0, 0); // a weekday afternoon, after everything is due
    const row = (id: number) => tdb.select().from(schema.automationQueue).where(eq(schema.automationQueue.id, id)).get()!;

    const emailId = tdb
      .insert(schema.automationQueue)
      .values({ triggerKey: "campaign_signup", channel: "email", subject: "Hello", body: "Hi there", sendTo: "someone@example.com", dueAt })
      .returning({ id: schema.automationQueue.id })
      .get().id;
    const waId = tdb
      .insert(schema.automationQueue)
      .values({ triggerKey: "campaign_signup", channel: "whatsapp", body: "Hi there", sendTo: "+353851234567", dueAt })
      .returning({ id: schema.automationQueue.id })
      .get().id;

    // ── stopped: the email row is held, untouched ──
    assert.ok(setKillSwitch("email", true, "test stop", "test").ok);
    await nurture.dispatchDueAutomationQueue(tid, later);
    const held = row(emailId);
    assert.equal(held.status, "queued", "a held email stays queued");
    assert.equal(held.error, null, "a held email carries no error");
    assert.equal(held.sentAt, null, "a held email has no sent time");
    assert.equal(held.dueAt.getTime(), dueAt.getTime(), "a held email keeps its due time");
    assert.equal(outbound, 0, "nothing is sent while email is stopped");
    assert.equal(
      tdb.select().from(schema.automationLog).where(eq(schema.automationLog.channel, "email")).all().length,
      0,
      "a held email writes nothing to the Sent log",
    );
    assert.notEqual(row(waId).status, "queued", "the email switch does not cover WhatsApp: that row was still attempted");

    // ── started again: the held email goes on the next tick ──
    assert.ok(setKillSwitch("email", false, "", "test").ok);
    await nurture.dispatchDueAutomationQueue(tid, later);
    const released = row(emailId);
    assert.notEqual(released.status, "queued", "once email is running again the held row is attempted");
    assert.ok(released.sentAt, "...and stamped");
    console.log("nurtureKillSwitch: email held while stopped, WhatsApp unaffected, held row released on restart; 8 checks passed.");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
