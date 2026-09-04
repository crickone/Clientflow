// Run: npm test -- src/lib/marketing/calendarNotes.test.ts
//
// getPlanBriefing decides what direction the AI actually receives when it
// writes a campaign, so the window it selects matters: the year plan plus the
// CURRENT month and the next two — never all twelve, which would crowd out the
// rest of the business context. The rolling window must also cross a year
// boundary correctly (in November, "next two" reaches into January).
//
// Storage is per-tenant settings, so this drives the pure formatting through a
// stubbed store rather than provisioning a tenant.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;

// In-memory stand-in for the settings table.
const store = new Map<string, unknown>();
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/settings" || request.endsWith("/settings")) {
    return {
      readKey: <T>(key: string, fallback: T): T =>
        store.has(key) ? (store.get(key) as T) : fallback,
      setKey: (key: string, value: unknown) => store.set(key, value),
    };
  }
  if (request === "server-only") return {};
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const { getCalendarNotes, setYearPlan, setMonthNote, getPlanBriefing } =
  requireLocal("./calendarNotes") as typeof import("./calendarNotes");

// Empty to start.
ok("no notes yields an empty briefing", getPlanBriefing(new Date("2026-03-10T00:00:00Z")) === "");
ok("empty year reads as blank plan", getCalendarNotes(2026).yearPlan === "");

setYearPlan(2026, "  Grow small-group coaching. No discounting before March.  ");
ok("year plan is trimmed on save", getCalendarNotes(2026).yearPlan === "Grow small-group coaching. No discounting before March.");

setMonthNote(2026, 3, "Launch the small-group programme");
setMonthNote(2026, 4, "Push referrals");
setMonthNote(2026, 9, "Back to school / routine reset");

// March: the window is Mar/Apr/May → Sept must NOT appear.
const march = getPlanBriefing(new Date("2026-03-10T00:00:00Z"));
ok("briefing carries the year plan", march.includes("Grow small-group coaching"));
ok("briefing includes the current month", march.includes("March 2026: Launch the small-group programme"));
ok("briefing includes next month", march.includes("April 2026: Push referrals"));
ok("briefing EXCLUDES a far-off month", !march.includes("Back to school"));

// A blank note clears rather than storing an empty string.
setMonthNote(2026, 4, "   ");
ok("blank note is cleared", getCalendarNotes(2026).months["4"] === undefined);
ok(
  "cleared month drops out of the briefing",
  !getPlanBriefing(new Date("2026-03-10T00:00:00Z")).includes("Push referrals"),
);

// Year boundary: from November the window reaches into the NEXT year's notes.
setMonthNote(2026, 12, "Christmas gift vouchers");
setYearPlan(2027, "Open the second studio.");
setMonthNote(2027, 1, "New year intake");
const november = getPlanBriefing(new Date("2026-11-05T00:00:00Z"));
ok("November briefing includes December", november.includes("December 2026: Christmas gift vouchers"));
ok(
  "November briefing rolls into next January",
  november.includes("January 2027: New year intake"),
);

// Out-of-range months are ignored rather than corrupting the map.
setMonthNote(2026, 13, "nope");
setMonthNote(2026, 0, "nope");
ok("month 13 is rejected", getCalendarNotes(2026).months["13"] === undefined);
ok("month 0 is rejected", getCalendarNotes(2026).months["0"] === undefined);

// Malformed stored data must not throw — settings rows are hand-editable.
store.set("marketing_calendar_notes_2030", "not an object");
const junk = getCalendarNotes(2030);
ok("malformed row degrades to empty", junk.yearPlan === "" && Object.keys(junk.months).length === 0);

console.log(`calendarNotes.test.ts: all ${passed} assertions passed`);
