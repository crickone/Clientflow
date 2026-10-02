// Run: npm test -- src/lib/dashboard/visibility.test.ts
//
// Staff visibility: financial/spend widgets default to hidden from staff,
// an admin override wins, admins always see everything, and visibleRefs
// drops unknown keys and other-venue widgets before anything loads. Pure.
import assert from "node:assert/strict";
import { CATALOG_BY_KEY } from "./catalog";
import { canSee, isRefVisible, mergeHiddenRefs, staffCanSeeByDefault, visibleRefs } from "./visibility";

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

// -- mergeHiddenRefs --
const R = (key: string, size: "S" | "M" | "L" | "XL" = "S") => ({ key, size });
const keys = (l: { key: string }[]) => l.map((r) => r.key);
const staff = { venue: "clinic" as const, role: "staff" as const, overrides: {} };
const vis = (r: { key: string; size: "S" | "M" | "L" | "XL" }) => isRefVisible(r, staff);
const A = "overview.newLeads";
const B = "overview.todaysBookings";
const H = "overview.revenueTrend";
assert.equal(vis(R(A)), true);
assert.equal(vis(R(H)), false);
assert.equal(vis(R(B)), true);

// hidden between two visible ones follows its predecessor after a reorder
assert.deepEqual(keys(mergeHiddenRefs([R(A), R(H), R(B)], [R(B), R(A)], vis)), [B, A, H]);
// predecessor removed -> hidden goes to the end
assert.deepEqual(keys(mergeHiddenRefs([R(A), R(H), R(B)], [R(B)], vis)), [B, H]);
// leading hidden stays first
assert.deepEqual(keys(mergeHiddenRefs([R(H), R(A), R(B)], [R(B), R(A)], vis)), [H, B, A]);
// unknown key dropped
assert.deepEqual(keys(mergeHiddenRefs([R(A), R("removed.widget")], [R(A)], vis)), [A]);
// admin: exactly the submitted list
const adminVis = (r: { key: string; size: "S" | "M" | "L" | "XL" }) =>
  isRefVisible(r, { venue: "clinic", role: "admin", overrides: {} });
assert.deepEqual(keys(mergeHiddenRefs([R(A), R(H), R(B)], [R(B)], adminVis)), [B]);

console.log("visibility.test.ts: ok");
