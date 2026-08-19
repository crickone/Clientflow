// Pure tests for the campaign asset plan + ordering helpers (Campaign Engine
// Slice 1: schema + migration + campaign store). No I/O, no DB — but store.ts
// (which re-exports these) also has `import "server-only"` + the drizzle CRUD
// via `import { db, schema } from "@/lib/db"`, and @/lib/db's module graph
// (-> @/lib/db/tenant -> react `cache` -> @/lib/tenants -> @/lib/auth ->
// next/navigation) throws on a plain static import under this runner's
// `--conditions=react-server` (npm's react "react-server" entry throws on
// load, so `cache` needs stubbing). Same two-part shim as
// src/lib/marketing/campaigns.test.ts / src/lib/forms.test.ts /
// src/lib/cms/blog.test.ts, for the same reason. Installed via a dynamic
// require (below) rather than a static import, since a static
// `import ... from "./store"` would be hoisted and evaluated before this
// shim runs — the two pure exports under test (DEFAULT_ASSET_PLAN,
// nextPendingAsset) themselves have zero DB/server-only imports (they live in
// ./plan and are just re-exported by store.ts), but importing store.ts still
// means loading its whole module graph first.
//
// Run: npm test -- src/lib/campaigns/store.test.ts
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in store.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { DEFAULT_ASSET_PLAN, nextPendingAsset } = requireLocal("./store") as typeof import("./store");

  // Default plan is the 11-asset order from the spec.
  const kinds = DEFAULT_ASSET_PLAN.map((a) => a.kind);
  assert.deepEqual(kinds, ["offer", "landing_page", "blog", "social", "social", "social", "email", "email", "email", "ad_copy", "video_script"]);
  assert.equal(DEFAULT_ASSET_PLAN[0].kind, "offer");
  assert.equal(DEFAULT_ASSET_PLAN.filter((a) => a.kind === "social").length, 3);
  assert.equal(DEFAULT_ASSET_PLAN.filter((a) => a.kind === "email").length, 3);
  assert.ok(DEFAULT_ASSET_PLAN.every((a, i) => a.sortOrder === i), "sortOrder is 0..N");

  // nextPendingAsset returns the lowest-sortOrder non-approved asset, or null.
  const assets = [{ id: 1, sortOrder: 0, status: "approved" }, { id: 2, sortOrder: 1, status: "drafted" }, { id: 3, sortOrder: 2, status: "pending" }] as any;
  assert.equal(nextPendingAsset(assets)?.id, 2, "first non-approved by order");
  assert.equal(nextPendingAsset(assets.map((a: any) => ({ ...a, status: "approved" }))), null, "all approved → null");

  console.log("store.test.ts: passed");
})();
