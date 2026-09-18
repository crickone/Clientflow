// Run: npm test -- src/lib/platform/fleet.test.ts
//
// Platform Console v2, slice 8: fleet-wide switches and the tenant list.
//
// The switches are the dangerous half. A kill switch that is stored but not
// CHECKED is worse than none, because it tells an operator the platform is
// stopped while it carries on spending — so the test asserts the real spend
// gates see it:
//
//   - assertAiAllowed throws while AI is stopped, for a tenant that would
//     otherwise be allowed;
//   - isStopped is fail-open (a switch that cannot be read never stops the
//     platform, because the control database being down is not the failure
//     this guards against);
//   - stopping needs a reason, restarting does not;
//   - the reason, who set it and when are all kept.
//
// Then the list: filters by status, by archived, by a staff member's email,
// and an archived business sorts to the bottom rather than disappearing.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("next/navigation.redirect() stub called unexpectedly in fleet.test.ts"); } };
  }
  if (request === "next/headers") {
    return { cookies: () => { throw new Error("no request scope"); }, headers: () => { throw new Error("no request scope"); } };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const fleet = requireLocal("./fleet") as typeof import("./fleet");
  const { assertAiAllowed, AiCapError } = requireLocal("../ai/usage") as typeof import("../ai/usage");

  const made: number[] = [];
  const mk = (slug: string, opts: { status?: string; exempt?: boolean; archived?: boolean } = {}) => {
    const id = (
      controlSqlite
        .prepare("INSERT INTO tenants (slug, name, db_file, is_active, archived_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
        .get(slug, slug.replace(/-/g, " "), `tenants/${slug}/${slug}.db`, opts.archived ? 0 : 1, opts.archived ? Date.now() : null) as { id: number }
    ).id;
    made.push(id);
    if (opts.status || opts.exempt) {
      controlSqlite
        .prepare("INSERT INTO tenant_billing (tenant_id, status, billing_exempt, anchor_day) VALUES (?, ?, ?, 1)")
        .run(id, opts.status ?? "active", opts.exempt ? 1 : 0);
    }
    return id;
  };

  const active = mk("fleet-active", { status: "active" });
  const pastDue = mk("fleet-pastdue", { status: "past_due" });
  const exempt = mk("fleet-exempt", { status: "active", exempt: true });
  const archived = mk("fleet-archived", { status: "active", archived: true });

  // Somebody who works at one of them, to prove the email search reaches
  // through memberships.
  const userId = (
    controlSqlite
      .prepare("INSERT INTO users (email, name, password_hash, role, is_active) VALUES (?, ?, 'x', 'staff', 1) RETURNING id")
      .get("findme@fleet-test.local", "Find Me") as { id: number }
  ).id;
  controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'admin', 1)").run(userId, pastDue);

  const cleanup = () => {
    for (const id of made) {
      controlSqlite.prepare("DELETE FROM memberships WHERE tenant_id = ?").run(id);
      controlSqlite.prepare("DELETE FROM tenant_billing WHERE tenant_id = ?").run(id);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(id);
    }
    controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(userId);
    for (const k of ["ai", "email", "posting"]) {
      controlSqlite.prepare("DELETE FROM platform_settings WHERE key = ?").run(`kill_switch_${k}`);
    }
  };

  try {
    // ── the switches ─────────────────────────────────────────────────────
    const initial = fleet.listKillSwitches();
    assert.equal(initial.length, 3, "three switches");
    assert.ok(initial.every((s) => !s.stopped), "nothing is stopped to start with");
    assert.ok(initial.every((s) => s.blurb.length > 10), "each says what it actually stops");

    assert.equal(fleet.setKillSwitch("ai", true, "", "test").ok, false, "stopping needs a reason");
    assert.equal(fleet.setKillSwitch("ai", true, "x", "test").ok, false, "…a real one");

    const stopped = fleet.setKillSwitch("ai", true, "OpenRouter is billing for failures", "admin:1");
    assert.ok(stopped.ok, "an owner can stop the fleet");
    assert.match(stopped.ok ? stopped.note : "", /Nothing is lost/, "the note says work is not destroyed");

    const state = fleet.listKillSwitches().find((s) => s.key === "ai")!;
    assert.equal(state.stopped, true);
    assert.equal(state.reason, "OpenRouter is billing for failures", "the reason is kept");
    assert.equal(state.by, "admin:1", "and who set it");
    assert.ok(state.since && state.since > 0, "and when");
    assert.equal(fleet.isStopped("ai"), true);
    assert.equal(fleet.isStopped("email"), false, "stopping one does not stop the others");
    assert.equal(fleet.isStopped("posting"), false);

    // ── THE PROPERTY: the real spend gate honours it ─────────────────────
    // This tenant has no usage and no suspension, so the only thing that can
    // refuse it is the fleet switch.
    assert.throws(
      () => assertAiAllowed(active),
      (err: unknown) => err instanceof AiCapError && /paused across the platform/i.test((err as Error).message),
      "assertAiAllowed REFUSES while AI is stopped — the switch is checked where the money is spent",
    );

    assert.ok(fleet.setKillSwitch("ai", false, "", "admin:1").ok, "restarting needs no reason");
    assert.equal(fleet.isStopped("ai"), false);
    assert.doesNotThrow(() => assertAiAllowed(active), "…and the gate opens again");
    assert.equal(fleet.listKillSwitches().find((s) => s.key === "ai")!.reason, null, "the old reason is cleared");

    // Fail-open: a stored value that cannot be parsed must not stop anyone.
    controlSqlite
      .prepare("INSERT INTO platform_settings (key, value) VALUES ('kill_switch_email', 'not json') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run();
    assert.equal(fleet.isStopped("email"), false, "unreadable state is treated as running, never as stopped");

    assert.equal(fleet.setKillSwitch("nonsense" as "ai", true, "why", "test").ok, false, "an unknown switch is refused");

    // ── the list ─────────────────────────────────────────────────────────
    const all = fleet.listFleet();
    const ids = all.map((t) => t.id);
    for (const id of [active, pastDue, exempt, archived]) {
      assert.ok(ids.includes(id), "every business is listed by default, archived included");
    }
    const archivedRow = all.find((t) => t.id === archived)!;
    assert.ok(archivedRow.archivedAt, "the archived one carries its date");
    assert.ok(
      ids.indexOf(archived) > Math.max(ids.indexOf(active), ids.indexOf(pastDue)),
      "…and sorts below the live ones rather than vanishing",
    );

    // Assertions are scoped to THIS test's own rows: the development
    // control database holds real tenants (some of them billing-exempt),
    // and a filter test that assumed an empty fleet would pass only by
    // luck and fail the moment somebody provisions anything.
    const mine = new Set([active, pastDue, exempt, archived]);
    const filterIds = (f: Parameters<typeof fleet.listFleet>[0]) =>
      fleet.listFleet(f).map((t) => t.id).filter((id) => mine.has(id));

    assert.deepEqual(filterIds({ status: "past_due" }), [pastDue], "filtering by billing status");
    assert.deepEqual(filterIds({ status: "archived" }), [archived], "filtering by archived");
    assert.deepEqual(filterIds({ status: "exempt" }), [exempt], "filtering by exempt");
    assert.equal(
      fleet.listFleet({ status: "active" }).some((t) => t.id === archived),
      false,
      "an archived business is never in a billing-status filter, whatever its billing row says",
    );

    assert.deepEqual(filterIds({ q: "fleet-pastdue" }), [pastDue], "searching by slug");
    assert.deepEqual(
      filterIds({ q: "findme@fleet-test" }),
      [pastDue],
      "SEARCHING BY A STAFF MEMBER'S EMAIL finds their business",
    );
    assert.equal(fleet.listFleet({ q: "no-such-business-anywhere" }).length, 0);

    const row = fleet.listFleet({ q: "fleet-pastdue" })[0];
    assert.equal(row.users, 1, "the people count comes back with the row");
    assert.equal(row.billingStatus, "past_due");

    console.log("fleet.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
