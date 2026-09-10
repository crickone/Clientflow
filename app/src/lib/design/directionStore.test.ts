// Run: npm test -- src/lib/design/directionStore.test.ts
//
// Applying a direction writes TWO things: the choice (direction + palette, so
// the page can show it and the operator can adjust it) and the composed
// system under the key every consumer already reads. Clearing removes both.
// A hand-authored system with no recorded choice reads as "custom" and is
// never touched -- that is Optimal Health in production today.
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
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { getDesignSystem, setDesignSystem } = requireLocal("./system") as typeof import("./system");
  const { OPTIMAL_HEALTH_DESIGN_SYSTEM } = requireLocal("./presets") as typeof import("./presets");
  const { applyDesignDirection, clearDesignDirection, designStatus, getStoredDirection } =
    requireLocal("./directionStore") as typeof import("./directionStore");

  const slug = "direction-store-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  const abs = path.join(process.cwd(), "data", dbFile);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  for (const f of [abs, `${abs}-wal`, `${abs}-shm`]) fs.rmSync(f, { force: true });
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Direction Store Test", dbFile) as { id: number };

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    for (const f of [abs, `${abs}-wal`, `${abs}-shm`]) fs.rmSync(f, { force: true });
  };

  try {
    runWithTenant(t.id, () => {
      assert.deepEqual(designStatus(), { kind: "none" }, "a fresh tenant has no design");
      assert.equal(getStoredDirection(), null);

      // A hand-authored system with no choice recorded is CUSTOM, and stays.
      setDesignSystem(OPTIMAL_HEALTH_DESIGN_SYSTEM);
      assert.deepEqual(designStatus(), { kind: "custom" }, "a hand-authored system reads as custom");

      // Apply a direction with a tenant palette.
      const r = applyDesignDirection("swiss", { red: "#B00020" });
      assert.deepEqual(r, { ok: true });
      const status = designStatus();
      assert.equal(status.kind, "direction");
      assert.equal((status as { directionId: string }).directionId, "swiss");
      assert.equal((status as { palette: Record<string, string> }).palette.red, "#b00020", "the palette is stored lower-cased");

      const system = getDesignSystem();
      assert.ok(system, "the composed system is stored where every consumer reads it");
      assert.equal(system!.font, "Space Grotesk");
      assert.equal(system!.values.find((v) => v.key === "red")?.hex, "#b00020", "the tenant's hex is in the system");
      assert.equal(system!.values.find((v) => v.key === "white")?.hex, "#ffffff", "unnamed slots took the default");

      // Bad input is refused, and nothing changes.
      assert.deepEqual(applyDesignDirection("nope", {}), { ok: false, error: "Unknown design direction." });
      assert.equal(applyDesignDirection("swiss", { red: "not a colour" }).ok, false, "a bad hex is refused");
      assert.equal(getDesignSystem()!.values.find((v) => v.key === "red")?.hex, "#b00020", "a refused apply changed nothing");

      // Clearing removes both.
      clearDesignDirection();
      assert.deepEqual(designStatus(), { kind: "none" });
      assert.equal(getDesignSystem(), null, "the system is gone too -- back to templates");
    });
    console.log("directionStore.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
