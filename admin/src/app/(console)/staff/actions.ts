"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";
import type { PlatformRole } from "@/lib/types";

/**
 * Change a staff member's console role. Owner-gated in the API, which is
 * what actually protects it; this action only carries the request and turns
 * a refusal into a message on the page.
 */
export async function setStaffRoleAction(userId: number, formData: FormData): Promise<void> {
  const role = String(formData.get("role") ?? "");
  if (role !== "owner" && role !== "manager") {
    redirect(`/staff?error=${encodeURIComponent("Pick a role.")}`);
  }
  try {
    await api("/staff", { method: "PATCH", body: { userId, role: role as PlatformRole } });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Could not change that role.";
    redirect(`/staff?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/staff");
  redirect("/staff?saved=1");
}
