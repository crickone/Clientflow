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

// Locks C1: meteredCreate (the campaign generation chokepoint) calls native
// Anthropic directly with no OpenRouter/provider routing, so an
// `openrouter:`-prefixed id — a real, selectable MODEL_CATALOG entry, valid
// for the agent-chat picker — must NOT be a valid campaign build model. If
// this regresses, setCampaignBuildModel would again accept an id that breaks
// every subsequent campaign generation call.
test("resolveCampaignBuildModel / isCampaignBuildModelId: an OpenRouter id is REJECTED", () => {
  assert.equal(resolveCampaignBuildModel("openrouter:z-ai/glm-5.2"), CONTENT_MODEL);
  assert.equal(isCampaignBuildModelId("openrouter:z-ai/glm-5.2"), false);
});

test("isCampaignBuildModelId: choice membership", () => {
  assert.equal(isCampaignBuildModelId(MODELS.haiku), true);
  assert.equal(isCampaignBuildModelId(MODELS.sonnet), true);
  assert.equal(isCampaignBuildModelId(MODELS.opus), true);
  assert.equal(isCampaignBuildModelId("nope"), false);
});
