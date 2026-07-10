import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { getProject, runPlan } from "@/lib/video/projects";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Run Claude planning only. The user reviews the plan, optionally edits it,
 * and then triggers the ffmpeg render explicitly via /render with
 * useSavedPlan=true.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const id = Number(params.id);
  const project = getProject(id);
  if (!project) {
    return NextResponse.json(
      { ok: false, error: "Project not found." },
      { status: 404 },
    );
  }
  if (
    project.status !== "transcribed" &&
    project.status !== "rendered" &&
    project.status !== "failed"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Cannot plan from status "${project.status}".`,
      },
      { status: 409 },
    );
  }
  if (!project.transcriptJson) {
    return NextResponse.json(
      { ok: false, error: "Project has no transcript yet." },
      { status: 400 },
    );
  }
  runPlan(id);
  return NextResponse.json({ ok: true });
}
