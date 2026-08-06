import { NextResponse, type NextRequest } from "next/server";

import { checkServiceKey, platformLogin } from "@/lib/platform/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!checkServiceKey(req)) return new Response("Not found", { status: 404 });
  const rl = rateLimit(`platform-login:${clientIp(req)}`, 10, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  const body = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
  if (!body?.email || !body?.password) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  const res = platformLogin(body.email, body.password);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 401 });
  return NextResponse.json(res);
}
