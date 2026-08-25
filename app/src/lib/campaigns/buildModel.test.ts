import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS, CONTENT_MODEL } from "@/lib/ai/client";
import { resolveCampaignBuildModel, isCampaignBuildModelId } from "./buildModel";

test("resolveCampaignBuildModel: a native-Anthropic choice passes through", () => {
  assert.equal(resolveCampaignBuildModel(MODELS.haiku), MODELS.haiku);
  assert.equal(resolveCampaignBuildModel(MODELS.sonnet), MODELS.sonnet);
  assert.equal(resolveCampaignBuildModel(MODELS.opus), MODELS.opus);
});

test("resolveCampaignBuildModel: unset / empty / unknown / null → CONTENT_MODEL", () => {
  assert.equal(resolveCampaignBuildModel(""), CONTENT_MODEL);
  assert.equal(resolveCampaignBuildModel(null), CONTENT_MODEL);
  assert.equal(resolveCampaignBuildModel(undefined), CONTENT_MODEL);
  assert.equal(resolveCampaignBuildModel("claude-fable-5"), CONTENT_MODEL); // deliberately not in the choices
  assert.equal(resolveCampaignBuildModel("garbage"), CONTENT_MODEL);
});

// Campaign generation now routes an `openrouter:`-prefixed build model through
// meteredComplete (@/lib/ai/metered → the provider-neutral one-shot), and the
// campaign list is Haiku + the full MODEL_CATALOG — so EVERY catalog OpenRouter
// id (DeepSeek, GLM, GPT-5, Gemini, …) is a valid choice. A made-up OpenRouter
// id NOT in the catalog is still rejected, same as any unknown id — the list is
// the catalog allowlist, not "any openrouter: string".
test("resolveCampaignBuildModel / isCampaignBuildModelId: catalog OpenRouter ids pass, unknown ones rejected", () => {
  assert.equal(resolveCampaignBuildModel("openrouter:z-ai/glm-5.2"), "openrouter:z-ai/glm-5.2");
  assert.equal(isCampaignBuildModelId("openrouter:z-ai/glm-5.2"), true);
  assert.equal(isCampaignBuildModelId("openrouter:openai/gpt-5"), true);
  assert.equal(resolveCampaignBuildModel("openrouter:openai/gpt-5"), "openrouter:openai/gpt-5");
  // A made-up OpenRouter id not in the catalog is still rejected.
  assert.equal(resolveCampaignBuildModel("openrouter:made/up-model"), CONTENT_MODEL);
  assert.equal(isCampaignBuildModelId("openrouter:made/up-model"), false);
});

test("isCampaignBuildModelId: choice membership", () => {
  assert.equal(isCampaignBuildModelId(MODELS.haiku), true);
  assert.equal(isCampaignBuildModelId(MODELS.sonnet), true);
  assert.equal(isCampaignBuildModelId(MODELS.opus), true);
  assert.equal(isCampaignBuildModelId("nope"), false);
});
