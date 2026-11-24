"use server";

import { getCurrentMembership, requireUser } from "@/lib/auth";
import { isAdminOnlyKind, isNotificationKind } from "@/lib/notifications/model";
import { setPref } from "@/lib/notifications/store";

/** Save one kind's two switches for the signed-in person. */
export async function setNotificationPrefAction(kind: string, pref: { inApp: boolean; push: boolean }): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const m = getCurrentMembership();
  if (!m) return { ok: false, error: "Please sign in again." };
  if (!isNotificationKind(kind)) return { ok: false, error: "Unknown notification." };
  if (isAdminOnlyKind(kind) && m.role !== "admin") return { ok: false, error: "Only admins get sales." };
  setPref(m.user.id, kind, { inApp: pref?.inApp === true, push: pref?.push === true });
  return { ok: true };
}
