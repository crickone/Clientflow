// Run: npm test -- src/lib/campaigns/scoreboardData.test.ts
//
// Pure tests for aggregateConvertRevenue (Campaign Engine Slice 5, Task 2).
// The cases below are the money-math contract Task 3/4 build on: active-only
// MRR, upfront = non-cancelled memberships' first month (active + expired both
// collected a first payment; only cancelled gives it back) + non-cancelled
// packages + clinic packages, and empty input never throws.
//
// ./scoreboardData also holds gatherCampaignRevenue (the DB half, untested
// here) with `import "server-only"` + `@/lib/db` (the ambient db proxy) and
// `@/lib/leads` — both of which pull in @/lib/db/tenant (react `cache`) ->
// @/lib/tenants -> @/lib/auth -> next/navigation, which throws on a plain
// static import under this runner's `--conditions=react-server` (npm's react
// "react-server" entry throws on load, so `cache` needs stubbing). Same
// two-part shim as src/lib/campaigns/store.test.ts / src/lib/forms.test.ts /
// src/lib/cms/blog.test.ts, for the same reason. Installed via a dynamic
// require (below) rather than a static import, since a static `import
// { aggregateConvertRevenue } from "./scoreboardData"` would be hoisted and
// evaluated before this shim runs — aggregateConvertRevenue itself has zero
// DB/server-only imports, but loading the module it lives in still means
// loading its whole file, including gatherCampaignRevenue's imports.
import { test } from "node:test";
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
        throw new Error("next/navigation.redirect() stub called unexpectedly in scoreboardData.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);
const { aggregateConvertRevenue } = requireLocal("./scoreboardData") as typeof import("./scoreboardData");

test("MRR = active memberships' monthly price; cancelled/expired excluded", () => {
  const r = aggregateConvertRevenue({
    memberships: [
      { priceCents: 5000, status: "active" },
      { priceCents: 4000, status: "active" },
      { priceCents: 9999, status: "cancelled" },
      { priceCents: 8888, status: "expired" },
    ],
    packages: [], clinicPackagesCents: [],
  });
  assert.equal(r.mrrCents, 9000); // 5000 + 4000
});

test("upfront = active memberships' first month + non-cancelled packages + clinic packages", () => {
  const r = aggregateConvertRevenue({
    memberships: [{ priceCents: 5000, status: "active" }],       // first month 5000
    packages: [
      { priceCents: 12000, status: "active" },                    // counts
      { priceCents: 3000, status: "expired" },                    // counts (paid, now expired)
      { priceCents: 9999, status: "cancelled" },                  // excluded (refunded)
    ],
    clinicPackagesCents: [7500, 2500],                            // 10000
  });
  assert.equal(r.upfrontCashCents, 5000 + 12000 + 3000 + 10000); // 30000
});

test("expired memberships keep their upfront first-month credit; only cancelled is dropped", () => {
  const r = aggregateConvertRevenue({
    memberships: [
      { priceCents: 5000, status: "active" },                     // still recurring: counts in MRR + upfront
      { priceCents: 4000, status: "expired" },                    // lapsed, but its first month was collected: upfront only
      { priceCents: 9999, status: "cancelled" },                  // refunded/never collected: excluded from both
    ],
    packages: [], clinicPackagesCents: [],
  });
  assert.equal(r.mrrCents, 5000); // active only — the lapsed membership isn't still paying
  assert.equal(r.upfrontCashCents, 9000); // 5000 (active) + 4000 (expired) first months; cancelled's 9999 excluded
});

test("empty → zeros, never throws", () => {
  const r = aggregateConvertRevenue({ memberships: [], packages: [], clinicPackagesCents: [] });
  assert.deepEqual(r, { upfrontCashCents: 0, mrrCents: 0 });
});
