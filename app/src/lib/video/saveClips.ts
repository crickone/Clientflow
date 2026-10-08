import "server-only";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { addAsset, ensureUploadDir, probe } from "@/lib/video/projects";
import { resolveLibraryPath } from "@/lib/video/brollLibrary";
import { detectOrientation, mayBeShotSideways } from "@/lib/video/orientation";

/**
 * Saving clips into a video project: an upload (main or b-roll) or a copy of
 * a b-roll clip from the library. Shared by the video page and video ads.
 */
export async function saveClips(
  projectId: number,
  tenantId: number,
  files: { main: File; broll: File[]; libraryBroll: string[] },
): Promise<void> {
  const project = { id: projectId };
  const dir = ensureUploadDir(projectId);

  async function persist(file: File, kind: "main" | "broll") {
    const ext = path.extname(file.name) || ".mp4";
    const filename = `${kind}-${crypto.randomBytes(4).toString("hex")}${ext}`;
    const dest = path.join(dir, filename);
    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(dest, buf);
    let probed: {
      durationSeconds: number;
      width: number | null;
      height: number | null;
      rotation: number;
    } = {
      durationSeconds: 0,
      width: null,
      height: null,
      rotation: 0,
    };
    try {
      probed = await probe(dest);
    } catch (err) {
      console.warn(`[content-studio] probe failed for ${dest}:`, err);
    }
    // Footage shot with the camera turned on its side (e.g. an A6400 rotated to
    // film "portrait") is a genuinely landscape file with NO rotation flag, so
    // probe() reports 0. Ask a vision model which way is up and store the
    // SUGGESTION — the operator confirms/corrects it in the editor before it's
    // used (never applied silently). Best-effort: resolves to 0 on any failure.
    let suggestedRotation = 0;
    if (kind === "main" && mayBeShotSideways(probed)) {
      suggestedRotation = await detectOrientation(dest, tenantId);
    }
    addAsset({
      projectId: project.id,
      kind,
      filename,
      originalName: file.name,
      mimeType: file.type || "video/mp4",
      sizeBytes: buf.length,
      durationSeconds: probed.durationSeconds || null,
      width: probed.width,
      height: probed.height,
      rotation: probed.rotation,
      metaRotation: probed.rotation,
      suggestedRotation,
    });
  }

  async function copyFromLibrary(libraryFilename: string) {
    const src = resolveLibraryPath(libraryFilename);
    if (!src) return; // silently skip unknown library entries
    const ext = path.extname(src) || ".mp4";
    const filename = `lib-${crypto.randomBytes(4).toString("hex")}${ext}`;
    const dest = path.join(dir, filename);
    fs.copyFileSync(src, dest);
    let probed: {
      durationSeconds: number;
      width: number | null;
      height: number | null;
      rotation: number;
    } = { durationSeconds: 0, width: null, height: null, rotation: 0 };
    try {
      probed = await probe(dest);
    } catch (err) {
      console.warn(`[content-studio] probe failed for ${dest}:`, err);
    }
    const stat = fs.statSync(dest);
    addAsset({
      projectId: project.id,
      kind: "broll",
      filename,
      originalName: libraryFilename,
      mimeType: "video/mp4",
      sizeBytes: stat.size,
      durationSeconds: probed.durationSeconds || null,
      width: probed.width,
      height: probed.height,
      rotation: probed.rotation,
      metaRotation: probed.rotation,
    });
  }

  await persist(files.main, "main");
  for (const file of files.broll) await persist(file, "broll");
  for (const filename of files.libraryBroll) await copyFromLibrary(filename);
}
