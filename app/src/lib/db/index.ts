import "server-only";

// Tenancy: the control DB initialises on import AND runs the idempotent boot
// migration as a side-effect (so it precedes the first login).
import "./control";
import { getCurrentTenantDb, openTenantDb, type TenantDb } from "./tenant";
import { seedTenant, getTenantBySlug } from "@/lib/tenants";
import { seedDefaultSite } from "@/lib/cms/seed";
import * as schema from "./schema";

// Skip boot mutation during `next build`. Page-data collection imports every
// route module (and thus this file) across parallel worker processes; the seed
// runs at runtime on the always-on server, not at build time.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  // Seed the default (renova) tenant's business defaults. No-op against the live
  // clinic.db (count-guarded); populates a fresh install.
  const renova = getTenantBySlug("renova");
  if (renova) {
    const { sqlite } = openTenantDb(renova.dbFile);
    seedTenant(sqlite);
    seedDefaultSite(sqlite); // CMS: ensure the default "renova" Site exists
  }

  // Arm the nightly backup + daily lapse on the always-on server (production
  // only). Lives here rather than instrumentation.ts so the better-sqlite3/S3
  // chain stays in the Node-only graph and is never compiled for the Edge runtime.
  if (process.env.NODE_ENV === "production") {
    import("@/lib/backup/scheduler")
      .then((m) => m.scheduleNightlyBackup())
      .catch((e) => console.error("[backup] scheduler arm failed:", e));
    import("@/lib/pipeline/lapseScheduler")
      .then((m) => m.scheduleDailyLapse())
      .catch((e) => console.error("[pipeline] lapse scheduler arm failed:", e));
  }
}

/**
 * The request-scoped tenant database. A Proxy that forwards every access to the
 * current request's resolved tenant connection (see ./tenant). The ~50 query
 * files import `{ db }` and are unchanged by the tenancy swap. Outside a request
 * (background jobs) the proxy resolves to the default tenant — jobs that must be
 * tenant-correct should use the explicit getTenantDb* helpers instead.
 */
export const db: TenantDb = new Proxy({} as TenantDb, {
  get(_target, prop, receiver) {
    const real = getCurrentTenantDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
