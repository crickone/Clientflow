import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import {
  createProject,
  listProjects,
  runTranscription,
} from "@/lib/video/projects";
import { saveClips } from "@/lib/video/saveClips";
import { getCurrentTenant } from "@/lib/db/tenant";

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

  const tenantId = getCurrentTenant().id;

  const libraryBroll = form
    .getAll("libraryBroll")
    .map((v) => String(v))
    .filter((s) => s.length > 0);

  try {
    await saveClips(project.id, tenantId, { main, broll, libraryBroll });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save uploads.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  runTranscription(project.id);

  return NextResponse.json({ ok: true, projectId: project.id });
}
