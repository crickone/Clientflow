import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCurrentMembership } from "@/lib/auth";
import { listForUser, unreadCount } from "@/lib/notifications/store";

export const dynamic = "force-dynamic";

/** The bell: this person's unread count and their latest 30 notifications. */
export async function GET() {
  const denied = await guard("user");
  if (denied) return denied;
  const m = getCurrentMembership();
  if (!m) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(
    { ok: true, unread: unreadCount(m.user.id, m.role), items: listForUser(m.user.id, m.role, 30) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
