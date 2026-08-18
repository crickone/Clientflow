// Run: npm test -- src/lib/setup/steps.test.ts
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

// steps.ts imports @/lib/db/tenant (getCurrentTenant) and @/lib/db (db,
// schema), both of which import React's server-only `cache` at module load.
// Under the runner's `--conditions=react-server`, npm's react "react-server"
// entry point is a stub that THROWS on load (same issue + fix as
// db/tenant.test.ts / billing/engine.test.ts / tenants.test.ts) — shim
// `react` with an identity `cache` BEFORE steps.ts is required, via a
// dynamic require (below) rather than a static import, since a static
// `import ... from "./steps"` would be hoisted and evaluated before this
// shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

const VOCAB = { services: "Classes", members: "Members" } as any;

(async () => {
  const { SETUP_STEPS, summarizeSetup } = requireLocal("./steps") as typeof import("./steps");

  // All required detected, all optional detected → fully resolved, no next.
  const allTrue = Object.fromEntries(SETUP_STEPS.map((s) => [s.id, true]));
  const full = summarizeSetup(SETUP_STEPS, allTrue, {}, VOCAB);
  assert.equal(full.allResolved, true);
  assert.equal(full.nextHref, null);
  assert.equal(full.requiredDone, full.requiredTotal);
  assert.equal(full.resolved, full.total);

  // Nothing done → not resolved; requiredDone 0; nextHref = first step's action href-or-/setup.
  const none = summarizeSetup(SETUP_STEPS, {}, {}, VOCAB);
  assert.equal(none.allResolved, false);
  assert.equal(none.requiredDone, 0);
  assert.ok(none.nextHref, "nextHref points at the first unresolved step");
  assert.equal(none.resolved, 0);

  // An optional step SKIPPED counts as resolved but not done.
  const optional = SETUP_STEPS.find((s) => s.optional)!;
  const required = SETUP_STEPS.filter((s) => !s.optional);
  // every required done, the chosen optional skipped, other optionals still open:
  const det = Object.fromEntries(required.map((s) => [s.id, true]));
  const withSkip = summarizeSetup(SETUP_STEPS, det, { [optional.id]: true }, VOCAB);
  const row = withSkip.steps.find((s) => s.id === optional.id)!;
  assert.equal(row.skipped, true);
  assert.equal(row.done, false);
  // allResolved requires the OTHER optionals resolved too — so still false here
  // unless this is the only optional; assert the skipped one is counted resolved:
  assert.ok(withSkip.resolved >= required.length + 1);

  // requiredTotal is the count of non-optional steps; vocab overrides a title.
  assert.equal(full.requiredTotal, required.length);
  const servicesRow = full.steps.find((s) => s.id === "services")!;
  assert.equal(servicesRow.title, "Classes", "labelKey services → vocab.services");
  const clientsRow = full.steps.find((s) => s.id === "clients")!;
  assert.ok(clientsRow.title.includes("Members"), "labelKey members → vocab.members");

  console.log("steps.test.ts: all assertions passed");
})();
