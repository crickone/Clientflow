import "server-only";

import fs from "node:fs";
import { eq } from "drizzle-orm";

import * as schema from "@/lib/db/schema";
import { getTenantDbById, type TenantDb } from "@/lib/db/tenant";
import { adoptLegacyFiles, legacyProjectDir } from "@/lib/video/uploadPaths";

/**
 * Every file name a tenant's project owns: its clips, its current render and
 * any video-ad renders. What the legacy-folder move takes, and nothing else.
 */
export function referencedProjectFiles(tdb: TenantDb, projectId: number): string[] {
  const names: string[] = [];
  for (const a of tdb.select({ f: schema.videoAssets.filename }).from(schema.videoAssets).where(eq(schema.videoAssets.projectId, projectId)).all()) names.push(a.f);
  const p = tdb.select({ out: schema.videoProjects.outputFilename }).from(schema.videoProjects).where(eq(schema.videoProjects.id, projectId)).get();
  if (p?.out) names.push(p.out);
  for (const ad of tdb.select({ o: schema.adCreatives.videoOutputs }).from(schema.adCreatives).where(eq(schema.adCreatives.videoProjectId, projectId)).all()) {
    try {
      for (const f of Object.values(JSON.parse(ad.o ?? "{}") as Record<string, string>)) if (typeof f === "string") names.push(f);
    } catch {
      /* not JSON */
    }
  }
  return names;
}

/** Move every tenant's legacy files into its own folder. Once per process; safe to repeat. */
export function sweepLegacyUploads(tenantIds: number[]): number {
  let moved = 0;
  for (const tid of tenantIds) {
    try {
      const tdb = getTenantDbById(tid);
      for (const p of tdb.select({ id: schema.videoProjects.id }).from(schema.videoProjects).all()) {
        if (!fs.existsSync(legacyProjectDir(p.id))) continue;
        moved += adoptLegacyFiles(tid, p.id, referencedProjectFiles(tdb, p.id));
      }
    } catch (err) {
      console.error(`[uploads] sweep failed for tenant ${tid}:`, err);
    }
  }
  return moved;
}

