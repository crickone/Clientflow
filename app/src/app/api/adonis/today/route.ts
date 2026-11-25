import { guard } from "@/lib/api/guard";
import { getCurrentMembership } from "@/lib/auth";
import { getTodayCounts } from "@/lib/adonis/today";

export const dynamic = "force-dynamic";

/** "Needs you today" on the /adonis opening screen. Staff see the inbox numbers; money is for admins. */
export async function GET() {
  const denied = await guard("user");
  if (denied) return denied;
  const membership = getCurrentMembership();
  if (!membership) return Response.json({ ok: false, error: "No active account" }, { status: 401 });
  try {
    return Response.json({ ok: true, today: getTodayCounts({ tenantId: membership.tenant.id, withSales: membership.role === "admin" }) });
  } catch (err) {
    console.error("[adonis/today]", err);
    return Response.json({ ok: false, error: "Could not read today's numbers." }, { status: 500 });
  }
}
