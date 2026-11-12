import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { parseTenantId } from "@/lib/platform/routeTenant";
import { usageByModule } from "@/lib/analytics/moduleUsage";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = parseTenantId(id);
  if (!tenantId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  return NextResponse.json({ modules: usageByModule(tenantId, days) });
}
