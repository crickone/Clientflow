"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";

/**
 * Server actions for the People tab. Each one carries a single operation to
 * `/tenants/:id/people`, which is where the real rules and the audit row
 * live; these only translate a refusal into something the page can show.
 */
export type PeopleActionResult = { ok: true; note?: string; link?: string } | { ok: false; error: string };

export type PeopleOp =
  | { op: "invite"; email: string; role: "admin" | "staff"; name?: string }
  | { op: "resend-invite"; email: string }
  | { op: "cancel-invite"; inviteId: number }
  | { op: "set-role"; userId: number; role: "admin" | "staff" }
  | { op: "set-access"; userId: number; active: boolean }
  | { op: "revoke-sessions"; userId: number }
  | { op: "reset-password"; userId: number }
  | { op: "transfer-ownership"; userId: number };

export async function peopleAction(tenantId: number, body: PeopleOp): Promise<PeopleActionResult> {
  try {
    const res = await api<{ ok: true; note?: string; link?: string }>(`/tenants/${tenantId}/people`, {
      method: "POST",
      body,
    });
    revalidatePath(`/gyms/${tenantId}/people`);
    revalidatePath(`/gyms/${tenantId}`);
    return { ok: true, note: res.note, link: res.link };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "That did not work." };
  }
}

/** The invite form posts a FormData; everything else posts a typed op. */
export async function inviteAction(tenantId: number, formData: FormData): Promise<PeopleActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? "staff");
  const name = String(formData.get("name") ?? "").trim();
  if (!email) return { ok: false, error: "Enter an email address." };
  const role = roleRaw === "admin" ? "admin" : "staff";
  return peopleAction(tenantId, { op: "invite", email, role, ...(name ? { name } : {}) });
}
