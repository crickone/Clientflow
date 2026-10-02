// Run: npm test -- src/lib/dashboard/catalog.test.ts
//
// The widget catalog is the contract every preset, saved layout and the
// visibility screen is checked against. Pure: no DB, no server imports.
import assert from "node:assert/strict";
import { CATALOG, CATALOG_BY_KEY, MAX_WIDGETS_PER_TAB, validateLayout } from "./catalog";
import { SIZE_SPAN } from "./types";

const seen = new Set<string>();
for (const m of CATALOG) {
  assert.ok(!seen.has(m.key), `${m.key} is unique`);
  seen.add(m.key);
  assert.match(m.key, /^[a-z]+\.[a-zA-Z]+$/, `${m.key} is domain.camelName`);
  assert.ok(m.key.startsWith(`${m.domain}.`), `${m.key} is prefixed by its domain`);
  assert.ok(m.title.length > 0 && m.description.length > 0, `${m.key} has copy`);
  assert.ok(m.sizes.length > 0, `${m.key} allows a size`);
  assert.ok((m.sizes as readonly string[]).includes(m.defaultSize), `${m.key} default size is allowed`);
  for (const s of m.sizes) assert.ok(s in SIZE_SPAN, `${m.key} size ${s} is known`);
  assert.ok(m.venues.length > 0, `${m.key} applies to a venue`);
  if (m.rangeMode === "pinned") assert.ok(m.pinnedRange, `${m.key} pinned needs pinnedRange`);
}
assert.equal(CATALOG_BY_KEY.size, CATALOG.length);

// validateLayout: accepts a good layout, drops nothing silently, rejects bad input.
const good = validateLayout([
  { key: "overview.newLeads", size: "S" },
  { key: "overview.revenueTrend", size: "XL", range: "90d" },
]);
assert.equal(good.length, 2);
assert.equal(good[1].range, "90d");

assert.throws(() => validateLayout("x"), /list/);
assert.throws(() => validateLayout([{ key: "nope.widget", size: "S" }]), /Unknown widget/);
assert.throws(() => validateLayout([{ key: "overview.newLeads", size: "XL" }]), /size/);
assert.throws(() => validateLayout([{ key: "overview.newLeads", size: "S", range: "custom" }]), /range/);
assert.throws(
  () => validateLayout(Array.from({ length: MAX_WIDGETS_PER_TAB + 1 }, () => ({ key: "overview.newLeads", size: "S" }))),
  /at most/,
);

console.log("catalog.test.ts: ok");
