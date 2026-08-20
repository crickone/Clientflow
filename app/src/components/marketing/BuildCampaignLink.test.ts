// src/components/marketing/BuildCampaignLink.test.ts
//
// Tests the Build-campaign seed contract (`campaignSeedStarterMessage` +
// `buildCampaignSeedHref`). Imports from the pure sibling
// `./buildCampaignSeed` rather than `./BuildCampaignLink` itself:
// BuildCampaignLink.tsx re-exports the same two functions verbatim, but its
// own top-level `next/link` + `lucide-react` imports transitively pull in
// react, and this project's test runner (scripts/test.mjs) always sets
// `NODE_OPTIONS=--conditions=react-server`, under which react's
// "react-server" export condition (react.shared-subset.js) throws by design
// outside a real RSC bundler — so importing BuildCampaignLink.tsx here would
// crash on load regardless of which export this file actually uses. Same
// constraint, same fix, as src/components/messaging/campaignProgress.ts +
// campaignProgress.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignSeedStarterMessage, buildCampaignSeedHref } from "./buildCampaignSeed";

test("campaignSeedStarterMessage: a normal full seed returns the expected starter string (startsOn, no endsOn)", () => {
  const msg = campaignSeedStarterMessage({
    seedName: "Valentine's partner offer",
    season: "spring",
    startsOn: "2026-02-14",
    angle: "Partner / bring-a-friend offer",
  });
  // Derived by running the real function, not guessed:
  //   subject = `a "Valentine's partner offer" campaign`
  //   when    = ` around 2026-02-14 (spring)`   (startsOn set, endsOn absent -> "around" branch)
  //   angle   = ` Angle: Partner / bring-a-friend offer.`
  assert.equal(
    msg,
    `Create a "Valentine's partner offer" campaign around 2026-02-14 (spring). Angle: Partner / bring-a-friend offer.`,
  );
});

test("campaignSeedStarterMessage: a normal full seed returns the expected starter string (distinct startsOn/endsOn)", () => {
  const msg = campaignSeedStarterMessage({
    seedName: "Summer Kickoff",
    season: "summer",
    startsOn: "2026-06-01",
    endsOn: "2026-06-30",
    angle: "Bring a friend",
  });
  // Exercises the other `when` branch: startsOn && endsOn && endsOn !== startsOn
  //   -> ` for summer (2026-06-01–2026-06-30)`
  assert.equal(msg, `Create a "Summer Kickoff" campaign for summer (2026-06-01–2026-06-30). Angle: Bring a friend.`);
});

test("campaignSeedStarterMessage: an array-valued field (duplicated query key) does not throw and is treated as empty", () => {
  // Next.js App Router's searchParams is `string | string[] | undefined` at
  // runtime — a duplicated query key (?seedName=a&seedName=b) produces an
  // array. CampaignSeed's type claims `string | undefined`, so this is a
  // legitimate runtime shape the type system can't rule out (hence `as any`
  // to simulate it past the compiler, same as a real searchParams value
  // would arrive). Before the fix, `seed.seedName?.trim()` threw a TypeError
  // on the array; the `str()` coercion in buildCampaignSeed.ts now makes any
  // non-string value degrade to "".
  const seed = { seedName: ["a", "b"] as any, startsOn: "2026-02-14" };
  let msg: string | null = null;
  assert.doesNotThrow(() => {
    msg = campaignSeedStarterMessage(seed);
  });
  assert.equal(msg, "Create a campaign around 2026-02-14.");
  // The array value must not leak into the string in any form (no join
  // artifacts, no [object Object], no raw array literal).
  assert.ok(!String(msg).includes("a,b"));
  assert.ok(!String(msg).includes("["));
});

test("campaignSeedStarterMessage: an all-empty/undefined seed returns null", () => {
  assert.equal(campaignSeedStarterMessage({}), null);
  assert.equal(
    campaignSeedStarterMessage({ seedName: "", season: "", startsOn: "", endsOn: "", angle: "" }),
    null,
  );
  // Whitespace-only strings trim to "" via str(), so they count as empty too.
  assert.equal(campaignSeedStarterMessage({ seedName: "   ", angle: "\t" }), null);
});

test("campaignSeedStarterMessage: a seed with only endsOn set does not throw, and endsOn alone does not fabricate a dated message", () => {
  // NOTE on the guard fix: the pre-fix guard was
  //   `if (!name && !season && !startsOn && !angle) return null;`
  // — it never looked at endsOn at all. For a seed with ONLY endsOn set,
  // that meant name/season/startsOn/angle were all empty, so the guard
  // already (if accidentally) returned null for this exact case — verified
  // directly against the pre-fix source before touching it, with a
  // standalone trace of that exact expression. The post-fix guard (per the
  // task's own fix spec) is
  //   `if (!name && !season && !startsOn && !endsOn && !angle) return null;`
  // which now counts endsOn as "the seed has content" — so a lone endsOn no
  // longer trips the all-empty guard and the function proceeds. Since
  // endsOn is only ever read inside the `startsOn && endsOn` branch (never
  // on its own), the result is the generic fallback subject with no `when`
  // clause — non-null, and importantly still never throws and never
  // fabricates a bogus date-only clause. Locking in the real, verified
  // behaviour rather than an assumed one.
  const seed = { endsOn: "2026-03-01" };
  let msg: string | null = null;
  assert.doesNotThrow(() => {
    msg = campaignSeedStarterMessage(seed);
  });
  assert.equal(msg, "Create a campaign.");
});

test("buildCampaignSeedHref: round-trips a full seed's fields through the query string", () => {
  const seed = {
    seedName: "Valentine's partner offer",
    season: "spring",
    startsOn: "2026-02-14",
    endsOn: "2026-02-14",
    angle: "Partner / bring-a-friend offer",
  };
  const href = buildCampaignSeedHref(seed);
  assert.ok(href.startsWith("/agents/marketing?"));
  const qp = new URLSearchParams(href.split("?")[1]);
  assert.equal(qp.get("seedName"), seed.seedName);
  assert.equal(qp.get("season"), seed.season);
  assert.equal(qp.get("startsOn"), seed.startsOn);
  assert.equal(qp.get("endsOn"), seed.endsOn);
  assert.equal(qp.get("angle"), seed.angle);
});

test("buildCampaignSeedHref: an empty seed yields the bare path with no query string", () => {
  assert.equal(buildCampaignSeedHref({}), "/agents/marketing");
});
