import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { listTracks } from "@/lib/video/music";

export const dynamic = "force-dynamic";

export async function GET() {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const tracks = listTracks();
  return NextResponse.json({ ok: true, tracks });
}
