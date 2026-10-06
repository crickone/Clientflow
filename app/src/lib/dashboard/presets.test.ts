// Run: npm test -- src/lib/dashboard/presets.test.ts
//
// Every preset must be a valid layout for each venue: known keys, allowed
// sizes, and no widget that does not apply to that venue. Pure.
import assert from "node:assert/strict";
import { CATALOG_BY_KEY, validateLayout } from "./catalog";
import { ALL_VENUES, OVERVIEW_PRESET_KEY, PRESETS, presetAppliesTo, presetWidgets } from "./presets";

const keys = new Set<string>();
for (const p of PRESETS) {
  assert.ok(!keys.has(p.key), `${p.key} unique`);
  keys.add(p.key);
  for (const venue of ["clinic", "gym"] as const) {
    const refs = p.widgets[venue];
    if (!presetAppliesTo(p, venue)) {
      assert.equal(refs.length, 0, `${p.key}/${venue}: preset does not apply, list must be empty`);
      assert.equal(presetWidgets(p.key, venue), null, `${p.key}/${venue}: no layout for a venue it does not apply to`);
      continue;
    }
    assert.ok(refs.length > 0, `${p.key}/${venue} has widgets`);
    assert.doesNotThrow(() => validateLayout(refs), `${p.key}/${venue} validates`);
    for (const r of refs) {
      const meta = CATALOG_BY_KEY.get(r.key)!;
      assert.ok(meta.venues.includes(venue), `${p.key}/${venue}: ${r.key} applies to ${venue}`);
    }
  }
}
assert.ok(keys.has(OVERVIEW_PRESET_KEY), "overview preset exists");
assert.equal(presetWidgets("nope", "clinic"), null);
assert.ok(keys.has("sales"), "sales preset exists");
for (const venue of ["clinic", "gym"] as const) {
  assert.equal(presetWidgets("sales", venue)!.length, 15, `sales/${venue} has 15 widgets`);
}
assert.ok(keys.has("marketing"), "marketing preset exists");
for (const venue of ["clinic", "gym"] as const) {
  assert.equal(presetWidgets("marketing", venue)!.length, 12, `marketing/${venue} has 12 widgets`);
}
assert.ok(keys.has("email"), "email preset exists");
for (const venue of ["clinic", "gym"] as const) {
  assert.equal(presetWidgets("email", venue)!.length, 14, `email/${venue} has 14 widgets`);
}
assert.ok(keys.has("communication"), "communication preset exists");
for (const venue of ["clinic", "gym"] as const) {
  assert.equal(presetWidgets("communication", venue)!.length, 13, `communication/${venue} has 13 widgets`);
}

assert.deepEqual(PRESETS.find((p) => p.key === "frontdesk")!.venues, ["clinic"]);
assert.equal(presetWidgets("frontdesk", "clinic")!.length, 12, "frontdesk/clinic has 12 widgets");
assert.deepEqual(PRESETS.find((p) => p.key === "classes")!.venues, ["gym"]);
assert.equal(presetWidgets("classes", "gym")!.length, 11, "classes/gym has 11 widgets");
assert.ok(keys.has("finance"), "finance preset exists");
assert.equal(PRESETS.find((p) => p.key === "finance")!.venues, undefined, "finance applies to both venues");
assert.equal(presetWidgets("finance", "clinic")!.length, 10, "finance/clinic has 10 widgets");
assert.equal(presetWidgets("finance", "gym")!.length, 6, "finance/gym has 6 widgets");
assert.ok(keys.has("content"), "content preset exists");
assert.ok(keys.has("website"), "website preset exists");
for (const venue of ["clinic", "gym"] as const) {
  assert.equal(presetWidgets("content", venue)!.length, 10, `content/${venue} has 10 widgets`);
  assert.equal(presetWidgets("website", venue)!.length, 11, `website/${venue} has 11 widgets`);
}
assert.ok(keys.has("competitors"), "competitors preset exists");
assert.ok(keys.has("ai"), "ai preset exists");
for (const venue of ["clinic", "gym"] as const) {
  assert.equal(presetWidgets("competitors", venue)!.length, 9, `competitors/${venue} has 9 widgets`);
  assert.equal(presetWidgets("ai", venue)!.length, 8, `ai/${venue} has 8 widgets`);
}
for (const p of PRESETS) assert.ok(ALL_VENUES.some((v) => presetAppliesTo(p, v)), `${p.key} applies somewhere`);

const clinic = presetWidgets("overview", "clinic")!;
assert.deepEqual(
  clinic.map((r) => r.key),
  [
    "overview.todaysSchedule",
    "overview.money",
    "overview.needsYou",
    "overview.people",
    "overview.revenueTrend",
    "overview.pipelineSnapshot",
    "overview.upcomingPosts",
  ],
);
// presetWidgets returns a copy: mutating it must not change the preset.
clinic[0].size = "M";
assert.equal(presetWidgets("overview", "clinic")![0].size, "L");

console.log("presets.test.ts: ok");
