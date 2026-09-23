import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkServiceKey } from "@/lib/platform/auth";
import { verifyUserResetToken } from "@/lib/userPasswordReset";

export const dynamic = "force-dynamic";

/**
 * Is this reset link still good, and whose is it?
 *
 * The console asks before rendering the form, so an expired or already-used
 * link says so instead of taking a new password and then refusing it.
 */
const Body = z.object({ token: z.string().trim().min(1).max(200) });

export async function POST(req: NextRequest) {
  if (!checkServiceKey(req)) return new Response("Not found", { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, reason: "invalid" });

  const view = verifyUserResetToken(parsed.data.token);
  return view.status === "valid"
    ? NextResponse.json({ ok: true, email: view.email })
    : NextResponse.json({ ok: false, reason: view.status });
}
