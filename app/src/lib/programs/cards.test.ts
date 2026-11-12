// app/src/lib/programs/cards.test.ts
// Run: npm test -- src/lib/programs/cards.test.ts
import assert from "node:assert/strict";

import { NO_FILTER, actorLabel, byline, cardLine, defaultWeekdays, filterCards, toCard } from "./cards";
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
assert.equal(filterCards(cards, { ...NO_FILTER, family: "peaking" }).length, 6);
assert.equal(filterCards(cards, { ...NO_FILTER, family: "beginner" }).length, 3);
assert.deepEqual(
  filterCards(cards, { ...NO_FILTER, days: "5+" }).map((c) => c.key).sort(),
  ["arnold-style-split", "phat", "push-pull-legs"],
);
assert.ok(filterCards(cards, { ...NO_FILTER, days: "3" }).every((c) => c.daysPerWeek <= 3));
assert.equal(filterCards(cards, { ...NO_FILTER, length: "short" }).length, 7);
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

console.log("programs/cards: ok");
