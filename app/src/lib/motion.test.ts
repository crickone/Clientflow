/**
 * Unit tests for the motion tokens — the single source of truth for durations,
 * easing, and reveal/stagger variants. Pure, no I/O. Run: npx tsx src/lib/motion.test.ts
 */
import assert from "node:assert/strict";

import { DUR, EASE, STAGGER_CAP, revealVariants, staggerContainer } from "./motion";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed++;
}

// The Variants union type doesn't expose `.opacity`/`.transition` directly, so
// cast to a plain record shape for these value assertions.
const hidden = revealVariants.hidden as { opacity: number; y: number };
const visible = revealVariants.visible as { opacity: number; y: number };
const container = staggerContainer().visible as { transition: { staggerChildren: number } };

check("durations are the premium values", DUR.fast === 0.12 && DUR.base === 0.18 && DUR.slow === 0.28);
check("ease is the ease-out curve", EASE[0] === 0.2 && EASE[1] === 0.8 && EASE[2] === 0.2 && EASE[3] === 1);
check("reveal hidden state offsets down + transparent", hidden.opacity === 0 && hidden.y === 8);
check("reveal visible state settles", visible.opacity === 1 && visible.y === 0);
check("stagger container default staggers by 0.04", container.transition.staggerChildren === 0.04);
check("stagger cap is 10", STAGGER_CAP === 10);

console.log(`motion tokens: ${passed} checks passed.`);
