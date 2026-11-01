// Run: npm test -- src/lib/cycleModel.test.ts
import assert from "node:assert/strict";

import { addDays, averageCycleLength, averagePeriodLength, averagesByPhase, calendar, cycleLengths, cycleStatus, daysBetween, periodOn, phaseFor, statusLine, type Period } from "./cycleModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

check("addDays crosses a month", addDays("2026-10-30", 3) === "2026-11-02");
check("daysBetween is signed", daysBetween("2026-10-01", "2026-10-29") === 28 && daysBetween("2026-10-29", "2026-10-01") === -28);

const p = (id: number, startDay: string, endDay: string | null = null): Period => ({ id, startDay, endDay });

check("no periods: the default cycle, no prediction", cycleStatus([], "2026-11-01").nextStart === null && cycleStatus([], "2026-11-01").cycleLength === 28);

{
  const s = cycleStatus([p(1, "2026-10-20", "2026-10-24")], "2026-10-30");
  check("one period: day of cycle counts from its start", s.dayOfCycle === 11);
  check("one period: the prediction uses the default 28 days", s.nextStart === "2026-11-17" && s.daysToNext === 18);
  check("one period: no cycles known yet", s.cyclesKnown === 0);
  check("one period: phase after the period", s.phase === "follicular");
}

{
  const periods = [p(1, "2026-08-02", "2026-08-06"), p(2, "2026-08-31", "2026-09-04"), p(3, "2026-09-29", "2026-10-03"), p(4, "2026-10-27")];
  check("cycle lengths come from consecutive starts", JSON.stringify(cycleLengths(periods)) === "[29,29,28]");
  check("average cycle rounds", averageCycleLength(periods) === 29);
  check("average period length from ended periods", averagePeriodLength(periods) === 5);
  const s = cycleStatus(periods, "2026-10-29");
  check("an open recent period is on", s.onPeriod?.id === 4 && s.phase === "period");
  check("prediction is the average on from the last start", s.nextStart === "2026-11-25");
  check("the home line says the period day", statusLine(s) === "Period, day 3");
  const later = cycleStatus(periods, "2026-11-07");
  check("an open period is over after its usual length", later.onPeriod === null && later.phase === "follicular");
  check("the home line counts down", statusLine(later) === "Day 12 · next period in about 18 days");
}

check("a gap of months between logs is not a cycle", JSON.stringify(cycleLengths([p(1, "2026-01-01"), p(2, "2026-06-01"), p(3, "2026-06-29")])) === "[28]");

{
  const s = cycleStatus([p(1, "2026-09-01", "2026-09-05"), p(2, "2026-09-29", "2026-10-03")], "2026-10-30");
  check("a late period reads late", s.daysToNext === -3 && statusLine(s) === "Day 32 · period 3 days later than expected");
  const much = cycleStatus([p(1, "2026-09-01", "2026-09-05"), p(2, "2026-09-29", "2026-10-03")], "2026-11-20");
  check("after a week late the prediction rolls a cycle on", much.nextStart === "2026-11-24");
  check("the phase is capped at the end of the cycle, not past it", s.phase === "luteal" && much.phase === "luteal");
}

check("phase boundaries on a 28-day cycle", phaseFor(3, 28, 5) === "period" && phaseFor(8, 28, 5) === "follicular" && phaseFor(14, 28, 5) === "mid" && phaseFor(20, 28, 5) === "luteal");
check("periodOn sees an ended period's last day", periodOn([p(1, "2026-10-01", "2026-10-04")], "2026-10-04")?.id === 1 && periodOn([p(1, "2026-10-01", "2026-10-04")], "2026-10-05") === null);

{
  const periods = [p(1, "2026-10-02", "2026-10-06")];
  const s = cycleStatus(periods, "2026-10-20");
  const months = calendar(periods, [{ day: "2026-10-19" }], s, "2026-10-20", 1);
  check("calendar runs from last month to next month", months.length === 3 && months[0].key === "2026-09" && months[2].key === "2026-11");
  const oct = months[1];
  check("period days are marked", oct.days[1].period && oct.days[5].period && !oct.days[6].period);
  check("the predicted next period is marked in the days ahead", oct.days[29].predicted && oct.days[29].future);
  check("a logged day is marked", oct.days[18].logged && oct.days[19].today);
  check("October 2026 starts on a Thursday, three blanks before it", oct.offset === 3);
}

{
  const periods = [p(1, "2026-10-01", "2026-10-05")];
  const logs = [
    { day: "2026-10-02", energy: 1, mood: 1, sleep: null, pain: 3, cravings: null, note: null },
    { day: "2026-10-03", energy: 2, mood: null, sleep: null, pain: 2, cravings: null, note: null },
    { day: "2026-10-10", energy: 3, mood: 3, sleep: 3, pain: 1, cravings: 1, note: null },
  ];
  const a = averagesByPhase(periods, logs, "2026-10-20");
  check("averages by phase", a.period.days === 2 && a.period.energy === 1.5 && a.period.pain === 2.5 && a.period.sleep === undefined && a.follicular.energy === 3);
}

console.log(`\ncycleModel: ${passed} checks passed`);
