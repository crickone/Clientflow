import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { controlSqlite } from "@/lib/db/control";
import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { alertAction, countOpenAlerts, listOpenAlerts } from "@/lib/platform/healthHistory";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const sp = req.nextUrl.searchParams;
  const tenantId = Number(sp.get("tenantId"));
  return NextResponse.json({
    alerts: listOpenAlerts({ tenantId: Number.isInteger(tenantId) && tenantId > 0 ? tenantId : undefined, includeSnoozed: sp.get("snoozed") === "1" }),
    counts: countOpenAlerts(),
  });
}

const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("ack"), id: z.number().int().positive() }),
  z.object({ op: z.literal("unack"), id: z.number().int().positive() }),
  z.object({ op: z.literal("snooze"), id: z.number().int().positive(), until: z.number().int().positive() }),
  z.object({ op: z.literal("assign"), id: z.number().int().positive(), userId: z.number().int().positive().nullable() }),
]);

export async function POST(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  const { id, ...op } = parsed.data;
  const row = controlSqlite.prepare("SELECT tenant_id FROM platform_alerts WHERE id = ?").get(id) as { tenant_id: number | null } | undefined;
  const r = alertAction(id, op, g.userId);
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: row?.tenant_id ?? null, action: `alert.${op.op}`, detail: { id, ...op }, ip: requestIp(req), ok: r.ok, error: r.ok ? null : r.error });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
