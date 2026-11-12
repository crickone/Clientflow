import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { controlSqlite } from "@/lib/db/control";
import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { listPlatformFlags, rolloutCount, setPlatformFlag } from "@/lib/platform/flags";
import { MODULE_KEYS } from "@/lib/features";

export const dynamic = "force-dynamic";

function activeTenantIds(): number[] {
  return (controlSqlite.prepare("SELECT id FROM tenants WHERE is_active = 1 AND archived_at IS NULL").all() as Array<{ id: number }>).map((r) => r.id);
}

export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const flags = listPlatformFlags();
  const ids = activeTenantIds();
  return NextResponse.json({ flags, tenantIds: ids, counts: Object.fromEntries(flags.map((f) => [f.key, rolloutCount(f, ids)])) });
}

const schema = z.object({
  flag: z.object({
    key: z.string().refine((k) => (MODULE_KEYS as readonly string[]).includes(k), { message: "Unknown module" }),
    mode: z.enum(["all", "none", "percent", "allow"]),
    percent: z.number().int().min(0).max(100),
    allow: z.array(z.number().int().positive()).max(500),
  }),
});

/** Owner-only: this changes what every business can see. */
export async function PUT(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  if (g.role !== "owner") {
    recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: null, action: "flags.set", detail: parsed.data.flag, ip: requestIp(req), ok: false, error: "not an owner" });
    return NextResponse.json({ ok: false, error: "Rollouts are an owner's action." }, { status: 403 });
  }
  setPlatformFlag(parsed.data.flag);
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: null, action: "flags.set", detail: parsed.data.flag, ip: requestIp(req) });
  return NextResponse.json({ ok: true, flags: listPlatformFlags() });
}
