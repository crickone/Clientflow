// Run: npm test -- src/lib/ai/adIdeas.test.ts
//
// Ad concepts: the reply is coerced into a usable brief, and Shuffle moves on
// instead of handing back what the screen already showed.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  if (request.endsWith("/businessContext")) return { getBusinessContext: () => "" };
  if (request.endsWith("/metered")) return { meteredCreateFailSoft: async () => [] };
  if (request.endsWith("/client")) return { CONTENT_MODEL: "test" };
  if (request.endsWith("/settings")) return { getVenueType: () => "clinic" };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);
const { coerceAdIdea, dedupeAdIdeas, pickAdAngles, AD_ANGLES } = requireLocal("./adIdeas") as typeof import("./adIdeas");

// A concept without a hook or an offer is no brief at all.
assert.equal(coerceAdIdea({ hook: "x" }), null);
assert.equal(coerceAdIdea({ offer: "x" }), null);

// An unknown goal falls back to bookings rather than reaching the form.
const c = coerceAdIdea({ angle: "The detail", hook: "Sixty minutes, at your pace", offer: "A 60-minute session", goal: "sales", audience: "", why: "" });
assert.ok(c);
assert.equal(c!.goal, "bookings");

// Shown hooks are not offered again, nor reworded versions of them.
const a = { angle: "A", hook: "Switched off at 6pm, still wired at midnight", offer: "A PEMF chair session", audience: "", goal: "bookings" as const, why: "" };
const b = { angle: "B", hook: "Recovery time, right here in Clonmel", offer: "A massage in Clonmel", audience: "", goal: "awareness" as const, why: "" };
const kept = dedupeAdIdeas([a, b], ["Still wired at midnight, switched off at 6pm"], 6);
assert.deepEqual(kept.map((k) => k.angle), ["B"]);

// Angles are drawn without repeats.
const angles = pickAdAngles(6);
assert.equal(new Set(angles).size, 6);
assert.equal(pickAdAngles(99).length, AD_ANGLES.length);

console.log("adIdeas: 7 checks passed.");
