// Run: npm test -- src/lib/booking/treatmentGroups.test.ts
import assert from "node:assert/strict";

import {
  baseName,
  familyOf,
  filterGroups,
  groupFor,
  groupTreatments,
  lengthLabel,
  pickOption,
  priceHint,
  tileLabel,
} from "./treatmentGroups";

const t = (id: number, name: string, mins: number, price: number) => ({
  id,
  name,
  defaultDurationMinutes: mins,
  defaultPriceEur: price,
});

// A clinic list shaped like the one this was designed from.
const LIST = [
  t(1, "HBOT", 60, 95),
  t(2, "Infrared Therapy", 15, 65),
  t(3, "PEMF Therapy", 30, 65),
  t(16, "Cupping massage", 60, 80),
  t(17, "Deep tissue massage", 60, 80),
  t(18, "Deep tissue massage (30 min)", 30, 50),
  t(19, "Hot lava shells", 60, 100),
  t(20, "Indian head massage", 40, 60),
  t(21, "Lymphatic drainage", 60, 80),
  t(22, "Oncology cancer care massage", 60, 80),
  t(23, "Pamper yourself", 90, 120),
  t(24, "Reflexology", 60, 80),
  t(25, "Sculpting lifting facial", 60, 80),
  t(29, "Swedish massage (30 min)", 30, 50),
  t(28, "Swedish massage", 60, 80),
  t(30, "Gift wrapping", 5, 2),
];

// ------------------------------------------------------------ names + groups
assert.equal(baseName("Swedish massage (30 min)"), "Swedish massage");
assert.equal(baseName("Swedish massage (30 mins)"), "Swedish massage");
assert.equal(baseName("Swedish massage ( 45 minutes )"), "Swedish massage");
assert.equal(baseName("HBOT"), "HBOT");
assert.equal(baseName("Session (couples)"), "Session (couples)", "only a length suffix is removed");

assert.equal(groupFor("HBOT"), "Recovery");
assert.equal(groupFor("Infrared Therapy"), "Recovery");
assert.equal(groupFor("HIFEM Therapy"), "Recovery");
assert.equal(groupFor("Indian head massage"), "Specialist", "specialist wins over the word massage");
assert.equal(groupFor("Oncology cancer care massage"), "Specialist");
assert.equal(groupFor("Swedish massage"), "Massage");
assert.equal(groupFor("Hot lava shells"), "Massage");
assert.equal(groupFor("Yoga class"), "Other");

assert.equal(tileLabel("Swedish massage", "Massage"), "Swedish");
assert.equal(tileLabel("Massage", "Massage"), "Massage", "a bare 'Massage' keeps its name");
assert.equal(tileLabel("Oncology cancer care massage", "Specialist"), "Oncology cancer care massage", "only the Massage group shortens");

// ------------------------------------------------------------- grouping
const groups = groupTreatments(LIST);
assert.deepEqual(groups.map((g) => g.name), ["Recovery", "Massage", "Specialist", "Other"]);
assert.deepEqual(groups[0].families.map((f) => f.label), ["HBOT", "Infrared Therapy", "PEMF Therapy"]);
assert.deepEqual(groups[1].families.map((f) => f.label), ["Cupping", "Deep tissue", "Hot lava shells", "Pamper yourself", "Swedish"]);
assert.deepEqual(groups[2].families.map((f) => f.label), [
  "Indian head massage",
  "Lymphatic drainage",
  "Oncology cancer care massage",
  "Reflexology",
  "Sculpting lifting facial",
]);
assert.deepEqual(groups[3].families.map((f) => f.label), ["Gift wrapping"]);

// ------------------------------------------------------------- collapsing
const swedish = groups[1].families.find((f) => f.key === "swedish massage")!;
assert.deepEqual(swedish.options.map((o) => o.id), [29, 28], "lengths shortest first, whatever order they arrived in");
assert.equal(swedish.primary.id, 28, "the unsuffixed treatment is the default length");
assert.equal(swedish.name, "Swedish massage");
assert.equal(priceHint(swedish), "from €50");
assert.equal(lengthLabel(swedish.options[0]), "30 min · €50");
assert.equal(lengthLabel(swedish.options[1]), "60 min · €80");

const hbot = groups[0].families[0];
assert.equal(hbot.options.length, 1);
assert.equal(priceHint(hbot), "60 min · €95");

// Only suffixed rows: the shortest is the default.
const onlySuffixed = groupTreatments([t(5, "Facial (60 min)", 60, 90), t(6, "Facial (30 min)", 30, 55)]);
assert.equal(onlySuffixed[0].families[0].primary.id, 6);
assert.equal(onlySuffixed[0].families[0].name, "Facial");

// A business none of the patterns know: everything in Other, nothing lost.
const gym = groupTreatments([t(1, "Spin", 45, 12), t(2, "Pilates", 50, 15)]);
assert.deepEqual(gym.map((g) => g.name), ["Other"]);
assert.equal(gym[0].families.length, 2);

assert.deepEqual(groupTreatments([]), []);

// ------------------------------------------------------------- lookups
assert.equal(familyOf(groups, 29)?.key, "swedish massage", "a 30-minute id finds its family");
assert.equal(familyOf(groups, 999), null);
assert.equal(familyOf(groups, null), null);

assert.deepEqual(filterGroups(groups, "swed").map((g) => g.families.map((f) => f.key)), [["swedish massage"]]);
assert.deepEqual(filterGroups(groups, "30 MIN").flatMap((g) => g.families.map((f) => f.key)), ["deep tissue massage", "swedish massage"], "an option name matches");
assert.deepEqual(filterGroups(groups, "zzz"), []);
assert.equal(filterGroups(groups, "  "), groups, "a blank search changes nothing");

const deep = familyOf(groups, 17)!;
assert.equal(pickOption(deep, new Set()).id, 17, "no package: the default length");
assert.equal(pickOption(deep, new Set([18])).id, 18, "a prepaid 30-minute session picks the 30-minute length");

console.log("booking treatmentGroups: all checks passed.");
