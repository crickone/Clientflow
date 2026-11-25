/**
 * Test support for the lead-flow tests (not a *.test.ts, so the runner never
 * runs it on its own). Require it after ./stubs.
 */
import fs from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";

import { controlSqlite } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";
import * as schema from "@/lib/db/schema";

import { setFlowClockForTests } from "../clock";

export interface Scratch {
  tid: number;
  slug: string;
  cleanup(): void;
}

/** A throwaway business with its own database. Slugs must end in "-test". */
export function makeScratchTenant(slug: string): Scratch {
  if (!slug.endsWith("-test")) throw new Error("scratch tenant slugs end in -test");
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, slug, `tenants/${slug}/${slug}.db`) as { id: number }).id;
  return {
    tid,
    slug,
    cleanup() {
      setFlowClockForTests(undefined);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    },
  };
}

export function setFlowEnabled(tid: number, key: string, enabled: boolean): void {
  getTenantDbById(tid)
    .insert(schema.automationTriggers)
    .values({ key, enabled })
    .onConflictDoUpdate({ target: schema.automationTriggers.key, set: { enabled } })
    .run();
}

/** Fix the lead-flow clock at `start`; move it with set/advance. */
export function fakeClock(start: number): { now(): number; set(t: number): void; advance(ms: number): void } {
  let t = start;
  setFlowClockForTests(() => t);
  return {
    now: () => t,
    set(v: number) {
      t = v;
    },
    advance(ms: number) {
      t += ms;
    },
  };
}

export function queueRows(tid: number, leadId: number) {
  return getTenantDbById(tid).select().from(schema.automationQueue).where(eq(schema.automationQueue.leadId, leadId)).all();
}
