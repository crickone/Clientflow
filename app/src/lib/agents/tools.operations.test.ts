// Run: npm test -- src/lib/agents/tools.operations.test.ts
//
// Verifies Operations Task 1 (Operations tools + registry wiring): the one
// WRITE tool (send_client_whatsapp) is registered in @/lib/assistant/tools's
// WRITE_TOOLS (the code-level barrier that keeps it off the chat loop's
// auto-execute path and forces an operator Approve click) while the two READ
// tools (list_no_shows, list_lapsed_members) are NOT; all three are
// registered in TOOLS; list_no_shows/list_lapsed_members branch correctly on
// getSchedulingMode() for BOTH "appointments" (clinic) and "timetable" (gym)
// venues; and send_client_whatsapp's guard/resolution paths (missing text,
// missing/unknown/ambiguous client, a real name or id resolving to a
// clientId) all behave correctly WITHOUT ever reaching the live WhatsApp API
// — this scratch tenant has no WhatsApp credentials configured, so
// getWhatsAppBridge() (@/lib/whatsapp) throws its own clean, synchronous
// "not connected" error before any network call is attempted; asserting on
// THAT specific error (rather than a resolution error) is what proves
// clientName/clientId resolution actually succeeded.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). This mirrors
// the exact pattern of src/lib/agents/tools.sales.test.ts (Task 7) and
// tools.marketing.test.ts (Marketing Task 1).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// tools.operations.ts -> @/lib/db/tenant (react `cache`, next/headers) and,
// separately, -> @/lib/settings / @/lib/attendance / @/lib/queries /
// @/lib/whatsapp/send -> @/lib/db (the ambient `db` proxy) -> @/lib/tenants
// -> @/lib/auth -> `next/navigation` — both at module scope. Same two-part
// shim as tools.sales.test.ts / tools.marketing.test.ts, for the same
// reason: under the runner's `--conditions=react-server`, npm's react
// "react-server" entry throws on load, so `cache` needs stubbing; and
// next/navigation's real module drags in Next's client-router internals
// which need genuine React internals we don't have reason to load here
// (redirect() is never actually called in this test's code path). Installed
// via a dynamic require (below) rather than a static import, since a static
// `import ... from "./tools.operations"` would be hoisted and evaluated
// before this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in tools.operations.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as tools.sales.test.ts).
(async () => {
  const { controlSqlite } =
    requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant } =
    requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { appointments, clients, classSessions, sessionBookings } =
    requireLocal("../db/schema") as typeof import("../db/schema");
  const { setSchedulingMode } =
    requireLocal("../settings") as typeof import("../settings");
  const {
    listNoShowsTool,
    listLapsedMembersTool,
    sendClientWhatsappTool,
  } = requireLocal("./tools.operations") as typeof import("./tools.operations");
  const { TOOLS, WRITE_TOOLS } =
    requireLocal("../assistant/tools") as typeof import("../assistant/tools");

  // ── scratch tenant (control row + a real tenant DB file, so
  // getTenantDbById() resolves it, ensureTenantTables() gives us real
  // `clients`/`appointments`/`class_sessions`/`session_bookings`/`settings`
  // tables to seed into) ──
  const slug = "agents-operations-tools-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
    )
    .get(slug, "Agents Operations Tools Test", dbFile) as { id: number };
  const tid = t.id;
  const ctx = { tenantId: tid };

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), {
        recursive: true,
        force: true,
      });
    } catch {
      // best effort
    }
  };

  try {
    // ── (a) THE SAFETY PROPERTY: send_client_whatsapp is gated behind
    // Approve; the two read tools are not. If send_client_whatsapp were
    // missing from WRITE_TOOLS, the agent could message a client with no
    // operator approval — this is the hard-check the task calls out. ──
    assert.ok(WRITE_TOOLS.has("send_client_whatsapp"), "send_client_whatsapp is a write tool (requires Approve)");
    assert.ok(!WRITE_TOOLS.has("list_no_shows"), "list_no_shows is a read tool — must NOT require approval");
    assert.ok(!WRITE_TOOLS.has("list_lapsed_members"), "list_lapsed_members is a read tool — must NOT require approval");

    const toolNames = new Set(TOOLS.map((tool) => tool.name));
    for (const name of ["list_no_shows", "list_lapsed_members", "send_client_whatsapp"]) {
      assert.ok(toolNames.has(name), `"${name}" is registered in TOOLS`);
    }

    // getTenantDbById(tid) resolves the scratch tenant and creates its tables.
    const db = getTenantDbById(tid);

    const DAY = 86_400_000;
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const daysAgo = (n: number) => iso(new Date(Date.now() - n * DAY));
    const daysAhead = (n: number) => iso(new Date(Date.now() + n * DAY));

    // ── seed: "appointments" mode fixtures ──
    const noShowClient = db
      .insert(clients)
      .values({ firstName: "Nora", lastName: "NoShow", phone: "0850000001", email: "nora@example.com" })
      .returning()
      .get();
    const lapsedClient = db
      .insert(clients)
      .values({ firstName: "Lena", lastName: "Lapsed", phone: "0850000002", email: null })
      .returning()
      .get();
    db.insert(clients).values({ firstName: "Sam", lastName: "Ambig", phone: "0850000003" }).run();
    db.insert(clients).values({ firstName: "Sam", lastName: "Ambiguous", phone: "0850000004" }).run();

    // A PAST no-show (within the default 30-day window) — must be returned.
    db.insert(appointments)
      .values({ clientId: noShowClient.id, date: daysAgo(5), startTime: "10:00", endTime: "10:30", status: "no_show" })
      .run();
    // A no-show OUTSIDE the default 30-day window — must be excluded by default.
    db.insert(appointments)
      .values({ clientId: noShowClient.id, date: daysAgo(100), startTime: "09:00", endTime: "09:30", status: "no_show" })
      .run();
    // A FUTURE, still-scheduled appointment — never a no-show, and (per
    // @/lib/queries.ts's listClients "active" definition) this also makes
    // noShowClient count as ACTIVE, so they must be excluded from the lapsed
    // list below despite the no-shows above.
    db.insert(appointments)
      .values({ clientId: noShowClient.id, date: daysAhead(3), startTime: "11:00", endTime: "11:30", status: "scheduled" })
      .run();

    // ── list_no_shows (READ, "appointments" mode — the default for a fresh
    // scratch tenant: no venue_type/scheduling_mode row exists yet, and
    // getVenueType() defaults to "clinic"). getSchedulingMode() reads the
    // AMBIENT tenant, so every call below must run inside runWithTenant. ──
    const noShowsPayload = JSON.parse(runWithTenant(tid, () => listNoShowsTool(ctx, {})).text) as {
      mode: string;
      noShows: { clientId: number; clientName: string; date: string; time: string }[];
    };
    assert.equal(noShowsPayload.mode, "appointments", "a fresh scratch tenant defaults to appointments scheduling mode");
    const pastNoShow = noShowsPayload.noShows.find((r) => r.clientId === noShowClient.id && r.date === daysAgo(5));
    assert.ok(pastNoShow, "list_no_shows returns the seeded PAST no-show");
    assert.equal(pastNoShow?.clientName, "Nora NoShow", "list_no_shows reports the client's name");
    assert.equal(pastNoShow?.time, "10:00", "list_no_shows reports the appointment's start time");
    assert.ok(
      !noShowsPayload.noShows.some((r) => r.date === daysAhead(3)),
      "list_no_shows excludes the future, still-scheduled appointment",
    );
    assert.ok(
      !noShowsPayload.noShows.some((r) => r.date === daysAgo(100)),
      "list_no_shows excludes a no-show outside the default 30-day window",
    );
    assert.ok(
      !JSON.stringify(noShowsPayload).includes("<untrusted_external_content>"),
      "list_no_shows output is operator-entered data — like list_leads, it is never fenced",
    );

    // A wider window picks up the older no-show too — proves `days` actually
    // moves the `from` boundary, not just a hardcoded 30.
    const wideNoShows = JSON.parse(runWithTenant(tid, () => listNoShowsTool(ctx, { days: 120 })).text) as {
      noShows: { date: string }[];
    };
    assert.ok(
      wideNoShows.noShows.some((r) => r.date === daysAgo(100)),
      "days:120 widens the window to include the 100-day-old no-show",
    );

    // ── list_lapsed_members (READ, "appointments" mode) ──
    const lapsedPayload = JSON.parse((await runWithTenant(tid, async () => listLapsedMembersTool(ctx, {}))).text) as {
      mode: string;
      lapsedMembers: { clientId: number; clientName: string; lastVisitDate: string | null; phone: string; email: string | null }[];
    };
    assert.equal(lapsedPayload.mode, "appointments");
    const lapsed = lapsedPayload.lapsedMembers.find((r) => r.clientId === lapsedClient.id);
    assert.ok(lapsed, "list_lapsed_members returns the seeded inactive client (no appointments at all)");
    assert.equal(lapsed?.clientName, "Lena Lapsed");
    assert.equal(lapsed?.phone, "0850000002", "phone is always surfaced — clients.phone is NOT NULL");
    assert.equal(lapsed?.lastVisitDate, null, "a client with no completed appointment has no last-visit date");
    assert.ok(
      !lapsedPayload.lapsedMembers.some((r) => r.clientId === noShowClient.id),
      "a client with a FUTURE appointment is active (per listClients), so is excluded from the lapsed list",
    );

    // ── switch to "timetable" mode (gym). setSchedulingMode persists via the
    // ambient tenant too, so it must also run inside runWithTenant. ──
    runWithTenant(tid, () => setSchedulingMode("timetable"));

    const ttNoShowClient = db
      .insert(clients)
      .values({ firstName: "Tara", lastName: "Timetable", phone: "0850000005" })
      .returning()
      .get();
    const ttLapsedClient = db
      .insert(clients)
      .values({ firstName: "Ivy", lastName: "Inactive", phone: "0850000006" })
      .returning()
      .get();

    // A class 2 days ago that ttNoShowClient no-showed — within the default window.
    const recentSession = db
      .insert(classSessions)
      .values({ date: daysAgo(2), startTime: "18:00", endTime: "19:00", name: "Evening Spin" })
      .returning()
      .get();
    db.insert(sessionBookings).values({ sessionId: recentSession.id, clientId: ttNoShowClient.id, status: "no_show" }).run();

    // A class 40 days ago that ttLapsedClient attended — outside clientActivity's
    // 30-day recency window, with nothing since, so they read as "inactive".
    const oldSession = db
      .insert(classSessions)
      .values({ date: daysAgo(40), startTime: "07:00", endTime: "08:00", name: "Morning Bootcamp" })
      .returning()
      .get();
    db.insert(sessionBookings).values({ sessionId: oldSession.id, clientId: ttLapsedClient.id, status: "attended" }).run();

    // ── list_no_shows (READ, "timetable" mode) — reuses listBookings' own status filter. ──
    const ttNoShows = JSON.parse(runWithTenant(tid, () => listNoShowsTool(ctx, {})).text) as {
      mode: string;
      noShows: { clientId: number; clientName: string; sessionName: string | null; date: string }[];
    };
    assert.equal(ttNoShows.mode, "timetable", "getSchedulingMode reflects the just-set timetable mode");
    const ttNoShow = ttNoShows.noShows.find((r) => r.clientId === ttNoShowClient.id);
    assert.ok(ttNoShow, "list_no_shows (timetable mode) returns the seeded no-show session booking");
    assert.equal(ttNoShow?.sessionName, "Evening Spin", "list_no_shows (timetable mode) reports the session name");
    assert.equal(ttNoShow?.date, daysAgo(2));

    // ── list_lapsed_members (READ, "timetable" mode) — reuses clientActivity's
    // own inactive-status filter, then joins clients for phone/email. ──
    const ttLapsedPayload = JSON.parse((await runWithTenant(tid, async () => listLapsedMembersTool(ctx, {}))).text) as {
      mode: string;
      lapsedMembers: { clientId: number; clientName: string; lastSessionDate: string | null; phone: string | null; email: string | null }[];
    };
    assert.equal(ttLapsedPayload.mode, "timetable");
    const ttLapsed = ttLapsedPayload.lapsedMembers.find((r) => r.clientId === ttLapsedClient.id);
    assert.ok(ttLapsed, "list_lapsed_members (timetable mode) returns a client whose only session was >30 days ago");
    assert.equal(ttLapsed?.lastSessionDate, daysAgo(40));
    assert.equal(ttLapsed?.phone, "0850000006", "timetable-mode lapsed members are joined back to clients for contact info");
    assert.ok(
      !ttLapsedPayload.lapsedMembers.some((r) => r.clientId === ttNoShowClient.id),
      "a client booked within the last 30 days (even as a no-show) reads as active, not inactive",
    );

    // ── send_client_whatsapp (WRITE) — guard + resolution paths only. This
    // scratch tenant has no whatsapp_config row, so isWhatsAppConfigured() is
    // false and getWhatsAppBridge() (@/lib/whatsapp) throws its own clean,
    // synchronous "not connected" error — no network call is ever attempted,
    // by this test or by the tool. ──
    const missingText = JSON.parse(
      (await runWithTenant(tid, async () => sendClientWhatsappTool(ctx, { clientName: "Lena Lapsed" }))).text,
    );
    assert.ok(missingText.error, "send_client_whatsapp requires text");

    const missingIdentifier = JSON.parse(
      (await runWithTenant(tid, async () => sendClientWhatsappTool(ctx, { text: "hi" }))).text,
    );
    assert.ok(missingIdentifier.error, "send_client_whatsapp requires clientId or clientName");

    const unknownName = JSON.parse(
      (await runWithTenant(tid, async () => sendClientWhatsappTool(ctx, { clientName: "Nobody Here", text: "hi" }))).text,
    );
    assert.ok(unknownName.error, "send_client_whatsapp errors cleanly for an unmatched name");

    const unknownId = JSON.parse(
      (await runWithTenant(tid, async () => sendClientWhatsappTool(ctx, { clientId: 9_999_999, text: "hi" }))).text,
    );
    assert.ok(unknownId.error, "send_client_whatsapp errors cleanly for an unknown clientId");

    const ambiguous = JSON.parse(
      (await runWithTenant(tid, async () => sendClientWhatsappTool(ctx, { clientName: "Sam", text: "hi" }))).text,
    );
    assert.ok(ambiguous.error, "send_client_whatsapp rejects an ambiguous name match");
    assert.ok(
      ambiguous.error.includes("Sam Ambig") && ambiguous.error.includes("Sam Ambiguous"),
      "the ambiguity error names the candidates",
    );

    // The resolution path itself: a valid, UNAMBIGUOUS client name resolves to
    // a real clientId and reaches the send attempt. Proven without a live
    // send: a "No client matching" / "Provide clientId" error here would mean
    // resolution failed; only the bridge's OWN "not connected" error proves
    // resolution succeeded and execution moved past it to attempt the send.
    const resolvedByName = JSON.parse(
      (await runWithTenant(tid, async () => sendClientWhatsappTool(ctx, { clientName: "Lena Lapsed", text: "We miss you!" }))).text,
    );
    assert.match(
      resolvedByName.error,
      /WhatsApp is not connected/,
      "clientName resolved to a real clientId and reached the (unconfigured) send attempt",
    );

    // Same proof via a direct clientId instead of a name.
    const resolvedById = JSON.parse(
      (await runWithTenant(tid, async () => sendClientWhatsappTool(ctx, { clientId: lapsedClient.id, text: "We miss you!" }))).text,
    );
    assert.match(
      resolvedById.error,
      /WhatsApp is not connected/,
      "a direct clientId is also resolved and reaches the same send attempt",
    );

    console.log("tools.operations.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
