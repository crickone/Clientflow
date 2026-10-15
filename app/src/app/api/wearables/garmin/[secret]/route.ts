import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { parseGarminPush } from "@/lib/wearables/model";
import { storePush } from "@/lib/wearables/store";

export const dynamic = "force-dynamic";

/**
 * Garmin's Health API pushes members' dailies, sleep, HRV and body
 * composition here. Server to server; the secret in the path
 * (GARMIN_PUSH_SECRET) is the check, and only members who connected Garmin
 * are matched. Always 200 on a good secret so Garmin doesn't retry no-ops.
 */
export async function POST(req: Request, { params }: { params: { secret: string } }) {
  const want = process.env.GARMIN_PUSH_SECRET?.trim();
  const a = Buffer.from(params.secret ?? "");
  const b = Buffer.from(want ?? "");
  if (!want || a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const stored = storePush("garmin", parseGarminPush(body));
  return NextResponse.json({ ok: true, stored });
}
