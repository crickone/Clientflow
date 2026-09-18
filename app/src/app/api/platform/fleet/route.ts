import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { listFleet, listKillSwitches, setKillSwitch, type KillSwitchKey } from "@/lib/platform/fleet";

export const dynamic = "force-dynamic";

/**
 * The fleet: every business with filters, and the switches that stop a
 * capability for all of them at once.
 *
 * Both roles can read. Only an owner can stop or restart the fleet — it is
 * the most far-reaching action the console has, and it needs a reason.
 */
export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const sp = req.nextUrl.searchParams;
  return NextResponse.json({
    tenants: listFleet({
      q: sp.get("q") ?? undefined,
      status: sp.get("status") ?? undefined,
      venueType: sp.get("venueType") ?? undefined,
    }),
    killSwitches: listKillSwitches(),
  });
}

const bodySchema = z.object({
  key: z.enum(["ai", "email", "posting"]),
  stopped: z.boolean(),
  reason: z.string().max(300).default(""),
});

export async function POST(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const ip = requestIp(req);
  const action = "fleet.kill-switch";

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  }

  if (g.role !== "owner") {
    recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: null, action, detail: { key: parsed.key }, ip, ok: false, error: "not an owner" });
    return NextResponse.json({ ok: false, error: "Stopping the platform is an owner's action." }, { status: 403 });
  }

  const result = setKillSwitch(parsed.key as KillSwitchKey, parsed.stopped, parsed.reason, `admin:${g.userId}`);
  recordAudit({
    actorUserId: g.userId,
    actorEmail: g.email,
    actorRole: g.role,
    tenantId: null,
    action,
    detail: { key: parsed.key, stopped: parsed.stopped },
    reason: parsed.reason.trim() || null,
    ip,
    ok: result.ok,
    error: result.ok ? null : result.error,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ok: true, note: result.note, killSwitches: listKillSwitches() });
}
