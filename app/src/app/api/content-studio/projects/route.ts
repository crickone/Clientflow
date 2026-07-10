import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  addAsset,
  createProject,
  ensureUploadDir,
  listProjects,
  probe,
  runTranscription,
} from "@/lib/video/projects";
import { resolveLibraryPath } from "@/lib/video/brollLibrary";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const rows = listProjects();
  return NextResponse.json({ ok: true, projects: rows });
}

export async function POST(req: Request) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid form data.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  const name = String(form.get("name") || "").trim();
  const aspectRatio = String(form.get("aspectRatio") || "9:16");
  const targetSeconds = Number(form.get("targetSeconds") || 45);
  const toneNotes = String(form.get("toneNotes") || "").trim() || null;
  const main = form.get("main");

  if (!name) {
    return NextResponse.json(
      { ok: false, error: "Project name is required." },
      { status: 400 },
    );
  }
  if (aspectRatio !== "9:16" && aspectRatio !== "1:1") {
    return NextResponse.json(
      { ok: false, error: "Aspect ratio must be 9:16 or 1:1." },
      { status: 400 },
    );
  }
  if (!(main instanceof File) || main.size === 0) {
    return NextResponse.json(
      { ok: false, error: "Main video is required." },
      { status: 400 },
    );
  }

  const broll = form
    .getAll("broll")
    .filter((v): v is File => v instanceof File && v.size > 0);

  const project = createProject({
    name,
    aspectRatio,
    targetSeconds: Number.isFinite(targetSeconds) ? targetSeconds : 45,
    toneNotes,
  });

  const dir = ensureUploadDir(project.id);

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
    });
  }

  const libraryBroll = form
    .getAll("libraryBroll")
    .map((v) => String(v))
    .filter((s) => s.length > 0);

  try {
    await persist(main, "main");
    for (const file of broll) {
      await persist(file, "broll");
    }
    for (const filename of libraryBroll) {
      await copyFromLibrary(filename);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save uploads.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  runTranscription(project.id);

  return NextResponse.json({ ok: true, projectId: project.id });
}
