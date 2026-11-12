// app/src/lib/programs/content.test.ts
// Run: npm test -- src/lib/programs/content.test.ts
//
// Program content: fitting phases to a copy's weeks, phases from a member's
// week labels, the byline per source, filling an old copy from its original,
// the current phase, and the content check.
import assert from "node:assert/strict";

import { ADDED_WEEKS_PHASE, contentErrors, currentPhase, fitPhases, listText, memberPhases, phaseSpan, programContent, weeksText, withContentFrom } from "./content";
import { blankMemberTemplate } from "./memberTemplate";
import type { Phase, ProgramTemplate } from "./types";
import { parseTemplate } from "./validate";

const P = (name: string, fromWeek: number, toWeek: number, note = `${name} note.`): Phase => ({ name, fromWeek, toWeek, note });

assert.equal(weeksText(3, 3), "Week 3");
assert.equal(weeksText(1, 4), "Weeks 1 to 4");
assert.equal(listText(["A"]), "A");
assert.equal(listText(["A", "B"]), "A and B");
assert.equal(listText(["A", "B", "C"]), "A, B and C");

// A block of 4 weeks, as a test fixture.
const day = { name: "Day 1", exercises: [{ name: "Back squat", lift: "squat" as const, sets: [{ kind: "pct" as const, pct: 0.7, reps: 5, rest: 180 }] }] };
const block: ProgramTemplate = {
  key: "fixture-block",
  name: "Fixture block",
  author: "By a tester",
  family: "peaking",
  level: "advanced",
  daysPerWeek: 1,
  lengthWeeks: 4,
  lifts: ["squat"],
  tmPct: 1,
  who: "Testers.",
  description: "A fixture.",
  summary: "Three heavy weeks, then a test.",
  phases: [P("Base", 1, 3), P("Test", 4, 4)],
  whyItWorks: "It is a fixture.",
  engine: { key: "fixed_block" },
  weeks: [{ days: [day] }, { days: [day] }, { days: [day] }, { label: "Test", days: [{ ...day, test: true }] }],
};

// ── fitting phases to a copy's weeks ──
assert.deepEqual(fitPhases(block.phases!, 4), block.phases, "phases that fit are kept");
assert.deepEqual(fitPhases(block.phases!, 2), [P("Base", 1, 2)], "a phase past the end is dropped, a partial one clipped");
assert.deepEqual(fitPhases(block.phases!, 6), [...block.phases!, { name: ADDED_WEEKS_PHASE, fromWeek: 5, toWeek: 6, note: "Weeks added in our version." }], "added weeks get their own phase");
assert.deepEqual(fitPhases([], 3), [{ name: "Weeks 1 to 3", fromWeek: 1, toWeek: 3, note: "" }], "no phases at all is one phase over every week");
assert.equal(phaseSpan(block, false), 4);
assert.equal(phaseSpan({ weeks: block.weeks.slice(0, 1), lengthWeeks: 12 }, true), 1);

// ── programContent by source ──
const plat = programContent(block, { kind: "platform" });
assert.equal(plat.summary, "Three heavy weeks, then a test.");
assert.equal(plat.byline, "By a tester");
assert.equal(plat.whyItWorks, "It is a fixture.");
assert.equal(plat.repeats, false);
const shortCopy: ProgramTemplate = { ...block, lengthWeeks: 3, weeks: block.weeks.slice(0, 3) };
const copy = programContent(shortCopy, { kind: "copy", basedOnName: "Fixture block" });
assert.equal(copy.byline, "Our version, based on Fixture block");
assert.deepEqual(copy.phases, [P("Base", 1, 3)], "a 3-week copy drops the test phase");
assert.equal(copy.whyItWorks, "It is a fixture.", "a copy keeps why it works");
const noContent: ProgramTemplate = { ...block, summary: undefined, phases: undefined, whyItWorks: undefined };
const bare = programContent(noContent, { kind: "platform" });
assert.equal(bare.summary, "Testers.", "no summary falls back to who it is for");
assert.equal(bare.whyItWorks, null);
assert.equal(bare.phases.length, 1);

// ── member programs ──
const member = blankMemberTemplate();
member.weeks = [
  { label: "Build", days: [{ name: "Push", exercises: [] }, { name: "Pull", exercises: [] }] },
  { label: "Build", days: [{ name: "Push", exercises: [] }, { name: "Pull", exercises: [] }] },
  { days: [{ name: "Legs", exercises: [] }] },
  { days: [{ name: "Legs", exercises: [] }] },
  { label: "Deload", days: [{ name: "Easy", exercises: [] }] },
];
assert.deepEqual(memberPhases(member), [
  { name: "Build", fromWeek: 1, toWeek: 2, note: "Push and Pull." },
  { name: "Weeks 3 to 4", fromWeek: 3, toWeek: 4, note: "Legs." },
  { name: "Deload", fromWeek: 5, toWeek: 5, note: "Easy." },
]);
const one = blankMemberTemplate();
assert.deepEqual(memberPhases(one), [{ name: "Week 1", fromWeek: 1, toWeek: 1, note: "Day 1." }], "no labels is one phase");
const mc = programContent(member, { kind: "member" });
assert.equal(mc.summary, "2 days a week, 5 weeks that repeat");
assert.equal(mc.whyItWorks, null, "no why it works for a member program");
assert.equal(mc.repeats, true);
assert.equal(mc.byline, "Built by the member");
assert.equal(programContent(one, { kind: "member" }).summary, "1 day a week, one week that repeats");

// ── an old copy takes its content from the original ──
const filled = withContentFrom(noContent, block);
assert.equal(filled.summary, block.summary);
assert.deepEqual(filled.phases, block.phases);
assert.equal(filled.whyItWorks, block.whyItWorks);
assert.notEqual(filled.phases, block.phases, "the phases are copied, not shared");
assert.equal(withContentFrom({ ...block, summary: "Ours." }, block).summary, "Ours.", "a copy's own summary is kept");
assert.equal(withContentFrom(noContent, null), noContent);

// ── the zod check keeps the new fields on a stored copy ──
const parsed = parseTemplate(JSON.parse(JSON.stringify(block)));
assert.ok(parsed.ok);
assert.equal(parsed.template.summary, block.summary);
assert.deepEqual(parsed.template.phases, block.phases);
assert.equal(parsed.template.whyItWorks, block.whyItWorks);
const longSummary = parseTemplate({ ...block, summary: "x".repeat(201) });
assert.ok(!longSummary.ok && longSummary.errors.some((e) => e.includes("summary is too long")));

// ── the current phase ──
assert.equal(currentPhase(plat, block, { week: 0, cycle: 0 }), 0);
assert.equal(currentPhase(plat, block, { week: 3, cycle: 0 }), 1);
assert.equal(currentPhase(plat, block, { week: 1, cycle: 1 }), 0, "a restarted block has its phases again");
const cycle = { ...block, lengthWeeks: 12, weeks: block.weeks.slice(0, 2), phasesRepeat: true, phases: [P("A", 1, 1), P("B", 2, 2)] };
const cc = programContent(cycle, { kind: "platform" });
assert.equal(currentPhase(cc, cycle, { week: 1, cycle: 4 }), 1, "a repeating cycle follows its week");
const stretched = { ...block, lengthWeeks: 12, weeks: block.weeks.slice(0, 2), phases: [P("Start", 1, 2), P("Climb", 3, 12)] };
const sc = programContent(stretched, { kind: "platform" });
assert.equal(currentPhase(sc, stretched, { week: 1, cycle: 2 }), 1, "week 6 is in the climb");
assert.equal(currentPhase(sc, stretched, { week: 0, cycle: 6 }), null, "round 2 of a stretched cycle has no phase");

// ── the content check ──
assert.deepEqual(contentErrors(block), []);
assert.deepEqual(contentErrors(noContent), ["fixture-block: needs a summary.", "fixture-block: needs a line on why it works.", "fixture-block: needs phases."]);
assert.deepEqual(contentErrors({ ...block, phases: [P("Base", 1, 2), P("Test", 4, 4)] }), ["fixture-block: Test should start at week 3."]);
assert.deepEqual(contentErrors({ ...block, phases: [P("Base", 1, 3)] }), ["fixture-block: the phases end at week 3, not week 4."]);
assert.deepEqual(contentErrors({ ...block, phases: [P("Base", 1, 3), P("Test", 4, 4, " ")] }), ["fixture-block: Test needs a note."]);

console.log("programs/content: ok");
