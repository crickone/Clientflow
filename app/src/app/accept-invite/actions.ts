"use server";

import { acceptInvite } from "@/lib/invites";

export type AcceptResult = { ok: true } | { ok: false; error: string };

export async function acceptInviteAction(
  token: string,
  input: { name: string; password: string },
): Promise<AcceptResult> {
  return acceptInvite(token, input);
}
