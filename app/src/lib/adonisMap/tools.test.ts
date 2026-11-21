// Run: npm test -- src/lib/adonisMap/tools.test.ts
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
      redirect: () => { throw new Error("redirect() stub called in a test"); },
      notFound: () => { throw new Error("notFound() stub called in a test"); },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { withScratchTenant } = requireLocal("./testSupport") as typeof import("./testSupport");
  const { setPlatformFlag } = requireLocal("../platform/flags") as typeof import("../platform/flags");
  const { ensureAgents } = requireLocal("../agents/registry") as typeof import("../agents/registry");
  const { resolveChatAgent } = requireLocal("../agents/chatAgent") as typeof import("../agents/chatAgent");
  const { composeAgentSystem } = requireLocal("../agents/context") as typeof import("../agents/context");
  const { TOOLS, WRITE_TOOLS, executeTool } = requireLocal("../assistant/tools") as typeof import("../assistant/tools");
  const { ORCHESTRATOR_SPECIALIST } = requireLocal("../agents/specialists/orchestrator") as typeof import("../agents/specialists/orchestrator");
  const { MAP_TOOL_NAMES } = requireLocal("./names") as typeof import("./names");

  const before = controlSqlite.prepare("SELECT key, mode, percent, allow FROM platform_flags WHERE key = 'adonis_map'").get() as
    { key: string; mode: "all" | "none" | "percent" | "allow"; percent: number; allow: string } | undefined;
  const mapNames = new Set<string>(MAP_TOOL_NAMES);
  try {
    await withScratchTenant("adonis-map-tools", async (tid) => {
      ensureAgents(tid);
      for (const n of MAP_TOOL_NAMES) {
        assert.ok(TOOLS.some((t) => t.name === n), `${n} is registered in TOOLS`);
        assert.ok(!WRITE_TOOLS.has(n), `${n} is a read tool and never needs approval`);
        assert.ok(ORCHESTRATOR_SPECIALIST.toolNames.includes(n), `Adonis lists ${n}`);
      }

      setPlatformFlag({ key: "adonis_map", mode: "none", percent: 100, allow: [] });
      const off = resolveChatAgent(tid, "orchestrator");
      assert.ok(off, "Adonis resolves");
      assert.ok(!off.tools.some((t) => mapNames.has(t.name)), "no map tools while the flag is off");
      assert.ok(!runWithTenant(tid, () => composeAgentSystem(tid, "orchestrator")).includes("=== BUSINESS MAP ==="));
      const refused = JSON.parse((await executeTool("map_count", { type: "Person" }, { tenantId: tid })).text) as { error: string };
      assert.match(refused.error, /isn't switched on/);

      setPlatformFlag({ key: "adonis_map", mode: "allow", percent: 100, allow: [tid] });
      const on = resolveChatAgent(tid, "orchestrator");
      for (const n of MAP_TOOL_NAMES) assert.ok(on?.tools.some((t) => t.name === n), `${n} offered while the flag is on`);
      const sys = runWithTenant(tid, () => composeAgentSystem(tid, "orchestrator"));
      assert.ok(sys.includes("=== BUSINESS MAP ==="));
      assert.ok(sys.indexOf("=== BUSINESS MAP ===") < sys.indexOf("=== NON-NEGOTIABLE RULES"), "safety rails stay last");
      const counted = JSON.parse((await executeTool("map_count", { type: "Person" }, { tenantId: tid })).text) as { total: number };
      assert.equal(counted.total, 0);
      const bad = JSON.parse((await executeTool("map_find", { type: "Person", where: [{ field: "shoe", op: "eq", value: 1 }] }, { tenantId: tid })).text) as { error: string };
      assert.match(bad.error, /Unknown field "shoe"/);
    });
  } finally {
    if (before) setPlatformFlag({ key: before.key, mode: before.mode, percent: before.percent, allow: JSON.parse(before.allow) as number[] });
    else controlSqlite.prepare("DELETE FROM platform_flags WHERE key = 'adonis_map'").run();
  }
  console.log("tools.test.ts: all assertions passed");
})();
