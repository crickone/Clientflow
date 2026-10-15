import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentClient } from "@/lib/clientAuth";
import { getBusinessProfile } from "@/lib/businessProfile";
import { isPushConfigured, removeSubscription, saveSubscription, sendToClient } from "@/lib/push";

export const dynamic = "force-dynamic";

const subSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Save this phone for notifications, and send a short "you're set" so the member sees it works. */
export async function POST(req: Request) {
  const c = getCurrentClient();
  if (!c) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  if (!isPushConfigured()) return NextResponse.json({ ok: false, error: "Notifications aren't set up yet." }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { subscription?: unknown; test?: boolean } | null;
  const sub = subSchema.safeParse(body?.subscription);
  if (!sub.success) return NextResponse.json({ ok: false, error: "That device couldn't be saved." }, { status: 400 });
  saveSubscription(c.clientId, sub.data, req.headers.get("user-agent"));
  if (body?.test) {
    await sendToClient(c.clientId, { title: "Notifications are on", body: `You'll get reminders from ${getBusinessProfile().businessName || "your gym"} for classes, check-ins and habits.`, url: "/app" });
  }
  return NextResponse.json({ ok: true });
}

/** This phone no longer gets notifications. */
export async function DELETE(req: Request) {
  const c = getCurrentClient();
  if (!c) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (body?.endpoint) removeSubscription(c.clientId, body.endpoint);
  return NextResponse.json({ ok: true });
}
