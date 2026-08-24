// Run: npm test -- src/lib/research/adPageMatch.test.ts
//
// TDD for the crux of this fix: adPageMatchesCompetitor decides whether an
// Ad Library result's advertiser page is plausibly the tracked competitor,
// or an unrelated business whose ad COPY just happened to contain a word
// from the competitor's name (the reported live bug — Fitbit/Garmin/
// Taekwon-Do ads showing up for a gym named "...Inspire..."). Pure, no I/O,
// no DB, no network — mirrors changeDetect.test.ts/adDiff.test.ts's
// check()+async-IIFE harness.
import assert from "node:assert/strict";

import { adPageMatchesCompetitor } from "./adPageMatch";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

(async () => {
  // ════════════════════════════════════════════════════════════════════
  // THE load-bearing case: the actual reported bug. A gym tracked as
  // "Inspire Health and Fitness" must NOT match Fitbit's page just because
  // Fitbit sells a tracker called "Inspire 3" (ad-copy text search, not
  // advertiser identity, is exactly what caused this). "inspire" is the
  // competitor's only distinctive token (health/and/fitness are all
  // stopwords) and it never appears on "Fitbit" -- score 0/1.
  // ════════════════════════════════════════════════════════════════════
  check(
    "THE BUG: Fitbit's page does not match competitor 'Inspire Health and Fitness'",
    adPageMatchesCompetitor("Fitbit", "Inspire Health and Fitness") === false,
  );
  // The other two unrelated products/classes from the live report, same shape.
  check(
    "Garmin's page does not match competitor 'Inspire Health and Fitness'",
    adPageMatchesCompetitor("Garmin", "Inspire Health and Fitness") === false,
  );
  check(
    "A Taekwon-Do class page does not match competitor 'Inspire Health and Fitness'",
    adPageMatchesCompetitor("Clonmel Taekwon-Do Academy", "Inspire Health and Fitness") === false,
  );

  // ════════════════════════════════════════════════════════════════════
  // A real match: the advertiser page IS the competitor.
  // ════════════════════════════════════════════════════════════════════
  check(
    "exact page name match -> true",
    adPageMatchesCompetitor("Inspire Health and Fitness", "Inspire Health and Fitness") === true,
  );

  // ════════════════════════════════════════════════════════════════════
  // Case / whitespace / punctuation noise must not break a real match --
  // Meta's page names and the watchlist's competitor name are both
  // freeform strings, never guaranteed to agree on formatting.
  // ════════════════════════════════════════════════════════════════════
  check(
    "case/punctuation differ ('Inspire Health & Fitness' page) -> still true",
    adPageMatchesCompetitor("Inspire Health & Fitness", "inspire   health and fitness") === true,
  );
  check(
    "case/whitespace differ the other way round too -> still true",
    adPageMatchesCompetitor("inspire   health   fitness", "Inspire Health & Fitness") === true,
  );
  check(
    "a branding suffix on the page name ('| Official Page') doesn't break the match",
    adPageMatchesCompetitor("Inspire Health and Fitness | Official Page", "Inspire Health and Fitness") === true,
  );

  // ════════════════════════════════════════════════════════════════════
  // Same-brand, different-town franchise locations: a KNOWN, ACCEPTED
  // trade-off of the 0.5-of-distinctive-tokens heuristic (see the module
  // doc). "f45"+"clonmel" are the competitor's 2 distinctive tokens ("f45
  // training" strips "training" as a stopword); the Cahir page only carries
  // "f45" -> exactly 1/2 = 0.5, which clears the inclusive >= 0.5 bar. This
  // test PINS that documented behaviour rather than silently allowing it to
  // drift -- a later, separate task's exact page-id matching is the real
  // fix for multi-location franchises, not this heuristic.
  // ════════════════════════════════════════════════════════════════════
  check(
    "same-brand different-town page ('F45 Training Cahir') vs competitor 'F45 Training Clonmel' -> true (documented heuristic trade-off, score exactly 0.5)",
    adPageMatchesCompetitor("F45 Training Cahir", "F45 Training Clonmel") === true,
  );

  // ════════════════════════════════════════════════════════════════════
  // All-generic competitor name (every token is a stopword) -> falls back
  // to a loose substring check instead of ALWAYS matching (which an empty
  // compDistinct would otherwise trivially do) or ALWAYS failing.
  // ════════════════════════════════════════════════════════════════════
  check(
    "all-generic competitor 'The Fitness Studio' vs page 'The Fitness Studio Clonmel' -> true (substring fallback)",
    adPageMatchesCompetitor("The Fitness Studio Clonmel", "The Fitness Studio") === true,
  );
  check(
    "all-generic competitor 'The Fitness Studio' vs unrelated page 'Fitbit' -> false",
    adPageMatchesCompetitor("Fitbit", "The Fitness Studio") === false,
  );

  // ════════════════════════════════════════════════════════════════════
  // Empty/blank pageName is never a match, regardless of the competitor
  // name (including the all-generic fallback branch above).
  // ════════════════════════════════════════════════════════════════════
  check("empty pageName -> false", adPageMatchesCompetitor("", "Inspire Health and Fitness") === false);
  check("whitespace-only pageName -> false", adPageMatchesCompetitor("   ", "Inspire Health and Fitness") === false);
  check(
    "empty pageName -> false even against an all-generic competitor name",
    adPageMatchesCompetitor("", "The Fitness Studio") === false,
  );

  // ════════════════════════════════════════════════════════════════════
  // Generic-only overlap must NOT drive a match -- two DIFFERENT
  // businesses that both happen to be "fitness" businesses aren't the same
  // business. Only "fitness" overlaps here (a stopword); "inspire" (the
  // competitor's one distinctive token) never appears on the page.
  // ════════════════════════════════════════════════════════════════════
  check(
    "generic-only overlap ('fitness') does not make 'CrossFit Fitness' match competitor 'Inspire Fitness'",
    adPageMatchesCompetitor("CrossFit Fitness", "Inspire Fitness") === false,
  );

  // ════════════════════════════════════════════════════════════════════
  // Score boundary sanity beyond the F45 exactly-0.5 case above: below 0.5
  // fails, at/above 0.5 passes.
  // ════════════════════════════════════════════════════════════════════
  check(
    "1 of 3 distinctive tokens on the page (1/3 < 0.5) -> false",
    adPageMatchesCompetitor("Iron Works Cafe", "Iron Peak Strength Studio") === false,
  );
  check(
    "2 of 3 distinctive tokens on the page (2/3 >= 0.5) -> true",
    adPageMatchesCompetitor("Iron Peak Cafe", "Iron Peak Strength Studio") === true,
  );

  // ════════════════════════════════════════════════════════════════════
  // Numbers survive normalization (not stripped as "non-alphanumeric"),
  // and pure generic-word competitor names still never self-match an
  // unrelated numeric brand.
  // ════════════════════════════════════════════════════════════════════
  check("digits in tokens are preserved ('F45' stays 'f45', not stripped)", adPageMatchesCompetitor("F45 Training Clonmel", "F45 Training Clonmel") === true);

  console.log(`\nadPageMatch: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
