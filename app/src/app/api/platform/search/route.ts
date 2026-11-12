import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { searchPlatform } from "@/lib/platform/search";

export const dynamic = "force-dynamic";

/** Console search. Both roles can read; nothing here is owner-only. */
export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ hits: searchPlatform(q, 12) });
}
