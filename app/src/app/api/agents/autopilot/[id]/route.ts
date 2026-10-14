import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { getAutopilot } from "@/lib/agents/autopilot";

export const dynamic = "force-dynamic";

/**
 * Where a "build everything" job has got to: the messages it has added so
 * far (with any reply still being written) and its status. Tenant-scoped: an
 * id from another account isn't found in this tenant's DB and 404s.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return new Response("No active account", { status: 401 });
  const job = getAutopilot(membership.tenant.id, params.id);
  if (!job) return new Response("Not found", { status: 404 });
  return Response.json(job);
}
