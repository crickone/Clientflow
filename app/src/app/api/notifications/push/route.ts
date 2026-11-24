import { NextResponse } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/api/guard";
import { getCurrentMembership } from "@/lib/auth";
import { isPushConfigured } from "@/lib/push";
import { sendStaffPush } from "@/lib/notifications/push";
import { pushDeviceCount, removePushSubscription, savePushSubscription, subscriptionsFor } from "@/lib/notifications/store";

export const dynamic = "force-dynamic";

const subSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Alerts on for this browser or phone, with one test alert so the person sees it works. */
export async function POST(req: Request) {
  const denied = await guard("user");
  if (denied) return denied;
  const m = getCurrentMembership();
  if (!m) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isPushConfigured()) return NextResponse.json({ ok: false, error: "Alerts are not set up on this server yet." }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { subscription?: unknown } | null;
  const sub = subSchema.safeParse(body?.subscription);
  if (!sub.success) return NextResponse.json({ ok: false, error: "This device could not be saved." }, { status: 400 });
  savePushSubscription(m.user.id, sub.data, req.headers.get("user-agent"));
  const mine = subscriptionsFor([m.user.id]).filter((s) => s.endpoint === sub.data.endpoint);
  await sendStaffPush(m.tenant.id, mine, {
    title: "Alerts are on",
    body: `You will get alerts from ${m.tenant.name} on this device.`,
    url: "/settings/notifications",
    tag: "alerts-on",
    force: true,
  });
  return NextResponse.json({ ok: true, devices: pushDeviceCount(m.user.id) });
}

/** This browser or phone no longer gets alerts. */
export async function DELETE(req: Request) {
  const denied = await guard("user");
  if (denied) return denied;
  const m = getCurrentMembership();
  if (!m) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint === "string" && body.endpoint) removePushSubscription(m.user.id, body.endpoint);
  return NextResponse.json({ ok: true, devices: pushDeviceCount(m.user.id) });
}
