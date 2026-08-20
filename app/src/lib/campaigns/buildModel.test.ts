import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL_CATALOG } from "@/lib/ai/modelCatalog";
import { CONTENT_MODEL } from "@/lib/ai/client";
import { resolveCampaignBuildModel, isCampaignBuildModelId } from "./buildModel";

test("resolveCampaignBuildModel: a real catalog id passes through", () => {
  const anId = MODEL_CATALOG[0].id;
  assert.equal(resolveCampaignBuildModel(anId), anId);
});

test("resolveCampaignBuildModel: unset / empty / unknown / null → CONTENT_MODEL", () => {
  assert.equal(resolveCampaignBuildModel(""), CONTENT_MODEL);
  assert.equal(resolveCampaignBuildModel(null), CONTENT_MODEL);
  assert.equal(resolveCampaignBuildModel(undefined), CONTENT_MODEL);
  assert.equal(resolveCampaignBuildModel("claude-fable-5"), CONTENT_MODEL); // deliberately not in the catalog
  assert.equal(resolveCampaignBuildModel("garbage"), CONTENT_MODEL);
});

test("isCampaignBuildModelId: catalog membership", () => {
  assert.equal(isCampaignBuildModelId(MODEL_CATALOG[0].id), true);
  assert.equal(isCampaignBuildModelId("nope"), false);
});
