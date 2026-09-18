import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { listAudit } from "@/lib/platform/audit";

export const dynamic = "force-dynamic";

/**
 * The console's audit log. Readable by both roles: a manager seeing what
 * has been done to an account is part of doing support, and an audit trail
 * only some people can read is half an audit trail.
 */
export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;

  const sp = req.nextUrl.searchParams;
  const num = (k: string) => {
    const v = Number(sp.get(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };

  return NextResponse.json({
    entries: listAudit({
      tenantId: num("tenantId") ?? null,
      actorUserId: num("actorUserId"),
      action: sp.get("action") || undefined,
      before: num("before"),
      limit: num("limit") ?? 100,
    }),
  });
}
