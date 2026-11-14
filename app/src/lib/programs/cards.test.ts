// app/src/lib/programs/cards.test.ts
// Run: npm test -- src/lib/programs/cards.test.ts
import assert from "node:assert/strict";

import { GOAL_LABEL, NO_FILTER, actorLabel, byline, cardLine, defaultWeekdays, filterCards, filterQuery, groupByGoal, parseFilter, toCard, toStoryCard } from "./cards";
import { programContent } from "./content";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";

const cards = PLATFORM_PROGRAMS.map((t) => toCard(t));
const smolov = toCard(platformProgram("smolov-base")!);
assert.equal(cardLine(smolov), "4 days a week for 4 weeks");
assert.equal(smolov.familyLabel, "Powerlifting peak");
assert.equal(smolov.warning, "Squats four days a week at high volume. Only for lifters with a year or more of steady squatting.");
assert.equal(byline(smolov), "Smolov by Sergey Smolov");
const copy = toCard({ ...platformProgram("smolov-base")!, key: "copy-3", name: "Our Smolov" }, "Smolov base mesocycle");
assert.equal(byline(copy), "Our version, based on Smolov base mesocycle");
assert.equal(cardLine({ daysPerWeek: 1, lengthWeeks: 1 }), "1 day a week for 1 week");

assert.equal(filterCards(cards, NO_FILTER).length, PLATFORM_PROGRAMS.length);
assert.equal(filterCards(cards, { ...NO_FILTER, family: "peaking" }).length, 8);
assert.equal(filterCards(cards, { ...NO_FILTER, family: "beginner" }).length, 3);
assert.deepEqual(
  filterCards(cards, { ...NO_FILTER, days: "5+" }).map((c) => c.key).sort(),
  ["arnold-style-split", "fst-7-style", "phat", "push-pull-legs", "rp-style-hypertrophy-block", "y3t-style"],
);
assert.ok(filterCards(cards, { ...NO_FILTER, days: "3" }).every((c) => c.daysPerWeek <= 3));
assert.equal(filterCards(cards, { ...NO_FILTER, length: "short" }).length, 8);
assert.ok(filterCards(cards, { ...NO_FILTER, length: "medium" }).every((c) => c.lengthWeeks >= 7 && c.lengthWeeks <= 12));
assert.equal(filterCards(cards, { family: "peaking", days: "4", length: "short" }).length, 4);

assert.deepEqual(defaultWeekdays(3), [1, 3, 5]);
assert.deepEqual(defaultWeekdays(4), [1, 2, 4, 5]);
assert.deepEqual(defaultWeekdays(6), [1, 2, 3, 4, 5, 6]);
assert.deepEqual(defaultWeekdays(9), [1, 2, 3, 4, 5, 6, 7]);

assert.equal(actorLabel("engine", null, true), "Program");
assert.equal(actorLabel("member", null, true), "You");
assert.equal(actorLabel("member", null, false), "Member");
assert.equal(actorLabel("staff:4", "Ann Byrne", true), "Coach Ann Byrne");
assert.equal(actorLabel("staff:4", null, false), "Coach");

// ── the Programs tab: filters in the URL, story cards, goal groups ──
assert.deepEqual(parseFilter({}), NO_FILTER);
assert.deepEqual(parseFilter({ goal: "peaking", days: "4", length: "short" }), { family: "peaking", days: "4", length: "short" });
assert.deepEqual(parseFilter({ goal: ["size", "strength"], days: "9", length: "forever" }), { family: "size", days: "any", length: "any" }, "unknown values fall back to any");
assert.equal(filterQuery(NO_FILTER), "");
assert.equal(filterQuery({ family: "peaking", days: "5+", length: "any" }), "?goal=peaking&days=5%2B");
assert.deepEqual(parseFilter(Object.fromEntries(new URLSearchParams(filterQuery({ family: "beginner", days: "5+", length: "long" }).slice(1)))), { family: "beginner", days: "5+", length: "long" }, "a filter survives the round trip");

const sm = platformProgram("smolov-base")!;
const story = toStoryCard(sm, programContent(sm, { kind: "platform" }));
assert.equal(story.summary, sm.summary);
assert.deepEqual(story.tags, ["4 days", "4 weeks", "Squat"]);
assert.equal(story.phases.length, sm.phases!.length);
const bbbT = platformProgram("531-bbb")!;
assert.deepEqual(toStoryCard(bbbT, programContent(bbbT, { kind: "platform" })).tags, ["4 days", "Repeats every 4 weeks", "4 lifts"]);
const groups = groupByGoal(PLATFORM_PROGRAMS.map((t) => toStoryCard(t, programContent(t, { kind: "platform" }))));
assert.deepEqual(groups.map((g) => g.label), ["Get strong", "Peak your total", "Start lifting", "Build size"]);
assert.equal(groups.reduce((n, g) => n + g.cards.length, 0), PLATFORM_PROGRAMS.length);
assert.equal(GOAL_LABEL.size, "Build size");
assert.deepEqual(groupByGoal(filterCards(groups.flatMap((g) => g.cards), { ...NO_FILTER, family: "size" })).map((g) => g.family), ["size"], "a filter leaves out empty groups");

console.log("programs/cards: ok");
