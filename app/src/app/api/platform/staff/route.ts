import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { listPlatformStaff, setPlatformRole } from "@/lib/platform/roles";
import { getNotifyPrefs, setNotifyPrefs } from "@/lib/platform/notify";
import { recordAudit, requestIp } from "@/lib/platform/audit";

export const dynamic = "force-dynamic";

/** Who has console access, and what each of them may do. Readable by both roles. */
export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  return NextResponse.json({ staff: listPlatformStaff(), you: { userId: g.userId, role: g.role, notify: getNotifyPrefs(g.userId) } });
}

const patchSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(["owner", "manager"]),
});

/**
 * Change a staff member's role. Owner-only, and audited whichever way it
 * goes: who may do what is exactly the kind of change an audit log exists
 * for. `setPlatformRole` itself refuses a self-demotion and the removal of
 * the last owner.
 */
export async function PATCH(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const ip = requestIp(req);
  const action = "set-staff-role";

  if (g.role !== "owner") {
    recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: null, action, ip, ok: false, error: "not an owner" });
    return NextResponse.json({ ok: false, error: "Only an owner can change console access." }, { status: 403 });
  }

  let parsed;
  try {
    parsed = patchSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Pick a staff member and a role." }, { status: 400 });
  }

  const result = setPlatformRole(parsed.userId, parsed.role, g.userId);
  recordAudit({
    actorUserId: g.userId,
    actorEmail: g.email,
    actorRole: g.role,
    tenantId: null,
    action,
    detail: { userId: parsed.userId, role: parsed.role },
    ip,
    ok: result.ok,
    error: result.ok ? null : result.error,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, staff: listPlatformStaff() });
}

const prefsSchema = z.object({ notify: z.object({ instant: z.boolean(), digest: z.boolean() }) });

/** A staff member's own notification preferences. Not audited: it is their own inbox. */
export async function PUT(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const parsed = prefsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  setNotifyPrefs(g.userId, parsed.data.notify);
  return NextResponse.json({ ok: true, notify: getNotifyPrefs(g.userId) });
}
