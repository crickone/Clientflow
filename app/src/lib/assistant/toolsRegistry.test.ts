// Run: npm test -- src/lib/assistant/toolsRegistry.test.ts
//
// GOLDEN MASTER for the write-approval registry (architecture review follow-up,
// 2026-08-31). The three structures that used to list every write tool
// separately — the WRITE_TOOLS Set (the security gate), the WRITE_LABELS map,
// and summarizeToolAction's per-tool switch — were consolidated into ONE
// source of truth, `WRITE_TOOL_META` in tools.ts, from which WRITE_TOOLS /
// isWriteTool / summarizeToolAction are all derived. The dispatch switch
// (executeTool) and the TOOLS schema array were deliberately left explicit.
//
// This test pins the PRE-refactor behaviour byte-for-byte so the consolidation
// can be proven behaviour-preserving:
//   1. WRITE_TOOLS still contains EXACTLY the same 33 names, in the same order
//      (the security boundary — a tool silently dropping out would auto-execute
//      a write without operator approval; a tool silently added would gate a
//      read).
//   2. summarizeToolAction returns the IDENTICAL string (curly vs straight
//      quotes and all) for every write tool, for both a fully-populated input
//      and an empty one (exercising the fallback branches).
//   3. isWriteTool stays false for representative READ tools.
//
// The golden values live in toolsRegistry.golden.json, captured from the
// original code by _capture (a throwaway script). If a summary is DELIBERATELY
// changed later, regenerate the fixture; an ACCIDENTAL change fails here.
//
// Shim mirrors tools.addExercise.test.ts: tools.ts -> @/lib/db/tenant (react
// `cache`, next/headers) and -> the specialist tool modules -> @/lib/auth ->
// next/navigation, so `cache` and `redirect` are stubbed under
// --conditions=react-server. summarizeToolAction/WRITE_TOOLS/isWriteTool are
// all pure (no DB), so no tenant fixture is needed.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("next/navigation.redirect() stub called unexpectedly in toolsRegistry.test.ts"); } };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

(async () => {
  const { WRITE_TOOLS, isWriteTool, summarizeToolAction } = requireLocal("./tools") as typeof import("./tools");

  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, "toolsRegistry.golden.json"), "utf8"),
  ) as {
    full: Record<string, unknown>;
    frozenWriteTools: string[];
    golden: Record<string, [string, string]>;
    readSamplesAllFalse: string[];
  };

  // 1. WRITE_TOOLS membership + order frozen.
  assert.deepStrictEqual([...WRITE_TOOLS], fixture.frozenWriteTools,
    "WRITE_TOOLS drifted from the frozen 33 (membership or order changed)");
  passed++;
  ok("WRITE_TOOLS has exactly 33 entries", WRITE_TOOLS.size === 33);

  // 2. isWriteTool agrees with WRITE_TOOLS, and stays false for read tools.
  for (const n of fixture.frozenWriteTools) ok(`isWriteTool("${n}") is true`, isWriteTool(n) === true);
  for (const n of fixture.readSamplesAllFalse) ok(`isWriteTool("${n}") is false (read tool)`, isWriteTool(n) === false);

  // 3. summarizeToolAction byte-identical for full + empty input, every write tool.
  for (const n of fixture.frozenWriteTools) {
    const [full, empty] = fixture.golden[n];
    assert.strictEqual(summarizeToolAction(n, fixture.full), full, `summarizeToolAction("${n}", full) drifted`);
    assert.strictEqual(summarizeToolAction(n, {}), empty, `summarizeToolAction("${n}", {}) drifted`);
    passed += 2;
  }

  // 4. Unknown tool falls back to the humanised name (default branch).
  ok("summarizeToolAction unknown → humanised name",
    summarizeToolAction("some_new_tool", {}) === "some new tool");

  console.log(`toolsRegistry.test.ts: all ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
