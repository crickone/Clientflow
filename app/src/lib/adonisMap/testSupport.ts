// app/src/lib/adonisMap/testSupport.ts
/**
 * Scratch-tenant helper for the adonisMap DB tests. Require it with
 * requireLocal AFTER installing the react/next shim (see the plan's DB-test shim).
 */
import fs from "node:fs";
import path from "node:path";

import { controlSqlite } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";

/** Noon UTC on an Irish calendar date: the same date in Dublin all year. */
export const noon = (date: string): number => Date.parse(`${date}T12:00:00Z`);

export async function withScratchTenant<T>(slug: string, fn: (tid: number) => Promise<T> | T): Promise<T> {
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, slug, dbFile) as { id: number };
  try {
    getTenantDbById(id); // opens the DB and runs ensureTenantTables
    return await fn(id);
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(id);
    fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
  }
}
