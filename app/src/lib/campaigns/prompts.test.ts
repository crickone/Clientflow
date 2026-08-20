/**
 * Pure tests for the campaign-kit prompt builders (Campaign Engine Slice 1:
 * asset generation dispatch). prompts.ts has zero runtime imports (only a
 * type-only import from @/lib/db/schema, erased at compile time), so this
 * loads under the plain tsx test runner exactly like
 * src/lib/pipeline/roles.test.ts — no DB, no shim needed.
 * Run: npm test -- src/lib/campaigns/prompts.test.ts
 */
import assert from "node:assert/strict";

import { HOUSE_RULES_CLAUSE, offerPrompt, adCopyPrompt, videoScriptPrompt, landingPagePrompt } from "./prompts";
import type { Campaign } from "@/lib/db/schema";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// Verbatim substring the spec requires HOUSE_RULES_CLAUSE to carry.
const HOUSE_RULES_SUBSTRING =
  "only use offers, guarantees and mechanisms sanctioned by the Marketing Brain — never invent a money-back guarantee or a free offer";

const campaign: Campaign = {
  id: 1,
  name: "Summer Shape Up 2026",
  slug: "summer-shape-up-2026",
  season: "Summer 2026",
  startsOn: "2026-06-01",
  endsOn: "2026-06-30",
  offer: "20% off all 6-week transformation programmes booked before June 30th",
  status: "building",
  createdAt: new Date(),
  updatedAt: new Date(),
};

check(
  "HOUSE_RULES_CLAUSE carries the verbatim house-rule substring",
  HOUSE_RULES_CLAUSE.includes(HOUSE_RULES_SUBSTRING),
);

const builders: Array<[string, (c: Campaign, tweak?: string) => string]> = [
  ["offerPrompt", offerPrompt],
  ["adCopyPrompt", adCopyPrompt],
  ["videoScriptPrompt", videoScriptPrompt],
  ["landingPagePrompt", landingPagePrompt],
];

for (const [name, build] of builders) {
  const base = build(campaign);
  check(`${name}: includes the campaign offer`, base.includes(campaign.offer));
  check(`${name}: includes the season`, base.includes(campaign.season as string));
  check(`${name}: includes HOUSE_RULES_CLAUSE verbatim (house-rule guarded)`, base.includes(HOUSE_RULES_CLAUSE));
  check(`${name}: omits an "Operator tweak" line when no tweak is passed`, !base.includes("Operator tweak"));

  const tweak = "Make it punchier and mention the free assessment week";
  const tweaked = build(campaign, tweak);
  check(`${name}: includes the tweak when passed`, tweaked.includes(tweak));
}

// landingPagePrompt-specific: the CTA is fixed to "Sign up" — never a price,
// booking action, or guarantee (the landing page captures a lead, it
// doesn't transact). It also instructs the model to produce SEO meta copy
// (metaTitle/metaDescription) alongside the landing copy itself.
{
  const out = landingPagePrompt(campaign);
  check('landingPagePrompt: states the CTA is "Sign up"', out.includes("Sign up"));
  check(
    "landingPagePrompt: instructs the model to also produce metaTitle + metaDescription",
    out.includes("metaTitle") && out.includes("metaDescription"),
  );
}

// A campaign with no season set / no offer decided yet still produces a
// coherent prompt (no crash, no "null"/"undefined" leaking into the text).
const bareCampaign: Campaign = { ...campaign, season: null, offer: "" };
for (const [name, build] of builders) {
  const out = build(bareCampaign);
  check(
    `${name}: handles a null season / empty offer without leaking "null"/"undefined"`,
    !/\bnull\b|\bundefined\b/i.test(out),
  );
}

console.log(`\n${passed} passed`);
