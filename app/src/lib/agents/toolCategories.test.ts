// Run: npm test -- src/lib/agents/toolCategories.test.ts
//
// Pins that TOOL_CATEGORIES (@/lib/agents/toolCategories) — the user-facing
// grouping behind the tool-access toggles on /agents/[key] — covers EXACTLY
// Adonis's tool set: every one of ORCHESTRATOR_SPECIALIST.toolNames is in one
// and only one category, no category lists a tool Adonis doesn't have, and no
// tool is listed twice. This is the guard that a tool added to (or removed
// from) Adonis without updating the categories is caught HERE, not silently
// dumped into groupToolsByCategory's trailing "Other" bucket at runtime.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). Same
// Module._load shim as specialistToolSlice.test.ts, needed because reading
// ORCHESTRATOR_SPECIALIST.toolNames loads @/lib/assistant/tools (React's
// server-only `cache`) and, transitively, @/lib/auth -> next/navigation.
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
        throw new Error("next/navigation.redirect() stub called unexpectedly in toolCategories.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { TOOL_CATEGORIES, groupToolsByCategory } =
    requireLocal("./toolCategories") as typeof import("./toolCategories");
  // Loaded FIRST establishes the tools.ts module-graph root (same require-order
  // care as the other agent tests).
  const { SPECIALISTS } = requireLocal("./specialists") as typeof import("./specialists");
  const adonisTools = [...SPECIALISTS.orchestrator.toolNames];

  // ── (a) every category is well-formed: unique key, non-empty label + tools ──
  const seenKeys = new Set<string>();
  for (const c of TOOL_CATEGORIES) {
    assert.ok(c.key && !seenKeys.has(c.key), `category key "${c.key}" is present and unique`);
    seenKeys.add(c.key);
    assert.ok(typeof c.label === "string" && c.label.trim().length > 0, `category "${c.key}" has a non-empty label`);
    assert.ok(Array.isArray(c.tools) && c.tools.length > 0, `category "${c.key}" has a non-empty tools list`);
  }

  // ── (b) no tool appears in more than one category ──
  const allCategoryTools = TOOL_CATEGORIES.flatMap((c) => c.tools);
  const dupes = allCategoryTools.filter((t, i) => allCategoryTools.indexOf(t) !== i);
  assert.deepEqual(dupes, [], `no tool is listed in more than one category (dupes: ${[...new Set(dupes)].join(", ") || "none"})`);

  // ── (c) categories cover EXACTLY Adonis's tool set — every Adonis tool is
  // categorised, and no category names a tool Adonis doesn't have ──
  const categorised = new Set(allCategoryTools);
  const adonis = new Set(adonisTools);
  const missing = adonisTools.filter((t) => !categorised.has(t));
  const extra = allCategoryTools.filter((t) => !adonis.has(t));
  assert.deepEqual(missing, [], `every Adonis tool has a category (uncategorised: ${missing.join(", ") || "none"})`);
  assert.deepEqual(extra, [], `no category lists a tool Adonis doesn't have (extra: ${extra.join(", ") || "none"})`);
  assert.equal(categorised.size, adonis.size, "the category tool set and Adonis's tool set are the same size");

  // ── (d) grouping Adonis's real tools produces NO "Other" bucket (the proof
  // (c) holds through the actual runtime helper the UI calls) ──
  const groups = groupToolsByCategory(adonisTools);
  assert.ok(!groups.some((g) => g.key === "other"), "groupToolsByCategory produces no \"Other\" bucket for Adonis's tools");
  const groupedTotal = groups.reduce((n, g) => n + g.tools.length, 0);
  assert.equal(groupedTotal, adonisTools.length, "grouping preserves every tool (count matches, no drops)");

  console.log("toolCategories.test.ts: all assertions passed");
})();
