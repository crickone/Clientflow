// Run: npx tsx src/components/clientapp/programWeeks.test.ts
import assert from "node:assert/strict";

import { dayIndexesInWeek, rotateMessage, tabLabelInWeek, weekList, weekOfIndex } from "./programWeeks";

const one = [{ week: 1, name: "Push" }, { week: 1, name: "" }];
const two = [
  { week: 1, name: "Push" },
  { week: 1, name: "" },
  { week: 2, name: "" },
  { week: 2, name: "Pull" },
];

assert.deepEqual(weekList(one), [1]);
assert.deepEqual(weekList(two), [1, 2]);
assert.deepEqual(weekList([{ week: undefined }, { week: 0 }]), [1]);
assert.deepEqual(dayIndexesInWeek(two, 2), [2, 3]);
assert.deepEqual(dayIndexesInWeek(two, 3), []);
assert.equal(weekOfIndex(two, 3), 2);
assert.equal(weekOfIndex(two, 9), 1);

// Day tabs count unnamed days within their own week
assert.equal(tabLabelInWeek(two, 1, 1), "Day 2");
assert.equal(tabLabelInWeek(two, 2, 2), "Day 1");
assert.equal(tabLabelInWeek(two, 2, 3), "Pull");

// One week reads as before
assert.equal(rotateMessage({ weeks: 1, daysPerWeek: 3, totalDays: 3 }, 0), "Pick the days you plan to train.");
assert.equal(rotateMessage({ weeks: 1, daysPerWeek: 3, totalDays: 3 }, 3), "Each training day gets the next day of your program, in order.");
assert.equal(
  rotateMessage({ weeks: 1, daysPerWeek: 4, totalDays: 4 }, 3),
  "Your program has 4 days and you picked 3. The days run in order, so they will rotate across weeks.",
);
assert.equal(
  rotateMessage({ weeks: 1, daysPerWeek: 1, totalDays: 1 }, 2),
  "Your program has 1 day and you picked 2. The days run in order, so they will rotate across weeks.",
);

// Several weeks
assert.equal(rotateMessage({ weeks: 8, daysPerWeek: 4, totalDays: 32 }, 4), "Each training day gets the next day of your program, in order, week by week.");
assert.equal(
  rotateMessage({ weeks: 8, daysPerWeek: 4, totalDays: 32 }, 3),
  "Your program has 8 weeks of 4 days and you picked 3. The days run in order, one program day for each training day.",
);
assert.equal(
  rotateMessage({ weeks: 2, daysPerWeek: null, totalDays: 7 }, 3),
  "Your program has 2 weeks and 7 days and you picked 3. The days run in order, one program day for each training day.",
);
console.log("programWeeks ok");
