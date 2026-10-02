// Run: npm test -- src/lib/dashboard/visibility.test.ts
//
// Staff visibility: financial/spend widgets default to hidden from staff,
// an admin override wins, admins always see everything, and visibleRefs
// drops unknown keys and other-venue widgets before anything loads. Pure.
import assert from "node:assert/strict";
import { CATALOG_BY_KEY } from "./catalog";
import { canSee, staffCanSeeByDefault, visibleRefs } from "./visibility";

const leads = CATALOG_BY_KEY.get("overview.newLeads")!;
const revenue = CATALOG_BY_KEY.get("overview.revenueTrend")!;

assert.equal(staffCanSeeByDefault(leads), true);
assert.equal(staffCanSeeByDefault(revenue), false);

assert.equal(canSee(revenue, "staff", {}), false);
assert.equal(canSee(revenue, "staff", { "overview.revenueTrend": true }), true);
assert.equal(canSee(leads, "staff", { "overview.newLeads": false }), false);
assert.equal(canSee(revenue, "admin", { "overview.revenueTrend": false }), true, "admins always see");

const refs = [
  { key: "overview.newLeads", size: "S" as const },
  { key: "overview.revenueTrend", size: "XL" as const },
  { key: "overview.activeMembers", size: "S" as const }, // gym-only
  { key: "removed.widget", size: "S" as const },
];
assert.deepEqual(
  visibleRefs(refs, { venue: "clinic", role: "staff", overrides: {} }).map((r) => r.key),
  ["overview.newLeads"],
);
assert.deepEqual(
  visibleRefs(refs, { venue: "clinic", role: "admin", overrides: {} }).map((r) => r.key),
  ["overview.newLeads", "overview.revenueTrend"],
);

console.log("visibility.test.ts: ok");
