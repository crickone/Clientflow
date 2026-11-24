import { NextResponse } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/api/guard";
import { getCurrentMembership } from "@/lib/auth";
import { markAllRead, markRead, unreadCount } from "@/lib/notifications/store";

export const dynamic = "force-dynamic";

const bodySchema = z.union([z.object({ id: z.number().int().positive() }), z.object({ all: z.literal(true) })]);

/** Mark one notification ({id}) or all of them ({all:true}) as read for this person. */
export async function POST(req: Request) {
  const denied = await guard("user");
  if (denied) return denied;
  const m = getCurrentMembership();
  if (!m) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Nothing to mark." }, { status: 400 });
  if ("all" in parsed.data) markAllRead(m.user.id);
  else markRead(m.user.id, parsed.data.id);
  return NextResponse.json({ ok: true, unread: unreadCount(m.user.id, m.role) });
}
