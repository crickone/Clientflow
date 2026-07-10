import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { getProject, runRender } from "@/lib/video/projects";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(
  req: Request,
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
        error: `Cannot start render from status "${project.status}".`,
      },
      { status: 409 },
    );
  }

  let useSavedPlan = false;
  try {
    const body = await req.json();
    if (body && typeof body.useSavedPlan === "boolean") {
      useSavedPlan = body.useSavedPlan;
    }
  } catch {
    // Body is optional. POST with no JSON triggers a fresh Claude plan.
  }

  if (useSavedPlan && !project.planJson) {
    return NextResponse.json(
      {
        ok: false,
        error: "No saved plan to render — generate the reel first.",
      },
      { status: 400 },
    );
  }

  runRender(id, { useSavedPlan });
  return NextResponse.json({ ok: true });
}
