"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUserPage, requireAdminPage } from "@/lib/auth";
import { createRequest } from "@/lib/cms/requests";
import {
  createSite,
  deleteSiteCascade,
  getSiteBySlug,
  normalizeSlug,
  summariseSiteDeletion,
  type SiteDeletionSummary,
} from "@/lib/cms/sites";
import { canDeleteSite } from "@/lib/cms/siteDeletion";

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

// ============ Delete site ============

export type SiteDeletionSummaryState =
  | { ok: true; summary: SiteDeletionSummary }
  | { ok: false; error: string };

/** Admin: what deleting this site would remove, for the confirm modal. */
export async function getSiteDeletionSummaryAction(
  siteSlug: string,
): Promise<SiteDeletionSummaryState> {
  await requireAdminPage();
  const site = await getSiteBySlug(siteSlug);
  if (!site) return { ok: false, error: "Unknown site." };
  const summary = await summariseSiteDeletion(site.id);
  return { ok: true, summary };
}

/**
 * Admin: permanently delete a site and everything belonging to it. Refuses
 * unless `confirmSlug` exactly matches the site's own slug (typed
 * confirmation, enforced here — not just in the UI) and unless every domain
 * still mapped to the site is unverified — deleting a site a live, verified
 * domain still points at would take a client's website down without warning.
 */
export async function deleteSiteAction(
  siteSlug: string,
  confirmSlug: string,
): Promise<SiteState> {
  await requireAdminPage();
  const site = await getSiteBySlug(siteSlug);
  if (!site) return { ok: false, error: "Unknown site." };

  const summary = await summariseSiteDeletion(site.id);
  const verifiedDomains = summary.domains.filter((d) => d.verified).length;
  const decision = canDeleteSite({ confirmSlug, siteSlug: site.slug, verifiedDomains });
  if (!decision.ok) return { ok: false, error: decision.reason };

  await deleteSiteCascade(site.id);
  revalidatePath("/cms");
  return { ok: true };
}
