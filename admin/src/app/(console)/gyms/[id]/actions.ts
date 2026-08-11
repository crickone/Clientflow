"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";

export type TenantActionName =
  | "suspend"
  | "reactivate"
  | "exempt"
  | "unexempt"
  | "charge-now"
  | "mark-paid"
  | "waive"
  | "comp"
  | "venue-type"
  | "grant-credits"
  | "suspend-marketing"
  | "resume-marketing"
  | "offboard";

/**
 * Single funnel for every per-tenant billing action. Posts to the platform API
 * (which returns `{ok:true}` or a 400 `{ok:false,error}`), revalidates the
 * affected routes, and hands the client a `{ok,error?}` it can surface inline.
 * Never throws — a failed request becomes `{ok:false}`.
 */
export async function tenantAction(
  id: number,
  action: TenantActionName,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api(`/tenants/${id}/${action}`, { method: "POST", body: body ?? {} });
    revalidatePath(`/gyms/${id}`);
    revalidatePath("/gyms");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Action failed" };
  }
}

/**
 * "Open business": a dedicated action (not `tenantAction`) because success
 * hands back a one-time login URL rather than a bare `{ok}` — the platform
 * API mints the token server-side (guarded, service key + platform-admin
 * session) and this just relays it. The CLIENT is responsible for opening
 * that URL in a new tab; this action never redirects the console itself.
 */
export async function openTenant(
  id: number,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const res = await api<{ ok: true; url: string }>(`/tenants/${id}/open`, {
      method: "POST",
      body: {},
    });
    revalidatePath(`/gyms/${id}`); // the "opened_by_admin" event now shows in Events
    revalidatePath("/gyms");
    revalidatePath("/");
    return { ok: true, url: res.url };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Action failed" };
  }
}

/**
 * Grant email-marketing credits to a tenant — the console's first free-
 * numeric-input action (every other tenant action is a `ConfirmButton` with
 * fixed, pre-bound params). Bound as `grantCreditsAction.bind(null, tenant.id)`
 * so it drops straight into a `<form action={…}>` (the FormData becomes the
 * action's final argument), same idiom as settings/actions.ts's
 * `saveSettings`: parse the €-amount, convert to cents, call the tenant
 * action funnel (`POST /tenants/:id/grant-credits`), and surface feedback via
 * `?error=…` / `?granted=1` on the gym-detail page's own searchParams rather
 * than inline state (this isn't a client component).
 */
export async function grantCreditsAction(id: number, formData: FormData): Promise<void> {
  const eurosRaw = String(formData.get("euros") ?? "");
  const euros = parseFloat(eurosRaw);

  if (!Number.isFinite(euros) || euros <= 0) {
    redirect(`/gyms/${id}?error=${encodeURIComponent("Enter a valid, positive credit amount.")}`);
  }

  const cents = Math.round(euros * 100);
  const r = await tenantAction(id, "grant-credits", { cents });
  if (!r.ok) {
    redirect(`/gyms/${id}?error=${encodeURIComponent(r.error ?? "Failed to grant credits.")}`);
  }

  redirect(`/gyms/${id}?granted=1`);
}
