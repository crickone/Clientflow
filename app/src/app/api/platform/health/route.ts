import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { getFleetHealth } from "@/lib/platform/health";

export const dynamic = "force-dynamic";

/**
 * Every active business's alerts in one list. Shallow on purpose: no
 * integrity check, because that reads every byte of every database and this
 * page is opened to skim, not to diagnose.
 */
export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  return NextResponse.json(getFleetHealth());
}
