// Run: npm test -- src/lib/trainingProgress.test.ts
//
// Weeks are Irish calendar weeks (Monday start), so a Sunday-night workout in
// summer must not slide into the next week; the strength line must not dip
// when a new exercise starts; the planner must hand out programme days in order.
import assert from "node:assert/strict";

import { dateKey, liftChange, mondayOf, nextDayAfter, planWeek, strengthCurve, weeklyTotals, weekStreak } from "./trainingProgress";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

// 2026-10-11 is a Sunday. 23:30 Irish summer time = 22:30 UTC.
const sundayNight = Date.UTC(2026, 9, 11, 22, 30);
check("Sunday night stays Sunday in Ireland", dateKey(sundayNight) === "2026-10-11");
check("its week starts Monday 5 Oct", mondayOf(dateKey(sundayNight)) === "2026-10-05");
// 00:30 Monday Irish time = 23:30 UTC Sunday.
check("just after midnight Monday is the new week", mondayOf(dateKey(Date.UTC(2026, 9, 11, 23, 30))) === "2026-10-12");

const now = Date.UTC(2026, 9, 14, 12); // Wed 14 Oct
const weeks = weeklyTotals(
  [
    { finishedAt: Date.UTC(2026, 9, 12, 9), sets: 10, volume: 1000 },
    { finishedAt: Date.UTC(2026, 9, 13, 9), sets: 12, volume: 1500 },
    { finishedAt: sundayNight, sets: 8, volume: 800 },
  ],
  3,
  now,
);
check("three weeks, oldest first", weeks.length === 3 && weeks[2].weekStart === "2026-10-12" && weeks[0].weekStart === "2026-09-28");
check("this week totals", weeks[2].workouts === 2 && weeks[2].sets === 22 && weeks[2].volume === 2500);
check("Sunday-night workout counted last week", weeks[1].workouts === 1);

check("streak counts back from last week when this week is empty", weekStreak([sundayNight, Date.UTC(2026, 9, 1, 9)], Date.UTC(2026, 9, 12, 8)) === 2);
check("a missed week breaks the streak", weekStreak([sundayNight, Date.UTC(2026, 8, 20, 9)], now) === 1);
check("no workouts, no streak", weekStreak([], now) === 0);

const squat = [
  { at: Date.UTC(2026, 9, 1, 9), e1rm: 100 },
  { at: Date.UTC(2026, 9, 8, 9), e1rm: 110 },
];
const bench = [{ at: Date.UTC(2026, 9, 13, 9), e1rm: 80 }];
const curve = strengthCurve([squat, bench], weeklyTotals([], 3, now));
check("no point until a lift has two sessions", curve.length === 2);
check("curve shows squat +10%", curve[0].value === 10);
check("a lift logged once doesn't drag the line", curve[1].value === 10);
const curve2 = strengthCurve([squat, [...bench, { at: Date.UTC(2026, 9, 14, 9), e1rm: 88 }]], weeklyTotals([], 3, now));
check("second bench session joins the average", curve2[1].value === 10);

const ch = liftChange(squat);
check("lift change in kg and %", ch !== null && ch.kg === 10 && ch.pct === 10);

const plan = planWeek({
  now,
  weekdays: [1, 3, 5],
  dayNames: ["Day A", "Day B", "Day C"],
  nextDayPosition: 1,
  logged: [{ at: Date.UTC(2026, 9, 13, 9), title: "Day A" }],
});
check("Monday trained day with nothing logged is missed", plan[0].status === "missed");
check("Tuesday rest day with a workout is done", plan[1].status === "done" && plan[1].title === "Day A");
check("Wednesday is today with the next day", plan[2].status === "today" && plan[2].title === "Day B" && plan[2].dayPosition === 1);
check("Friday gets the one after", plan[4].status === "planned" && plan[4].title === "Day C");
check("weekend is rest", plan[5].status === "rest" && plan[6].status === "rest");
check("next day wraps", nextDayAfter(2, 3) === 0 && nextDayAfter(null, 3) === 0);

console.log(`trainingProgress: ${passed} checks passed`);
