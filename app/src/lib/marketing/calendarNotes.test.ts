// Run: npm test -- src/lib/marketing/calendarNotes.test.ts
//
// getPlanBriefing decides what direction the AI actually receives when it
// writes a campaign. The month notes are now the ONLY place that direction
// lives (the year-plan field was removed), so the briefing carries the WHOLE
// year — that's what lets the agent see the shape of it ("we launch in March,
// so hold the discounting in February") rather than just what's in front of it.
// Months from today onward lead; past months follow as context; early NEXT year
// is included so a December campaign can see January.
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

const { getCalendarNotes, setMonthNote, addCampaignNote, getPlanBriefing } =
  requireLocal("./calendarNotes") as typeof import("./calendarNotes");

// Empty to start.
ok("no notes yields an empty briefing", getPlanBriefing(new Date("2026-03-10T00:00:00Z")) === "");
ok("empty year has no months", Object.keys(getCalendarNotes(2026).months).length === 0);

setMonthNote(2026, 1, "New year intake push");
setMonthNote(2026, 3, "Launch the small-group programme");
setMonthNote(2026, 4, "Push referrals");
setMonthNote(2026, 9, "Back to school / routine reset");

// From March: Mar/Apr/Sep lead as upcoming, January follows as past context.
// The WHOLE year is present — that's the point of dropping the rolling window.
const march = getPlanBriefing(new Date("2026-03-10T00:00:00Z"));
ok("current month is included", march.includes("March: Launch the small-group programme"));
ok("next month is included", march.includes("April: Push referrals"));
ok("a FAR-OFF later month is included too", march.includes("September: Back to school"));
ok("a PAST month is kept as context", march.includes("January: New year intake push"));
ok("upcoming months are headed as the plan for the rest of the year", march.includes("rest of 2026"));
ok("past months are labelled as context", march.includes("Earlier in 2026, for context:"));
ok(
  "upcoming leads: March appears before the past-context January",
  march.indexOf("March:") < march.indexOf("January:"),
);

// A blank note clears rather than storing an empty string.
setMonthNote(2026, 4, "   ");
ok("blank note is cleared", getCalendarNotes(2026).months["4"] === undefined);
ok(
  "cleared month drops out of the briefing",
  !getPlanBriefing(new Date("2026-03-10T00:00:00Z")).includes("Push referrals"),
);

// December must still see into next January.
setMonthNote(2027, 1, "New year intake");
const december = getPlanBriefing(new Date("2026-12-05T00:00:00Z"));
ok("December briefing reaches into next January", december.includes("January 2027: New year intake"));
ok("next-year block is labelled", december.includes("Early 2027:"));

// Long notes are trimmed so twelve of them stay affordable.
setMonthNote(2026, 5, "x".repeat(1200));
const trimmed = getPlanBriefing(new Date("2026-05-01T00:00:00Z"));
ok("a long note is truncated in the briefing", !trimmed.includes("x".repeat(500)));
ok("truncation is marked with an ellipsis", trimmed.includes("\u2026"));

// Out-of-range months are ignored rather than corrupting the map.
setMonthNote(2026, 13, "nope");
setMonthNote(2026, 0, "nope");
ok("month 13 is rejected", getCalendarNotes(2026).months["13"] === undefined);
ok("month 0 is rejected", getCalendarNotes(2026).months["0"] === undefined);

// ── Campaign notes: written by the app when a campaign is created ─────────
// They live in their OWN track so they can never clobber what the operator
// wrote, and they feed back into the briefing so the agent knows what's
// already scheduled and doesn't propose a duplicate.
setMonthNote(2026, 10, "Autumn push, target lapsed members");
addCampaignNote(2026, 10, "Autumn Reset Program — from 2026-10-26 to 2026-11-30");
const notesOct = getCalendarNotes(2026);
ok("operator note survives a campaign note", notesOct.months["10"] === "Autumn push, target lapsed members");
ok("campaign note is stored separately", notesOct.campaignNotes["10"]?.[0]?.startsWith("Autumn Reset Program"));

// And the reverse: writing the operator note again must not drop the campaign line.
setMonthNote(2026, 10, "Autumn push, edited");
ok(
  "editing the operator note preserves campaign notes",
  getCalendarNotes(2026).campaignNotes["10"]?.length === 1,
);

// De-duplicated, so re-running a create doesn't stack identical lines.
addCampaignNote(2026, 10, "Autumn Reset Program — from 2026-10-26 to 2026-11-30");
ok("identical campaign note is not duplicated", getCalendarNotes(2026).campaignNotes["10"]?.length === 1);

const october = getPlanBriefing(new Date("2026-10-01T00:00:00Z"));
ok("briefing carries the operator note", october.includes("Autumn push, edited"));
ok("briefing flags what's already scheduled", october.includes("Already scheduled: Autumn Reset Program"));

// A month with ONLY a campaign note still reaches the agent.
addCampaignNote(2026, 11, "Black Friday offer — from 2026-11-27");
ok(
  "a campaign-only month appears in the briefing",
  getPlanBriefing(new Date("2026-10-01T00:00:00Z")).includes("Black Friday offer"),
);

// Out-of-range months rejected here too.
addCampaignNote(2026, 13, "nope");
ok("campaign note month 13 is rejected", getCalendarNotes(2026).campaignNotes["13"] === undefined);

// Malformed stored data must not throw — settings rows are hand-editable.
store.set("marketing_calendar_notes_2030", "not an object");
ok("malformed row degrades to empty", Object.keys(getCalendarNotes(2030).months).length === 0);
ok("malformed row has no campaign notes", Object.keys(getCalendarNotes(2030).campaignNotes).length === 0);

console.log(`calendarNotes.test.ts: all ${passed} assertions passed`);
