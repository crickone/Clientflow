import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { getProject, runTranscription } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

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
  if (project.status === "transcribing") {
    return NextResponse.json(
      { ok: false, error: "Already transcribing." },
      { status: 409 },
    );
  }
  runTranscription(id);
  return NextResponse.json({ ok: true });
}
