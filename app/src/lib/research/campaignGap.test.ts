// Run: npm test -- src/lib/research/campaignGap.test.ts
//
// Task 11 (Market Research P1) — "Build a campaign from this gap"'s seed
// builder. Pure (-> only ./themesJson, itself zero-import), so plain
// literals cover it end-to-end with no Module shim (same style as
// distance.test.ts). The house rule under test throughout: the angle text
// may only ever contain facts actually passed in — never an invented
// number, quote, or claim.
import assert from "node:assert/strict";

import { buildCompetitorGapSeed } from "./campaignGap";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

(async () => {
  // ── full data: rating + reviewCount + a cached theme ────────────────
  const fullSeed = buildCompetitorGapSeed({
    name: "Iron Gym Clonmel",
    ratingStars: 4.3,
    reviewCount: 128,
    themesJson: JSON.stringify({ themes: ["Cramped changing rooms", "Great classes"], at: "2026-08-24T09:00:00.000Z" }),
  });
  check("full data: seedName names the competitor", fullSeed.seedName === "Win over Iron Gym Clonmel's members");
  check("full data: angle carries the real rating", fullSeed.angle.includes("★4.3"));
  check("full data: angle carries the real review count", fullSeed.angle.includes("128 review"));
  check(
    "full data: angle quotes ONLY the FIRST cached theme, not the second",
    fullSeed.angle.includes('"Cramped changing rooms"') && !fullSeed.angle.includes("Great classes"),
  );
  check("full data: angle names the competitor", fullSeed.angle.includes("Iron Gym Clonmel"));

  // ── no cached themes yet (null themesJson) -> generic gap framing, no invented quote ──
  const noThemes = buildCompetitorGapSeed({
    name: "Riverside Fitness",
    ratingStars: 4.1,
    reviewCount: 40,
    themesJson: null,
  });
  check("no themes: still carries the real stats", noThemes.angle.includes("★4.1") && noThemes.angle.includes("40 review"));
  check("no themes: falls back to a generic angle (no quote mark)", !noThemes.angle.includes('"'));
  check("no themes: seedName still set", noThemes.seedName === "Win over Riverside Fitness's members");

  // ── malformed themesJson -> treated exactly like null (never throws, no fabricated theme) ──
  const malformed = buildCompetitorGapSeed({
    name: "Riverside Fitness",
    ratingStars: 4.1,
    reviewCount: 40,
    themesJson: "{not valid json",
  });
  check("malformed themesJson: same generic angle as null, doesn't throw", malformed.angle === noThemes.angle);

  // ── no rating/reviewCount/themes at all (a competitor never yet refreshed) ──
  const bareMinimum = buildCompetitorGapSeed({
    name: "New Gym Down The Road",
    ratingStars: null,
    reviewCount: null,
    themesJson: null,
  });
  check("bare minimum: no fabricated rating in the angle", !bareMinimum.angle.includes("★"));
  check("bare minimum: no fabricated review count in the angle", !/\d+ reviews?/.test(bareMinimum.angle));
  check("bare minimum: names the competitor regardless", bareMinimum.angle.includes("New Gym Down The Road"));
  check("bare minimum: never contains a fabrication artifact (undefined/null/NaN leaking into the string)",
    !/undefined|null|NaN/.test(bareMinimum.angle) && !/undefined|null|NaN/.test(bareMinimum.seedName));

  // ── rating present, review count absent (and vice versa) -> only the known half shows ──
  const ratingOnly = buildCompetitorGapSeed({ name: "X", ratingStars: 3.9, reviewCount: null, themesJson: null });
  check("rating only: shows the rating", ratingOnly.angle.includes("★3.9"));
  check("rating only: no review-count fragment", !/\d+ reviews?/.test(ratingOnly.angle));

  const reviewsOnly = buildCompetitorGapSeed({ name: "X", ratingStars: null, reviewCount: 7, themesJson: null });
  check("reviews only: shows the review count", reviewsOnly.angle.includes("7 review"));
  check("reviews only: no rating fragment", !reviewsOnly.angle.includes("★"));

  // singular/plural review count wording
  const singularReview = buildCompetitorGapSeed({ name: "X", ratingStars: null, reviewCount: 1, themesJson: null });
  check("singular review count reads '1 review' not '1 reviews'", singularReview.angle.includes("1 review)") || singularReview.angle.includes("1 review "));
  check("singular review count never reads '1 reviews'", !singularReview.angle.includes("1 reviews"));

  console.log(`\ncampaignGap: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
