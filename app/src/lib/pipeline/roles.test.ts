/**
 * Pure tests for the pipeline role model. No I/O, no DB.
 * Run: npm test -- src/lib/pipeline/roles.test.ts
 */
import assert from "node:assert/strict";

import {
  DEFAULT_STAGES,
  LEGACY_KEY_TO_ROLE,
  ROLE_TO_LEGACY_KEY,
  roleOf,
  shouldAdvance,
  ALL_ROLES,
  WON_ROLES,
  INACTIVE_ROLES,
  STALE_SUPPRESSED_ROLES,
  OUT_OF_BAND,
  type StageRole,
} from "./roles";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${expected}, got ${actual}`);
  passed++;
  console.log("  ✓", name);
}

// DEFAULT_STAGES: 9 canonical, ordered, each with a role, positions 0..8, unique roles.
check("9 default stages", DEFAULT_STAGES.length, 9);
check("positions are 0..8 in order", DEFAULT_STAGES.map((s) => s.position), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
check("default roles in funnel order", DEFAULT_STAGES.map((s) => s.role), [
  "new", "engaged", "booked", "no_show", "attended", "won", "repeat", "lapsed", "lost",
]);
check("every default stage has a name + hex colour", DEFAULT_STAGES.every((s) => s.name.length > 0 && /^#[0-9a-fA-F]{6}$/.test(s.colour)), true);
check("default roles are unique", new Set(DEFAULT_STAGES.map((s) => s.role)).size, 9);

// LEGACY_KEY_TO_ROLE covers all 9 old keys; roleOf resolves + is null for unknown.
check("legacy map covers all 9 keys", Object.keys(LEGACY_KEY_TO_ROLE).length, 9);
check("hot_lead → engaged", roleOf("hot_lead"), "engaged");
check("sale → won", roleOf("sale"), "won");
check("repeat_customer → repeat", roleOf("repeat_customer"), "repeat");
check("unknown key → null", roleOf("nonsense"), null);
check("ALL_ROLES has 9", ALL_ROLES.length, 9);

// shouldAdvance — funnel: forward-only by position among funnel stages.
const S = (position: number, role: StageRole | null) => ({ position, role });
check("new→engaged advances (pos up)", shouldAdvance(S(0, "new"), S(1, "engaged")), true);
check("engaged→new does NOT regress", shouldAdvance(S(1, "engaged"), S(0, "new")), false);
check("same stage no-op", shouldAdvance(S(2, "booked"), S(2, "booked")), false);
check("won→engaged does NOT regress (existing customer reply)", shouldAdvance(S(5, "won"), S(1, "engaged")), false);

// Out-of-band: lost frozen; lapsed pull-out to any funnel stage.
check("lost is frozen (lost→won blocked even forward)", shouldAdvance(S(8, "lost"), S(5, "won")), false);
check("lost→engaged blocked", shouldAdvance(S(8, "lost"), S(1, "engaged")), false);
check("lapsed→won pulls out (even though lapsed.position > won.position)", shouldAdvance(S(7, "lapsed"), S(5, "won")), true);
check("lapsed→repeat pulls out", shouldAdvance(S(7, "lapsed"), S(6, "repeat")), true);
check("lapsed→lapsed no-op", shouldAdvance(S(7, "lapsed"), S(7, "lapsed")), false);

// Candidate into an out-of-band role is never an 'advance' via this fn (lapse job / manual set it directly).
check("funnel→lapsed not via shouldAdvance", shouldAdvance(S(5, "won"), S(7, "lapsed")), false);
check("funnel→lost not via shouldAdvance", shouldAdvance(S(5, "won"), S(8, "lost")), false);

// A null-role (manual-only) stage never auto-advances in or out.
check("null-role current → no advance", shouldAdvance(S(3, null), S(4, "attended")), false);
check("advance INTO null-role blocked", shouldAdvance(S(1, "engaged"), S(3, null)), false);

// Hardening (Task 2 review): exact-value coverage for the maps + role sets everything downstream trusts.
check("ROLE_TO_LEGACY_KEY round-trips via roleOf for all 9 roles", ALL_ROLES.every((r) => roleOf(ROLE_TO_LEGACY_KEY[r]) === r), true);
check("LEGACY_KEY_TO_ROLE is exactly the 9 pairs", LEGACY_KEY_TO_ROLE, {
  new_lead: "new", hot_lead: "engaged", consultation_booked: "booked", no_show: "no_show",
  attended: "attended", sale: "won", repeat_customer: "repeat", lapsed: "lapsed", lost: "lost",
});
check("DEFAULT_STAGES full literal (names/colours/positions/roles)", DEFAULT_STAGES, [
  { name: "New lead", colour: "#8b949e", position: 0, role: "new" },
  { name: "Hot lead", colour: "#ef5a24", position: 1, role: "engaged" },
  { name: "Consultation booked", colour: "#3b82f6", position: 2, role: "booked" },
  { name: "No-show", colour: "#d29922", position: 3, role: "no_show" },
  { name: "Attended", colour: "#2ea043", position: 4, role: "attended" },
  { name: "Sale", colour: "#1f9d55", position: 5, role: "won" },
  { name: "Repeat customer", colour: "#8a3fd1", position: 6, role: "repeat" },
  { name: "Lapsed", colour: "#6e7681", position: 7, role: "lapsed" },
  { name: "Lost", colour: "#484f58", position: 8, role: "lost" },
]);
check("role sets have the expected membership", {
  won: [...WON_ROLES].sort(),
  inactive: [...INACTIVE_ROLES].sort(),
  stale: [...STALE_SUPPRESSED_ROLES].sort(),
  oob: [...OUT_OF_BAND].sort(),
}, {
  won: ["repeat", "won"],
  inactive: ["lost", "repeat", "won"],
  stale: ["lost", "repeat", "won"],
  oob: ["lapsed", "lost"],
});

console.log(`\n${passed} passed`);
