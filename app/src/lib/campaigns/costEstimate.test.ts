import { test } from "node:test";
import assert from "node:assert/strict";
import { AVG_TOKENS, estimateCampaignBuildCents, formatCentsEur } from "./costEstimate";
import { estCostCents, MODELS } from "@/lib/ai/client";
import { ASSET_ORDER } from "@/lib/campaigns/plan";

// The default 11-asset kit (7 kinds; social×3, email×3)
const KIT: { kind: (typeof ASSET_ORDER)[number] }[] = [
  { kind: "offer" }, { kind: "landing_page" }, { kind: "blog" },
  { kind: "social" }, { kind: "social" }, { kind: "social" },
  { kind: "email" }, { kind: "email" }, { kind: "email" },
  { kind: "ad_copy" }, { kind: "video_script" },
];

test("AVG_TOKENS has an entry for every asset kind", () => {
  for (const k of ASSET_ORDER) assert.ok(AVG_TOKENS[k], `missing AVG_TOKENS for ${k}`);
});

test("single-asset estimate equals one estCostCents call for that kind", () => {
  const got = estimateCampaignBuildCents([{ kind: "blog" }], MODELS.sonnet);
  const want = estCostCents(MODELS.sonnet, {
    inputTokens: AVG_TOKENS.blog.in, outputTokens: AVG_TOKENS.blog.out,
  });
  assert.equal(got, want);
});

test("the full kit sums per-asset (social/email counted 3x)", () => {
  const total = estimateCampaignBuildCents(KIT, MODELS.sonnet);
  const expected = KIT.reduce(
    (s, a) => s + estCostCents(MODELS.sonnet, { inputTokens: AVG_TOKENS[a.kind].in, outputTokens: AVG_TOKENS[a.kind].out }),
    0,
  );
  assert.equal(total, expected);
  assert.ok(total > 0);
});

test("a cheaper model estimates strictly less than Sonnet; a dearer one more", () => {
  const sonnet = estimateCampaignBuildCents(KIT, MODELS.sonnet);
  const haiku = estimateCampaignBuildCents(KIT, MODELS.haiku);
  const opus = estimateCampaignBuildCents(KIT, MODELS.opus);
  assert.ok(haiku < sonnet, `haiku ${haiku} should be < sonnet ${sonnet}`);
  assert.ok(opus > sonnet, `opus ${opus} should be > sonnet ${sonnet}`);
});

test("an unknown model prices as Sonnet (mirrors estCostCents fallback)", () => {
  assert.equal(estimateCampaignBuildCents(KIT, "no-such-model"), estimateCampaignBuildCents(KIT, MODELS.sonnet));
});

test("formatCentsEur", () => {
  assert.equal(formatCentsEur(0), "€0.00");
  assert.equal(formatCentsEur(15.12), "€0.15");
  assert.equal(formatCentsEur(4.9), "€0.05");
});
