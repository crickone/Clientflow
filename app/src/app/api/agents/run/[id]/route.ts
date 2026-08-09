import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { getRun } from "@/lib/agents/runStore";

export const dynamic = "force-dynamic";

/**
 * Durable run resume endpoint (DR2 — .superpowers/sdd/durableruns-design.md).
 * `AssistantChat` polls this after a reload/navigate to pick a specialist run
 * back up: DR1's `/api/agents/[key]/chat` persists progress to `agent_runs`
 * (via `runStore`) as it streams and no longer dies when the client
 * disconnects, so the run may already be finished — or still going — by the
 * time the client asks again.
 *
 * Tenant-scoped: `getRun(tenantId, id)` resolves the DB via
 * `getTenantDbById(tenantId)` — the caller's own tenant only — so a run id
 * belonging to another tenant simply isn't found in THIS tenant's DB and
 * returns `undefined` here, same as an unknown/expired id. Both come back as
 * a plain 404; this route never distinguishes "not yours" from "doesn't
 * exist" to the client.
 *
 * `status` is one of `running | awaiting_approval | done | error` — `getRun`
 * already applies the stale guard (a `running` row untouched for >3 minutes
 * is reported as `error`), so the poller never needs to special-case a
 * server restart.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return new Response("No active account", { status: 401 });

  const run = getRun(membership.tenant.id, params.id);
  if (!run) return new Response("Not found", { status: 404 });

  return Response.json({
    status: run.status,
    text: run.text,
    pending: run.pending ?? [],
    artifacts: run.artifacts ?? [],
    error: run.error ?? null,
  });
}
