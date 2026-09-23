import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkServiceKey } from "@/lib/platform/auth";
import { requestPlatformUserReset } from "@/lib/userPasswordReset";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Console password reset — request a link.
 *
 * Guarded by the service key ONLY, never `guardPlatform`: the whole point is
 * that the caller cannot sign in, so requiring a platform session would make
 * the endpoint useless. The console's server action holds the key, so this is
 * not reachable from a browser.
 *
 * Always answers { ok: true }, whatever the email — the response must not
 * reveal which addresses have an account.
 */
const Body = z.object({
  email: z.string().trim().max(200),
  /** Where the emailed link should point — the console's own origin. */
  consoleUrl: z.string().url().optional(),
});

export async function POST(req: NextRequest) {
  if (!checkServiceKey(req)) return new Response("Not found", { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: true });

  const email = parsed.data.email.toLowerCase();
  // Same posture as the CRM's own forgot-password action: throttled per email,
  // and a throttled request still reports success and quietly does nothing.
  if (!rateLimit(`platform-reset:${email}`, 3, 60 * 60 * 1000).ok) {
    return NextResponse.json({ ok: true });
  }

  const consoleUrl =
    parsed.data.consoleUrl ?? process.env.ADMIN_CONSOLE_URL ?? "https://admin.adonisagent.ie";
  await requestPlatformUserReset(email, consoleUrl);
  return NextResponse.json({ ok: true });
}
