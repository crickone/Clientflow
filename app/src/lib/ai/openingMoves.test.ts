// Run: npm test -- src/lib/ai/openingMoves.test.ts
//
// The rotation that stops every post opening the same way. Pure, no I/O.
//
// What matters here, and why:
//   - consecutive posts CANNOT repeat an opening (the whole point — a plain
//     random choice from eight repeats often enough to be noticed);
//   - a tenant with no photography is never handed a photo-based direction,
//     which would put the prompt in direct conflict with NO_PHOTOGRAPHY_RULE;
//   - the directives stay noun phrases, because two call sites frame them
//     differently and a sentence would read wrong in one of them.
import assert from "node:assert/strict";

import { OPENING_MOVES, OPENING_MOVE_KEYS, pickOpeningMove } from "./openingMoves";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

check("there are enough moves to be worth rotating", OPENING_MOVES.length >= 6);
check("every key is unique", new Set(OPENING_MOVE_KEYS).size === OPENING_MOVES.length);
check("every directive is unique", new Set(OPENING_MOVES.map((m) => m.directive)).size === OPENING_MOVES.length);
check(
  "directives are noun phrases, not sentences",
  OPENING_MOVES.every((m) => !/^[A-Z]/.test(m.directive) && !m.directive.endsWith(".")),
);
check("some moves need a photograph and some do not", OPENING_MOVES.some((m) => m.needsPhoto) && OPENING_MOVES.some((m) => !m.needsPhoto));

// ── the exclusion is the feature ──
for (const move of OPENING_MOVES) {
  const next = pickOpeningMove(move.key, true, () => 0);
  assert.notEqual(next.key, move.key, `picking after ${move.key} repeated it`);
}
check("no move can follow itself, from any starting point", true);

// Sweeping the random value must never fall back onto the excluded move, and
// must stay in range at the top of the interval (Math.random can return values
// arbitrarily close to 1).
const after = OPENING_MOVES[0].key;
for (let r = 0; r < 1; r += 0.017) {
  const picked = pickOpeningMove(after, true, () => r);
  assert.ok(picked, `no move at r=${r}`);
  assert.notEqual(picked.key, after, `r=${r} landed on the excluded move`);
}
check("across the whole random range the excluded move never comes back", true);
check(
  "a random value at the very top of the range still returns a move",
  !!pickOpeningMove(null, true, () => 0.999999),
);

// ── photography ──
const noPhoto = OPENING_MOVES.filter((m) => m.needsPhoto).map((m) => m.key);
for (let r = 0; r < 1; r += 0.013) {
  const picked = pickOpeningMove(null, false, () => r);
  assert.ok(
    !noPhoto.includes(picked.key),
    `a tenant with no photography was offered ${picked.key}`,
  );
}
check("a tenant with no photography is never given a photo-based direction", true);
check(
  "a tenant WITH photography can still get one",
  Array.from({ length: 40 }, (_, i) => pickOpeningMove(null, true, () => i / 40).key).some((k) =>
    noPhoto.includes(k),
  ),
);

// ── the pool covers everything over time ──
const seen = new Set(
  Array.from({ length: 200 }, (_, i) => pickOpeningMove(null, true, () => i / 200).key),
);
check("every move is reachable", seen.size === OPENING_MOVES.length);

console.log(`\nopeningMoves: ${passed} checks passed`);
