// Run: npm test -- src/lib/ai/factCheck.test.ts
//
// The case this exists for is real and shipped: Optimal Health's "HBOT or
// infrared" carousel says infrared is "fifteen minutes" on slide 3 and
// "twelve minutes" on slide 4 -- the same session, the same post,
// contradicting itself. Infrared is 15 minutes in that account's services,
// and the prompt carried "Infrared Therapy (15 minutes, €65)" the whole time.
// The rule against inventing a session length was already there. It did not
// hold, so the number is checked instead.
import assert from "node:assert/strict";

import { statedDurations, statedPrices, unsupportedNumbers } from "./factCheck";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}
const same = (a: number[], b: number[]) =>
  a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);

// ---------------------------------------------------------------------------
// Reading durations
// ---------------------------------------------------------------------------
check("digits", same(statedDurations("A 15 minute session"), [15]));
check("digits, hyphenated", same(statedDurations("a 15-minute session"), [15]));
check("abbreviated", same(statedDurations("15 mins in the bed"), [15]));
// A copywriter writes the word, not the numeral. Missing this would make the
// whole check silent on the exact copy it was built for.
check("words", same(statedDurations("You lie there for fifteen minutes"), [15]));
check("words, hyphenated", same(statedDurations("a fifteen-minute session"), [15]));
check("sixty", same(statedDurations("Sixty minutes, fully enclosed"), [60]));
// "twenty-five" must not read as "twenty".
check("compound words beat their prefix", same(statedDurations("twenty-five minutes"), [25]));
check("an hour is sixty minutes, not a different claim", same(statedDurations("an hour in the chamber"), [60]));
check("several in one text", same(statedDurations("fifteen minutes here, 60 minutes there"), [15, 60]));
check("nothing stated is nothing found", same(statedDurations("A full-body infrared bed"), []));
// "minute" as an adjective is not a duration.
check("a bare number is not a duration", same(statedDurations("15 people came"), []));

// ---------------------------------------------------------------------------
// Reading prices
// ---------------------------------------------------------------------------
check("euro sign", same(statedPrices("€65 a session"), [65]));
check("cents", same(statedPrices("€64.50"), [64.5]));
check("EUR spelled", same(statedPrices("EUR 95"), [95]));
check("no price is none", same(statedPrices("Call us to book"), []));

// ---------------------------------------------------------------------------
// The check itself — Optimal Health's real numbers
// ---------------------------------------------------------------------------
const OPTIMAL = { durations: [60, 15, 30], prices: [95, 65, 60] };

check(
  "a correct duration passes",
  unsupportedNumbers("Fifteen minutes on the infrared bed.", OPTIMAL).length === 0,
);
// THE SHIPPED DEFECT.
{
  const v = unsupportedNumbers(
    "That's infrared — a full-body bed, radiant warmth, twelve minutes.",
    OPTIMAL,
  );
  check("the invented twelve minutes is caught", v.length === 1);
  check("and the message names the number", v[0].includes("12 minutes"));
  check("and lists the real ones, so the fix is obvious", v[0].includes("60, 15, 30"));
  check("and offers the always-available alternative", v[0].includes("without a length"));
}
check(
  "a wrong price is caught the same way",
  unsupportedNumbers("Sessions from €49.", OPTIMAL)[0]?.includes("€49") === true,
);
check("a real price passes", unsupportedNumbers("€65 a session.", OPTIMAL).length === 0);
check(
  "one message per wrong number, not one per mention",
  unsupportedNumbers("twelve minutes. Twelve minutes. 12 minutes.", OPTIMAL).length === 1,
);
check(
  "a slide with both wrong gets both",
  unsupportedNumbers("twelve minutes for €49", OPTIMAL).length === 2,
);

// An account that has configured nothing has no list to check against, and
// inventing violations would send every generation round the repair loop.
check(
  "nothing configured means nothing reported",
  unsupportedNumbers("twelve minutes for €49", { durations: [], prices: [] }).length === 0,
);
check(
  "durations configured but no prices checks only durations",
  unsupportedNumbers("twelve minutes for €49", { durations: [15], prices: [] }).length === 1,
);

console.log(`\nfactCheck: ${passed} checks passed`);
