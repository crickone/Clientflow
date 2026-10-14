// Run: npm test -- src/lib/mealsModel.test.ts
//
// Meal logging in the client app: a photo of a plate or a food label becomes
// numbers the app can trust.
import assert from "node:assert/strict";

import { dayTotals, kcal, mealSlot, parseMealReading, scaleReading } from "./mealsModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const plate = parseMealReading(
  '```json\n{"kind":"meal","name":"Chicken, rice and broccoli","items":[{"name":"Grilled chicken breast","grams":150,"calories":248,"protein":46,"carbs":0,"fat":5},{"name":"White rice","grams":180,"calories":234,"protein":5,"carbs":51,"fat":1},{"name":"Broccoli","grams":80,"calories":28,"protein":2,"carbs":5,"fat":0}],"calories":510,"protein":53,"carbs":56,"fat":6,"serving":null,"confidence":"medium","notes":"Portions estimated from the plate size."}\n```',
)!;
check("a plate reads with its items", plate !== null && plate.kind === "meal" && plate.items.length === 3 && plate.calories === 510);
check("an item's portion in words comes through, and is optional", parseMealReading('{"name":"Toast","items":[{"name":"Toast","portion":"2 slices","grams":70,"calories":180}]}')!.items[0].portion === "2 slices" && plate.items[0].portion === null);
check("the code fence is stripped", plate.name === "Chicken, rice and broccoli");

const label = parseMealReading('{"kind":"label","name":"Fulfil protein bar","items":[],"calories":"220","protein":20,"carbs":22,"fat":9,"serving":"1 bar (55 g)","confidence":"high","notes":"Read from the nutrition table."}')!;
check("a label reads per serving, numbers as strings included", label.kind === "label" && label.calories === 220 && label.serving === "1 bar (55 g)");
check("two bars doubles it", scaleReading(label, 2).calories === 440 && scaleReading(label, 2).protein === 40);
check("a silly serving count is capped", scaleReading(label, 999).calories === 4400);

const noTotals = parseMealReading('{"kind":"meal","name":"Porridge","items":[{"name":"Oats","grams":50,"calories":190,"protein":6,"carbs":32,"fat":4},{"name":"Milk","grams":200,"calories":100,"protein":7,"carbs":10,"fat":4}]}')!;
check("missing totals are summed from the items", noTotals.calories === 290 && noTotals.protein === 13);
check("confidence defaults to medium", noTotals.confidence === "medium");

check("not food is null", parseMealReading('{"food":false,"notes":"A photo of a car park."}') === null);
check("junk is null", parseMealReading("Sorry, I can't tell.") === null);
check("negative and absurd numbers are clamped", parseMealReading('{"name":"x","calories":-5,"protein":99999}')!.calories === 0);
check("prose around the JSON still parses", parseMealReading('Here you go: {"name":"Apple","calories":80} hope that helps')!.calories === 80);

const t = dayTotals([plate, scaleReading(label, 1)]);
check("the day adds up", t.calories === 730 && t.protein === 73);
check("calories read with a separator", kcal(1240) === "1,240 kcal");
check("meal slots follow Irish time", mealSlot(Date.parse("2026-10-14T07:30:00Z")) === "Breakfast" && mealSlot(Date.parse("2026-10-14T18:30:00Z")) === "Dinner" && mealSlot(Date.parse("2026-10-14T21:30:00Z")) === "Snack");

console.log(`mealsModel: ${passed} checks passed`);
