import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

import { api, ApiError, ADMIN_COOKIE } from "@/lib/api";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
  if (!body?.email || !body?.password) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  try {
    const res = await api<{ token: string }>("/auth/login", { method: "POST", body, session: null });
    cookies().set(ADMIN_COOKIE, res.token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 7 * 24 * 60 * 60,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : "Sign-in failed";
    const status = err instanceof ApiError ? err.status : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE() {
  try { await api("/auth/logout", { method: "POST" }); } catch { /* session may be gone */ }
  cookies().delete(ADMIN_COOKIE);
  return NextResponse.json({ ok: true });
}
