import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { addAsset, ensureUploadDir, getProject, probe } from "@/lib/video/projects";
import { detectOrientation, mayBeShotSideways } from "@/lib/video/orientation";
import { getCurrentTenant } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ACCEPTED = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/x-matroska",
]);

/**
 * Add media to an EXISTING project — the counterpart of the create route's
 * upload, which until now was the only way to get footage into a project (so a
 * project's clips were fixed at creation time). Drag-and-drop in the editor and
 * the tray's "Add clips" button both post here.
 *
 * Defaults to b-roll; pass kind=main to replace the main clip. Mirrors the
 * create route: probe for duration/dimensions/rotation, and run the
 * sideways-shot orientation check on a main clip.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;

  const projectId = Number(params.id);
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "Project not found." }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid form data.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  const kind = String(form.get("kind") || "broll") === "main" ? "main" : "broll";
  const files = form
    .getAll("files")
    .filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "No files uploaded." }, { status: 400 });
  }

  const rejected = files.filter(
    (f) => f.type && !ACCEPTED.has(f.type.toLowerCase()),
  );
  if (rejected.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `${rejected[0].name} isn't a supported video (use MP4, MOV, WebM or MKV).`,
      },
      { status: 400 },
    );
  }

  const dir = ensureUploadDir(projectId);
  const tenantId = getCurrentTenant().id;
  const created: number[] = [];

  for (const file of files) {
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
    } = { durationSeconds: 0, width: null, height: null, rotation: 0 };
    try {
      probed = await probe(dest);
    } catch (err) {
      console.warn(`[content-studio] probe failed for ${dest}:`, err);
    }

    // Same sideways-shot check the create route runs — a clip dragged in later
    // deserves the same prompt as one uploaded up front.
    let suggestedRotation = 0;
    if (kind === "main" && mayBeShotSideways(probed)) {
      suggestedRotation = await detectOrientation(dest, tenantId);
    }

    const asset = addAsset({
      projectId,
      kind,
      filename,
      originalName: file.name,
      mimeType: file.type || "video/mp4",
      sizeBytes: buf.length,
      durationSeconds: probed.durationSeconds || null,
      width: probed.width,
      height: probed.height,
      rotation: probed.rotation,
      suggestedRotation,
    });
    created.push(asset.id);
  }

  return NextResponse.json({ ok: true, assetIds: created });
}
