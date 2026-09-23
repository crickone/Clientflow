import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkServiceKey } from "@/lib/platform/auth";
import { completeUserReset } from "@/lib/userPasswordReset";

export const dynamic = "force-dynamic";

/**
 * Set the new password. `completeUserReset` owns the rules — single use,
 * expiry, minimum length — and revokes the user's existing sessions, so a
 * reset also boots whoever might be holding a stolen one.
 */
const Body = z.object({
  token: z.string().trim().min(1).max(200),
  password: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  if (!checkServiceKey(req)) return new Response("Not found", { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const result = completeUserReset(parsed.data.token, parsed.data.password);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
