import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { requestAutopilotStop } from "@/lib/agents/autopilot";

export const dynamic = "force-dynamic";

/** "Stop after this one": the job finishes the step it's on, then hands back. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return new Response("No active account", { status: 401 });
  return Response.json({ ok: requestAutopilotStop(membership.tenant.id, params.id) });
}
