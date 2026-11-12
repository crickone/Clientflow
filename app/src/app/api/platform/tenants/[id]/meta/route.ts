import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { invalidateFleetEnrichment } from "@/lib/platform/fleet";
import { NOT_STAFF_ERROR, isActivePlatformStaff, parseTenantId } from "@/lib/platform/routeTenant";
import { STAGES, setTenantMeta, type Stage } from "@/lib/platform/tenantMeta";

export const dynamic = "force-dynamic";

const schema = z.object({
  stage: z.enum(STAGES as [Stage, ...Stage[]]).nullable().optional(),
  ownerUserId: z.number().int().positive().nullable().optional(),
  tags: z.array(z.string().max(30)).max(20).optional(),
});

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = parseTenantId(id);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  if (parsed.data.ownerUserId != null && !isActivePlatformStaff(parsed.data.ownerUserId)) return NextResponse.json({ ok: false, error: NOT_STAFF_ERROR }, { status: 400 });
  setTenantMeta(tenantId, parsed.data);
  invalidateFleetEnrichment(tenantId);
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId, action: "meta.set", detail: parsed.data, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
