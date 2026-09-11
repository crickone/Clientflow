// Run: npm test -- src/lib/image/generationState.test.ts
//
// The one judgement in the detached-generation feature: deciding that a run
// which still says it is writing is in fact dead. Pure, so it is tested here
// rather than against a tenant database.
import assert from "node:assert/strict";

import {
  GENERATION_LOST_MESSAGE,
  GENERATION_STALE_MS,
  honestGenerationState,
} from "./generationState";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const NOW = 1_700_000_000_000;
const at = (msAgo: number) => new Date(NOW - msAgo);

// A run that started a moment ago is exactly what it says it is.
{
  const live = honestGenerationState(
    { generationStatus: "writing", generationError: null, generationStartedAt: at(30_000) },
    NOW,
  );
  check("a fresh run is still writing", live.generationStatus === "writing");
  check("and carries no error", live.generationError === null);
}

// One second inside the window is still alive -- the boundary matters, because
// calling a live run dead is the worse mistake and this is the last moment the
// code can make it.
{
  const edge = honestGenerationState(
    {
      generationStatus: "writing",
      generationError: null,
      generationStartedAt: at(GENERATION_STALE_MS),
    },
    NOW,
  );
  check("a run at exactly the limit is still alive", edge.generationStatus === "writing");

  const over = honestGenerationState(
    {
      generationStatus: "writing",
      generationError: null,
      generationStartedAt: at(GENERATION_STALE_MS + 1),
    },
    NOW,
  );
  check("a millisecond past it is dead", over.generationStatus === "failed");
  check("and says why, in terms an operator can act on", over.generationError === GENERATION_LOST_MESSAGE);
}

// A 'writing' with no start time predates the column. Nothing this process
// started is missing one, so it belongs to a process that is gone.
{
  const orphan = honestGenerationState(
    { generationStatus: "writing", generationError: null, generationStartedAt: null },
    NOW,
  );
  check("a writing row with no start time is dead", orphan.generationStatus === "failed");
}

// Everything else passes through untouched -- this function corrects one thing
// and must not invent state for a design that is simply idle.
{
  const idle = honestGenerationState(
    { generationStatus: null, generationError: null, generationStartedAt: null },
    NOW,
  );
  check("an idle design stays idle", idle.generationStatus === null);

  const failed = honestGenerationState(
    { generationStatus: "failed", generationError: "Ran out of room.", generationStartedAt: at(999) },
    NOW,
  );
  check("a real failure keeps its own message", failed.generationError === "Ran out of room.");
}

console.log(`\ngenerationState: ${passed} checks passed`);
