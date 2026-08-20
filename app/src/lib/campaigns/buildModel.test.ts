import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import { MODEL_CATALOG } from "@/lib/ai/modelCatalog";
import { CONTENT_MODEL } from "@/lib/ai/client";

// buildModel.ts imports @/lib/settings which imports React's server-only `cache`.
// Under the runner's `--conditions=react-server`, npm's react "react-server" entry
// point is a stub that THROWS on load. Shim `react` with an identity `cache` BEFORE
// buildModel.ts is required (via dynamic require below), so the real code path loads
// unchanged.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);
const { resolveCampaignBuildModel, isCampaignBuildModelId } = requireLocal(
  "./buildModel",
) as typeof import("./buildModel");

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
