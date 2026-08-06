import { NextResponse, type NextRequest } from "next/server";

import { checkServiceKey, destroyPlatformSession } from "@/lib/platform/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!checkServiceKey(req)) return new Response("Not found", { status: 404 });
  destroyPlatformSession(req);
  return NextResponse.json({ ok: true });
}
