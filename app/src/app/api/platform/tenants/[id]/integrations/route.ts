import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import {
  disconnectIntegration,
  listTenantIntegrations,
  revokeTenantApiKey,
  reverifySendingDomain,
  type IntegrationResult,
} from "@/lib/platform/integrations";

export const dynamic = "force-dynamic";

/**
 * A business's outside connections: read the board, take one away, or ask
 * Mailgun to check a domain's DNS again.
 *
 * Both console roles. Nothing here spends money or ends the relationship,
 * and a connection that has gone wrong is the most common reason a client
 * is on the phone. What no role can do is CREATE a connection: that needs
 * the client's own consent, and a console that could mint one could read a
 * client's mail without anyone agreeing to it.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return NextResponse.json({ error: "Unknown business" }, { status: 404 });
  }
  return NextResponse.json(listTenantIntegrations(tenantId));
}

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("disconnect"), key: z.string().min(1).max(120), reason: z.string().optional() }),
  z.object({ op: z.literal("reverify-domain"), reason: z.string().optional() }),
  z.object({ op: z.literal("revoke-api-key"), keyId: z.number().int().positive(), reason: z.string().optional() }),
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

  const action = `integrations.${parsed.op}`;
  let result: IntegrationResult;
  let detail: Record<string, unknown>;

  try {
    switch (parsed.op) {
      case "disconnect":
        detail = { key: parsed.key };
        result = await disconnectIntegration(tenantId, parsed.key);
        break;
      case "reverify-domain":
        detail = {};
        result = await reverifySendingDomain(tenantId);
        break;
      case "revoke-api-key":
        detail = { keyId: parsed.keyId };
        result = revokeTenantApiKey(tenantId, parsed.keyId);
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "That did not work.";
    recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId, action, ip, ok: false, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  recordAudit({
    actorUserId: g.userId,
    actorEmail: g.email,
    actorRole: g.role,
    tenantId,
    action,
    detail,
    reason: parsed.reason?.trim() || null,
    ip,
    ok: result.ok,
    error: result.ok ? null : result.error,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ...result, integrations: listTenantIntegrations(tenantId) });
}
