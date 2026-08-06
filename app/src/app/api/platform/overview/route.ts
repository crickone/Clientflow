import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { overview } from "@/lib/platform/queries";

export const dynamic = "force-dynamic";

/** Platform dashboard: MRR, status counts, needs-attention list, recent events. */
export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  return NextResponse.json(overview());
}
