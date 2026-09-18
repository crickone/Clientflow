import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import {
  cancelTenantInvite,
  inviteToTenant,
  listTenantPeople,
  revokeTenantSessions,
  setTenantAccess,
  setTenantRole,
  startPasswordReset,
  transferOwnership,
  type PeopleResult,
} from "@/lib/platform/people";

export const dynamic = "force-dynamic";

/**
 * Who can get into a business: read it, and change it.
 *
 * Both console roles may do all of this. Managing a client's staff is
 * support work, not an owner-level act -- nothing here moves money or ends
 * the relationship, and every change is audited with the actor either way.
 * The two refusals that matter (never leave a business with no admin, never
 * touch a person who is not a member) live in lib/platform/people, so they
 * hold however this route is called.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return NextResponse.json({ error: "Unknown business" }, { status: 404 });
  }
  return NextResponse.json(listTenantPeople(tenantId));
}

const bodySchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("invite"),
    email: z.string().min(5).max(200),
    role: z.enum(["admin", "staff"]),
    name: z.string().max(120).optional(),
  }),
  z.object({ op: z.literal("resend-invite"), email: z.string().min(5).max(200) }),
  z.object({ op: z.literal("cancel-invite"), inviteId: z.number().int().positive() }),
  z.object({ op: z.literal("set-role"), userId: z.number().int().positive(), role: z.enum(["admin", "staff"]) }),
  z.object({ op: z.literal("set-access"), userId: z.number().int().positive(), active: z.boolean() }),
  z.object({ op: z.literal("revoke-sessions"), userId: z.number().int().positive() }),
  z.object({ op: z.literal("reset-password"), userId: z.number().int().positive() }),
  z.object({ op: z.literal("transfer-ownership"), userId: z.number().int().positive() }),
]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = Number(params.id);
  const ip = requestIp(req);

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  }

  const action = `people.${parsed.op}`;
  const audit = (result: PeopleResult, detail: Record<string, unknown>) =>
    recordAudit({
      actorUserId: g.userId,
      actorEmail: g.email,
      actorRole: g.role,
      tenantId,
      action,
      detail,
      ip,
      ok: result.ok,
      error: result.ok ? null : result.error,
    });

  let result: PeopleResult;
  let detail: Record<string, unknown>;

  try {
    switch (parsed.op) {
      case "invite":
        detail = { email: parsed.email, role: parsed.role };
        result = await inviteToTenant({
          tenantId,
          email: parsed.email,
          role: parsed.role,
          name: parsed.name ?? null,
          invitedByUserId: g.userId,
          inviterName: g.name,
        });
        break;
      case "resend-invite":
        detail = { email: parsed.email };
        result = await resendSafely(tenantId, parsed.email, g.userId, g.name);
        break;
      case "cancel-invite":
        detail = { inviteId: parsed.inviteId };
        result = cancelTenantInvite(tenantId, parsed.inviteId);
        break;
      case "set-role":
        detail = { userId: parsed.userId, role: parsed.role };
        result = setTenantRole(tenantId, parsed.userId, parsed.role);
        break;
      case "set-access":
        detail = { userId: parsed.userId, active: parsed.active };
        result = setTenantAccess(tenantId, parsed.userId, parsed.active);
        break;
      case "revoke-sessions": {
        detail = { userId: parsed.userId };
        const ended = revokeTenantSessions(tenantId, parsed.userId);
        result = { ok: true, note: ended === 0 ? "They had no live sessions here." : `Ended ${ended} session${ended === 1 ? "" : "s"}.` };
        break;
      }
      case "reset-password":
        detail = { userId: parsed.userId };
        result = await startPasswordReset(tenantId, parsed.userId);
        break;
      case "transfer-ownership":
        detail = { userId: parsed.userId };
        result = transferOwnership(tenantId, parsed.userId);
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "That did not work.";
    audit({ ok: false, error: message }, { op: parsed.op });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  audit(result, detail);
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ...result, people: listTenantPeople(tenantId) });
}

/** Imported lazily so the module graph above stays small; see people.ts. */
async function resendSafely(tenantId: number, email: string, byUserId: number, name: string | null): Promise<PeopleResult> {
  const { resendTenantInvite } = await import("@/lib/platform/people");
  return resendTenantInvite({ tenantId, email, invitedByUserId: byUserId, inviterName: name });
}
