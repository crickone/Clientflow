"use server";

import { revalidatePath } from "next/cache";

import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { updateMediaAlt, deleteMediaAsset } from "@/lib/cms/media";

async function siteOrThrow(siteSlug: string) {
  await requireAdminPage();
  const site = await getSiteBySlug(siteSlug);
  if (!site) throw new Error(`Unknown site: ${siteSlug}`);
  return site;
}

export async function updateAltAction(siteSlug: string, id: number, alt: string) {
  const site = await siteOrThrow(siteSlug);
  updateMediaAlt(site.id, id, alt);
  revalidatePath(`/cms/${siteSlug}/media`);
}

export async function deleteMediaAction(siteSlug: string, id: number) {
  const site = await siteOrThrow(siteSlug);
  deleteMediaAsset(site.id, id);
  revalidatePath(`/cms/${siteSlug}/media`);
}
