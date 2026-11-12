// Run: npm test -- src/lib/setup/forTenant.test.ts
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
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  if (request === "next/headers") return { cookies: () => { throw new Error("no request here"); }, headers: () => { throw new Error("no request here"); } };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getSetupSummaryForTenant } = requireLocal("./steps") as typeof import("./steps");

  const slug = "setup-for-tenant-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, 'Setup Test', ?, 1) RETURNING id").get(slug, `tenants/${slug}/${slug}.db`) as { id: number };
  try {
    // No request, no cookie: this must still work for an explicit tenant.
    const s = getSetupSummaryForTenant(t.id);
    assert.equal(s.steps.length > 5, true);
    assert.equal(s.requiredDone, 0, "a brand-new tenant has done nothing");
    assert.equal(typeof s.nextTitle, "string");
    console.log("forTenant.test.ts: ok");
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    try { fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true }); } catch { /* best effort */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
