import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { listClips } from "@/lib/video/brollLibrary";

export const dynamic = "force-dynamic";

export async function GET() {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const clips = await listClips();
  return NextResponse.json({ ok: true, clips });
}
