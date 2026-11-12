import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { latestJobRuns, listJobRuns } from "@/lib/platform/jobRuns";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const sp = req.nextUrl.searchParams;
  const key = sp.get("key") || undefined;
  const limit = Number(sp.get("limit")) || 30;
  return NextResponse.json({ latest: latestJobRuns(), history: listJobRuns({ key, limit }) });
}
