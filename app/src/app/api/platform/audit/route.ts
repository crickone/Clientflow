import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { auditActions, countAudit, listAudit } from "@/lib/platform/audit";

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
  const okRaw = sp.get("ok");
  const query = {
    tenantId: num("tenantId") ?? null,
    actorUserId: num("actorUserId"),
    actorEmail: sp.get("actorEmail") || undefined,
    action: sp.get("action") || undefined,
    ok: okRaw === "1" ? true : okRaw === "0" ? false : undefined,
    from: num("from"),
    to: num("to"),
    q: sp.get("q") || undefined,
    before: num("before"),
    limit: num("limit") ?? 100,
    offset: Number(sp.get("offset")) || 0,
  };
  return NextResponse.json({ entries: listAudit(query), total: countAudit(query), actions: auditActions() });
}
