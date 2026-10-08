/**
 * Where a video project's files live: data/uploads/t<tenantId>/<projectId>.
 *
 * Until 2026-10-08 it was data/uploads/<projectId>. Project ids are counted
 * per tenant, so two businesses' "project 2" shared one folder. Files have
 * random names, so nothing was overwritten and the app never served one
 * business another's file, but the separation was wrong, offboarding could
 * not take a business's videos with it, and the console measured the wrong
 * folder. Files are moved into the tenant folder by name, from the tenant's
 * own records -- so a shared legacy folder splits correctly between its
 * owners -- and anything no tenant references is left where it is.
 *
 * Pure filesystem logic, no database: callers pass the filenames. Tested.
 */
import fs from "node:fs";
import path from "node:path";

export function uploadsRoot(): string {
  return path.join(process.cwd(), "data", "uploads");
}

export function tenantUploadRoot(tenantId: number, root: string = uploadsRoot()): string {
  return path.join(root, `t${tenantId}`);
}

export function projectDirFor(tenantId: number, projectId: number, root: string = uploadsRoot()): string {
  return path.join(tenantUploadRoot(tenantId, root), String(projectId));
}

export function legacyProjectDir(projectId: number, root: string = uploadsRoot()): string {
  return path.join(root, String(projectId));
}

/**
 * Move the named files of one project from the legacy folder into the
 * tenant's. A file already in place is left alone; a name that is not in the
 * legacy folder is skipped. Returns how many moved. The legacy folder is
 * removed once nothing is left in it.
 */
export function adoptLegacyFiles(tenantId: number, projectId: number, filenames: Iterable<string>, root: string = uploadsRoot()): number {
  const from = legacyProjectDir(projectId, root);
  if (!fs.existsSync(from)) return 0;
  const to = projectDirFor(tenantId, projectId, root);
  let moved = 0;
  for (const raw of new Set(filenames)) {
    const name = path.basename(raw);
    if (!name || name !== raw) continue;
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
    fs.mkdirSync(to, { recursive: true });
    fs.renameSync(src, dst);
    moved++;
  }
  try {
    if (fs.readdirSync(from).length === 0) fs.rmdirSync(from);
  } catch {
    /* still in use by another tenant's files */
  }
  return moved;
}
