"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUserPage, requireAdminPage } from "@/lib/auth";
import { createRequest } from "@/lib/cms/requests";
import { createSite, normalizeSlug } from "@/lib/cms/sites";

export type SiteState = { ok: boolean; error?: string };

/** Admin: directly provision a new client site (you, the agency). */
export async function addSiteAction(
  _prev: SiteState,
  formData: FormData,
): Promise<SiteState> {
  await requireAdminPage();
  const name = String(formData.get("name") ?? "").trim();
  const slug = normalizeSlug(String(formData.get("slug") ?? "") || name);
  const primaryHost = String(formData.get("primaryHost") ?? "").trim();
  if (!name) return { ok: false, error: "Site name is required." };
  if (!slug) return { ok: false, error: "A valid slug is required." };
  try {
    await createSite({ name, slug, primaryHost: primaryHost || null });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create site." };
  }
  revalidatePath("/cms");
  redirect(`/cms/${slug}`);
}

export type RequestState = { ok: boolean; error?: string };

export async function createRequestAction(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  await requireUserPage();
  const businessName = String(formData.get("businessName") ?? "").trim();
  if (!businessName) return { ok: false, error: "Business name is required." };

  createRequest({
    businessName,
    contactName: String(formData.get("contactName") ?? "").trim() || null,
    contactEmail: String(formData.get("contactEmail") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });

  revalidatePath("/cms/requests");
  revalidatePath("/cms");
  redirect("/cms?requested=1");
}
