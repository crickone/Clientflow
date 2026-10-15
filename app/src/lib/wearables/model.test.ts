// Run: npm test -- src/lib/wearables/model.test.ts
//
// Each provider's documented response shape, read into one daily row.
import assert from "node:assert/strict";

import { average, cleanDay, combineDevices, mergeDays, parseFitbit, parseGarminPush, parseOura, parsePolar, parseWhoop, parseWithings, sleepLabel } from "./model";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

// Fitbit range endpoints.
const fb = parseFitbit({
  steps: { "activities-steps": [{ dateTime: "2026-10-14", value: "9412" }, { dateTime: "2026-10-15", value: "3021" }] },
  heart: { "activities-heart": [{ dateTime: "2026-10-14", value: { restingHeartRate: 58, heartRateZones: [] } }] },
  sleep: { sleep: [{ dateOfSleep: "2026-10-14", minutesAsleep: 431, efficiency: 92, isMainSleep: true }, { dateOfSleep: "2026-10-14", minutesAsleep: 30, efficiency: 80, isMainSleep: false }] },
  hrv: { hrv: [{ dateTime: "2026-10-14", value: { dailyRmssd: 41.2, deepRmssd: 48 } }] },
  weight: { weight: [{ date: "2026-10-14", weight: 82.4, fat: 18.1 }] },
});
check("fitbit: one row per day, values merged", fb.length === 2 && fb[0].steps === 9412 && fb[0].restingHr === 58 && fb[0].hrvMs === 41.2 && fb[0].weightKg === 82.4);
check("fitbit: the main sleep, not the nap", fb[0].sleepMinutes === 431 && fb[0].sleepScore === 92);

// Oura v2.
const oura = parseOura({
  activity: { data: [{ day: "2026-10-14", steps: 8800, active_calories: 420 }] },
  dailySleep: { data: [{ day: "2026-10-14", score: 81 }] },
  sleep: { data: [{ day: "2026-10-14", type: "long_sleep", total_sleep_duration: 25200, lowest_heart_rate: 52, average_hrv: 55 }, { day: "2026-10-14", type: "rest", total_sleep_duration: 1200 }] },
  readiness: { data: [{ day: "2026-10-14", score: 77 }] },
});
check("oura: all four collections into one day", oura.length === 1 && oura[0].steps === 8800 && oura[0].sleepScore === 81 && oura[0].sleepMinutes === 420 && oura[0].hrvMs === 55 && oura[0].readiness === 77);

// Whoop v2 (UTC instants -> Irish day).
const wh = parseWhoop({
  recovery: { records: [{ created_at: "2026-10-14T06:30:00Z", score: { recovery_score: 66, resting_heart_rate: 54, hrv_rmssd_milli: 62.5 } }] },
  sleep: { records: [{ end: "2026-10-14T06:20:00Z", nap: false, score: { sleep_performance_percentage: 88, stage_summary: { total_in_bed_time_milli: 28800000, total_awake_time_milli: 1800000 } } }, { end: "2026-10-14T14:00:00Z", nap: true, score: {} }] },
  cycle: { records: [{ start: "2026-10-14T06:30:00Z", score: { kilojoule: 8368 } }] },
});
check("whoop: recovery, sleep (minus awake time) and energy", wh[0].readiness === 66 && wh[0].hrvMs === 62.5 && wh[0].sleepMinutes === 450 && Math.round(wh[0].activeKcal!) === 2000);

// Withings.
const wi = parseWithings({
  activity: { status: 0, body: { activities: [{ date: "2026-10-14", steps: 7001, calories: 310 }] } },
  meas: { status: 0, body: { measuregrps: [{ date: 1791957600, measures: [{ value: 82350, type: 1, unit: -3 }, { value: 181, type: 6, unit: -1 }] }] } },
  sleep: { status: 0, body: { series: [{ date: "2026-10-14", data: { total_sleep_time: 24600, sleep_score: 79, hr_min: 51 } }] } },
});
const w14 = wi.find((d) => d.day === "2026-10-14")!;
check("withings: weight and fat from value x 10^unit", w14.weightKg === 82.35 && w14.bodyFatPct === 18.1 && w14.steps === 7001 && w14.sleepMinutes === 410);

// Polar AccessLink.
const po = parsePolar({
  sleep: { nights: [{ date: "2026-10-14", light_sleep: 12000, deep_sleep: 6000, rem_sleep: 6000, sleep_score: 84 }] },
  recharge: { recharges: [{ date: "2026-10-14", heart_rate_avg: 57, heart_rate_variability_avg: 44 }] },
  activities: [{ date: "2026-10-14", "active-steps": 10230, "active-calories": 512 }],
});
check("polar: sleep stages add up, recharge gives HRV", po[0].sleepMinutes === 400 && po[0].hrvMs === 44 && po[0].steps === 10230);

// Garmin push.
const gp = parseGarminPush({
  dailies: [{ userId: "g-1", calendarDate: "2026-10-14", steps: 11234, activeKilocalories: 600, restingHeartRateInBeatsPerMinute: 55 }],
  sleeps: [{ userId: "g-1", calendarDate: "2026-10-14", durationInSeconds: 27000, overallSleepScore: { value: 83 } }],
  hrv: [{ userId: "g-2", calendarDate: "2026-10-14", lastNightAvg: 48 }],
});
check("garmin: grouped by Garmin user", gp.length === 2 && gp.find((u) => u.userId === "g-1")!.days[0].sleepMinutes === 450 && gp.find((u) => u.userId === "g-2")!.days[0].hrvMs === 48);

// Shared helpers.
check("merge keeps earlier values when a later part lacks them", mergeDays([{ day: "d", steps: 5 }, { day: "d", hrvMs: 40 }])[0].steps === 5);
check("clean drops impossible readings", cleanDay({ day: "d", restingHr: 3, steps: 9000.4, weightKg: 82.36 }).restingHr === undefined && cleanDay({ day: "d", steps: 9000.4 }).steps === 9000 && cleanDay({ day: "d", weightKg: 82.36 }).weightKg === 82.4);
const both = combineDevices(
  [
    { provider: "fitbit", day: "d", steps: 9000 },
    { provider: "oura", day: "d", steps: 8000, readiness: 70 },
  ],
  ["oura", "fitbit"],
);
check("two devices: the preferred one wins, the other fills gaps", both[0].steps === 8000 && both[0].readiness === 70);
check("average skips missing days", average([{ day: "a", steps: 1000 }, { day: "b" }, { day: "c", steps: 3000 }], "steps") === 2000);
check("sleep reads as hours and minutes", sleepLabel(431) === "7h 11m" && sleepLabel(null) === "-");
check("junk payloads give nothing", parseOura({ activity: "nope" }).length === 0 && parseGarminPush(null).length === 0);

console.log(`wearables model: ${passed} checks passed`);
