// Run: npm test -- src/lib/mealsModel.test.ts
//
// Meal logging in the client app: a photo of a plate or a food label becomes
// numbers the app can trust.
import assert from "node:assert/strict";

import { applyItemDelta, cleanItemEdit, dayTotals, itemsTotal, kcal, mealSlot, parseMealItem, parseMealReading, per100, scaleItem, scaleReading, unaccounted } from "./mealsModel";

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

// ── items the client adds or fixes ──
const seeds = parseMealItem('{"name":"Pumpkin seeds","portion":"1 tablespoon","grams":10,"calories":57,"protein":3,"carbs":1,"fat":5}')!;
check("an added item parses", seeds !== null && seeds.grams === 10 && seeds.calories === 57);
check("not food is null", parseMealItem('{"food":false}') === null);
const more = scaleItem(seeds, 20);
check("doubling the grams doubles the numbers", more.calories === 114 && more.fat === 10 && more.portion === null);
check("an item with no grams can't be scaled by grams", scaleItem({ ...seeds, grams: null }, 20).calories === 57);
const base = { calories: 290, protein: 13, carbs: 42, fat: 8 };
check("adding an item moves the meal by exactly that item", applyItemDelta(base, seeds, 1).calories === 347 && applyItemDelta(base, seeds, 1).fat === 13);
check("removing it moves it back, never below zero", applyItemDelta(applyItemDelta(base, seeds, 1), seeds, -1).calories === 290 && applyItemDelta({ calories: 10, protein: 0, carbs: 0, fat: 0 }, seeds, -1).calories === 0);

// ── the breakdown ──
const chicken = plate.items[0];
check("per 100 g comes from the weight", per100(chicken)!.calories === 165 && per100({ ...chicken, grams: null }) === null);
check("the items add up", itemsTotal(plate.items).calories === 510);
check("a meal the items explain has nothing unaccounted", unaccounted(plate, plate.items) === null);
const oily = { calories: 600, protein: 53, carbs: 56, fat: 16 };
check("oil the photo couldn't split out shows as the difference", unaccounted(oily, plate.items)!.calories === 90 && unaccounted(oily, plate.items)!.fat === 10);
check("no items, nothing to compare", unaccounted(oily, []) === null);
const edited = cleanItemEdit(chicken, { name: "  Chicken thigh ", grams: 150, calories: 290, protein: 38, carbs: 0, fat: 15 })!;
check("an edit keeps the member's numbers, trimmed", edited.name === "Chicken thigh" && edited.calories === 290 && edited.fat === 15);
check("same weight keeps the portion words; a new weight drops them", cleanItemEdit({ ...chicken, portion: "1 breast" }, { ...chicken, grams: 150 })!.portion === "1 breast" && cleanItemEdit({ ...chicken, portion: "1 breast" }, { ...chicken, grams: 200 })!.portion === null);
check("a blank name or a nonsense number can't be saved", cleanItemEdit(chicken, { ...chicken, name: " " }) === null && cleanItemEdit(chicken, { ...chicken, calories: NaN }) === null && cleanItemEdit(chicken, { ...chicken, grams: 0 }) === null);
check("silly numbers are capped", cleanItemEdit(chicken, { ...chicken, calories: 99999 })!.calories === 5000);

console.log(`mealsModel: ${passed} checks passed`);
