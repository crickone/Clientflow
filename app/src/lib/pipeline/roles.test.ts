/**
 * Pure tests for the pipeline role model. No I/O, no DB.
 * Run: npm test -- src/lib/pipeline/roles.test.ts
 */
import assert from "node:assert/strict";

import {
  DEFAULT_STAGES,
  LEGACY_KEY_TO_ROLE,
  roleOf,
  shouldAdvance,
  ALL_ROLES,
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

console.log(`\n${passed} passed`);
