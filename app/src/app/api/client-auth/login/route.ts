import { NextResponse } from "next/server";

import { createClientSession, loginClient } from "@/lib/clientAuth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
  }
  const info = loginClient(email, password);
  if (!info) {
    return NextResponse.json({ ok: false, error: "Incorrect email or password." }, { status: 401 });
  }
  await createClientSession(info);
  return NextResponse.json({ ok: true });
}
