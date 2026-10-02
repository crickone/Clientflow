// Run: npm test -- src/lib/dashboard/presets.test.ts
//
// Every preset must be a valid layout for each venue: known keys, allowed
// sizes, and no widget that does not apply to that venue. Pure.
import assert from "node:assert/strict";
import { CATALOG_BY_KEY, validateLayout } from "./catalog";
import { OVERVIEW_PRESET_KEY, PRESETS, presetWidgets } from "./presets";

const keys = new Set<string>();
for (const p of PRESETS) {
  assert.ok(!keys.has(p.key), `${p.key} unique`);
  keys.add(p.key);
  for (const venue of ["clinic", "gym"] as const) {
    const refs = p.widgets[venue];
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

const clinic = presetWidgets("overview", "clinic")!;
assert.deepEqual(
  clinic.map((r) => r.key),
  [
    "overview.todaysBookings",
    "overview.todaysEarnings",
    "overview.cashToday",
    "overview.deferredRevenue",
    "overview.activeClients",
    "overview.plansExpiring",
    "overview.newLeads",
    "overview.unreadMessages",
    "overview.needsAttention",
    "overview.todaysSchedule",
    "overview.recentActivity",
    "overview.revenueTrend",
    "overview.pipelineSnapshot",
    "overview.upcomingPosts",
  ],
);
// presetWidgets returns a copy: mutating it must not change the preset.
clinic[0].size = "M";
assert.equal(presetWidgets("overview", "clinic")![0].size, "S");

console.log("presets.test.ts: ok");
