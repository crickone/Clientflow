import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { getPlatformAnalytics } from "@/lib/platform/analytics";

export const dynamic = "force-dynamic";

/**
 * Cross-gym business intelligence: platform billing metrics (MRR/ARR, gym
 * status counts, invoices collected, gym growth) plus every active gym's own
 * business figures (members, active memberships, monthly membership GMV,
 * this-month revenue, leads, classes) aggregated across all tenants.
 */
export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  return NextResponse.json(getPlatformAnalytics());
}
