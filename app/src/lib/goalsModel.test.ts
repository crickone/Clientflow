// Run: npm test -- src/lib/goalsModel.test.ts
//
// A goal picked from an InBody scan becomes a daily calorie and macro target.
import assert from "node:assert/strict";

import { bmrFrom, bodyFromManual, describeDelta, isActivityKey, isGoalKey, leanMass, parseManualBody, recommend, recommendAll } from "./goalsModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

// A typical scan: 82 kg, 18% fat, lean 67.2, the scanner prints BMR 1822.
const scan = { weight: 82, pbf: 18, ffm: 67.2, smm: 38.1, bmr: 1822 };

check("the scanner's BMR wins when it printed one", bmrFrom(scan)!.bmr === 1822 && bmrFrom(scan)!.source === "scan");
check("without it, BMR comes from lean mass", bmrFrom({ weight: 82, ffm: 67.2 })!.bmr === 1822 && bmrFrom({ weight: 82, ffm: 67.2 })!.source === "lean");
check("lean mass falls back to weight and fat %", Math.round(leanMass({ weight: 82, pbf: 18 })!) === 67);
check("a scan with only weight can't give a BMR", bmrFrom({ weight: 82 }) === null);
check("a nonsense BMR is ignored", bmrFrom({ bmr: 12, ffm: 60 })!.source === "lean");

const maintain = recommend(scan, "maintain", "moderate")!;
check("maintenance is BMR x activity", maintain.maintenance === Math.round(1822 * 1.55) && maintain.calories === maintain.maintenance && maintain.delta === 0);
check("maintain protein is 1.6 g/kg", maintain.protein === Math.round(82 * 1.6));
check("maintain fat is 30% of calories", maintain.fat === Math.round((maintain.calories * 0.3) / 9));
check("carbs take the rest", maintain.carbs === Math.round((maintain.calories - maintain.protein * 4 - maintain.fat * 9) / 4));

const lose = recommend(scan, "lose", "moderate")!;
check("losing takes off 20%, capped at 500", lose.delta === -500 && lose.calories === maintain.maintenance - 500);
check("losing protein is 2 g/kg", lose.protein === 164);
const loseLight = recommend({ weight: 60, ffm: 45, bmr: 1300 }, "lose", "light")!;
check("a small person's deficit is 20%, not 500", loseLight.delta === -Math.round(1300 * 1.4 * 0.2));
check("the deficit never goes below BMR", recommend({ weight: 50, ffm: 40, bmr: 1200 }, "lose", "light")!.calories >= 1200);

const build = recommend(scan, "build", "active")!;
check("building adds 10%, within 200-350", build.delta === Math.min(350, Math.max(200, Math.round(build.maintenance * 0.1))) && build.delta > 0);
check("building protein is 1.8 g/kg", build.protein === Math.round(82 * 1.8));

const all = recommendAll(scan, "moderate")!;
check("all three options line up", all.lose.calories < all.maintain.calories && all.maintain.calories < all.build.calories);
check("no BMR means no options", recommendAll({ weight: 70 }, "moderate") === null);
check("macros add up to about the calories", Math.abs(all.build.protein * 4 + all.build.carbs * 4 + all.build.fat * 9 - all.build.calories) <= 4);

check("keys are validated", isGoalKey("lose") && !isGoalKey("bulk") && isActivityKey("active") && !isActivityKey("none"));
check("deltas read plainly", describeDelta(-500) === "-500 kcal a day" && describeDelta(250) === "+250 kcal a day" && describeDelta(0) === "your maintenance");

// ── typed in, no scan ──
const typed = parseManualBody({ weightKg: "82", heightCm: "180", age: "31", sex: "male", pbf: "" });
check("typed numbers parse", typed.ok && typed.body.weightKg === 82 && typed.body.pbf === null);
const m = bmrFrom(bodyFromManual((typed as { ok: true; body: import("./goalsModel").ManualBody }).body))!;
check("without body fat, BMR is Mifflin-St Jeor", m.source === "mifflin" && m.bmr === Math.round(10 * 82 + 6.25 * 180 - 5 * 31 + 5));
check("a woman's figure differs by the formula's constant", bmrFrom({ weight: 60, heightCm: 165, age: 28, sex: "female" })!.bmr === Math.round(600 + 1031.25 - 140 - 161));
check("with body fat, lean mass wins over the formula", bmrFrom({ weight: 82, heightCm: 180, age: 31, sex: "male", pbf: 18 })!.source === "lean");
check("typed numbers give all three options", recommendAll({ weight: 82, heightCm: 180, age: 31, sex: "male" }, "moderate") !== null);
check("a silly weight is refused", !parseManualBody({ weightKg: "20", heightCm: "180", age: "31", sex: "male" }).ok);
check("sex is required", !parseManualBody({ weightKg: "82", heightCm: "180", age: "31", sex: "" }).ok);
check("body fat out of range is refused", !parseManualBody({ weightKg: "82", heightCm: "180", age: "31", sex: "male", pbf: "90" }).ok);

console.log(`goalsModel: ${passed} checks passed`);
