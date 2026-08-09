import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { authDb } from "@/lib/db/control";
import { authSessions, users } from "@/lib/db/schema";
import { getSessionUser, hashPassword, verifyPassword, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 401 },
    );
  }

  await authDb
    .update(users)
    .set({
      passwordHash: hashPassword(parsed.data.newPassword),
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // Revoke every OTHER session for this user so a leaked/stale session (another
  // device, an old browser tab) can't keep using the old credential's context
  // after a password change. Keep the current session (the one that just
  // authenticated this request) so the user isn't logged out by their own
  // change. If for some reason the current token can't be read, fail safe by
  // revoking all of them — worst case the user re-logs in.
  const currentToken = cookies().get(SESSION_COOKIE)?.value;
  await authDb
    .delete(authSessions)
    .where(
      currentToken
        ? and(eq(authSessions.userId, user.id), ne(authSessions.id, currentToken))
        : eq(authSessions.userId, user.id),
    );

  return NextResponse.json({ ok: true });
}
