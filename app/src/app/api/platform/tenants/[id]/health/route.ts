import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { clearStuckGenerations, getTenantHealth, retryFailedQueue, type HealthActionResult } from "@/lib/platform/health";

export const dynamic = "force-dynamic";

/**
 * One business's health, and the two repairs worth offering from here.
 *
 * The GET runs the deep integrity check: it is one tenant, on demand, and
 * the question being asked ("is their database sound?") is the whole point
 * of opening the tab. The fleet view deliberately skips it.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return NextResponse.json({ error: "Unknown business" }, { status: 404 });
  }
  return NextResponse.json(getTenantHealth(tenantId, { deep: true }));
}

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("clear-stuck") }),
  z.object({ op: z.literal("retry-queue"), queue: z.enum(["nurture", "posts"]) }),
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

  const action = `health.${parsed.op}`;
  const result: HealthActionResult =
    parsed.op === "clear-stuck" ? clearStuckGenerations(tenantId) : retryFailedQueue(tenantId, parsed.queue);

  recordAudit({
    actorUserId: g.userId,
    actorEmail: g.email,
    actorRole: g.role,
    tenantId,
    action,
    detail: parsed.op === "retry-queue" ? { queue: parsed.queue } : null,
    ip,
    ok: result.ok,
    error: result.ok ? null : result.error,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ...result, health: getTenantHealth(tenantId, { deep: true }) });
}
