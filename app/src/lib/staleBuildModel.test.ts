// Run: npm test -- src/lib/staleBuildModel.test.ts
import assert from "node:assert/strict";
import { looksLikeStaleDeploy, shouldAutoReload } from "./staleBuildModel";

assert.equal(looksLikeStaleDeploy('Failed to find Server Action "4017f6". This request might be from an older or newer deployment.'), true);
assert.equal(looksLikeStaleDeploy("Server Action not found."), true);
assert.equal(looksLikeStaleDeploy("Cannot read properties of undefined"), false);
assert.equal(looksLikeStaleDeploy(undefined), false);
assert.equal(shouldAutoReload({ pageBuild: "a", liveBuild: "b", reloadedFor: null }), true, "a new build: reload");
assert.equal(shouldAutoReload({ pageBuild: "a", liveBuild: "a", reloadedFor: null }), false, "same build: a real error, no reload");
assert.equal(shouldAutoReload({ pageBuild: "a", liveBuild: "b", reloadedFor: "b" }), false, "already reloaded for this build: never loop");
assert.equal(shouldAutoReload({ pageBuild: null, liveBuild: "b", reloadedFor: null }), false, "unknown page build: leave it");
console.log("staleBuildModel: 8 checks passed.");
