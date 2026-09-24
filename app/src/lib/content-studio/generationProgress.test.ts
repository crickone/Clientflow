// Run: npm test -- src/lib/content-studio/generationProgress.test.ts
//
// The rail must never claim more than the server said. A progress bar that
// runs ahead of the work is the reason people stop believing progress bars.
import assert from "node:assert/strict";

import { elapsedLabel, readGenerationStage } from "./generationProgress";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed++;
}

// ── the strings designPost and carouselGeneration actually write ───────────
{
  const w = readGenerationStage("Designing 5 slides");
  check("the writing stage carries the count", [w.phase, w.total, w.done], ["writing", 5, 0]);
  check("…and claims no slide is finished yet", w.slide, null);
}
{
  const d = readGenerationStage("Drawing slide 3 of 5");
  check("drawing names its slide", [d.phase, d.slide, d.total], ["drawing", 3, 5]);
  check("the rail fills BEHIND the work, not in front of it", d.done, 2);
}
{
  const p = readGenerationStage("Photographing slide 1 of 5");
  check("photographing is its own phase", [p.phase, p.slide, p.done], ["photographing", 1, 0]);
}
{
  const c = readGenerationStage("Correcting what didn't fit the brand's rules", 5);
  check("the repair pass keeps the count it was given", [c.phase, c.total], ["correcting", 5]);
  check("…and does not pretend slides are done", c.done, 0);
}
{
  const s = readGenerationStage("Saving the slides", 5);
  check("saving is the one stage where every slide exists", [s.phase, s.done, s.total], ["saving", 5, 5]);
}

// ── carrying the total ─────────────────────────────────────────────────────
{
  check("a stage that names a count wins over the remembered one", readGenerationStage("Drawing slide 2 of 7", 5).total, 7);
  check("a stage that names none falls back to it", readGenerationStage("Saving the slides", 7).total, 7);
  check("and with nothing to fall back to, the rail is simply absent", readGenerationStage("Saving the slides").total, null);
}

// ── strings this module has not met ────────────────────────────────────────
{
  const u = readGenerationStage("Thinking very hard", 5);
  check("an unrecognised stage shows verbatim", u.label, "Thinking very hard");
  check("…claims no progress", [u.phase, u.done], ["writing", 0]);
  check("…and keeps the rail it already had", u.total, 5);
}
{
  check("no stage at all still says something", readGenerationStage(null).label, "Writing the slides.");
  check("whitespace is not a stage", readGenerationStage("   ").label, "Writing the slides.");
  check("case does not matter", readGenerationStage("drawing slide 2 of 4").phase, "drawing");
}

// ── elapsed ────────────────────────────────────────────────────────────────
{
  check("too early to be worth saying", elapsedLabel(3), "");
  check("seconds, once a few have passed", elapsedLabel(12), "0:12");
  check("padded", elapsedLabel(65), "1:05");
  check("minutes, because this wait has them", elapsedLabel(194), "3:14");
  check("negative time is not a thing", elapsedLabel(-4), "");
}

console.log(`generationProgress: ${passed} checks passed.`);
