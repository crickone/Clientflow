"use server";

import { revalidatePath } from "next/cache";

import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { addDomain, removeDomain, makePrimary, verifyDomain } from "@/lib/cms/domains";

async function ctx(siteSlug: string) {
  await requireAdminPage();
  const m = getCurrentMembership();
  if (!m) throw new Error("No tenant.");
  const site = await getSiteBySlug(siteSlug);
  if (!site) throw new Error(`Unknown site: ${siteSlug}`);
  return { tenantId: m.tenant.id, site };
}

export type DomainState = { ok: boolean; error?: string };

export async function addDomainAction(
  siteSlug: string,
  _prev: DomainState,
  formData: FormData,
): Promise<DomainState> {
  const { tenantId, site } = await ctx(siteSlug);
  const host = String(formData.get("host") ?? "");
  const isPrimary = formData.get("isPrimary") === "on";
  try {
    addDomain(tenantId, site.id, host, isPrimary);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
  revalidatePath(`/cms/${siteSlug}/domains`);
  return { ok: true };
}

export async function removeDomainAction(siteSlug: string, id: number) {
  const { tenantId, site } = await ctx(siteSlug);
  removeDomain(tenantId, site.id, id);
  revalidatePath(`/cms/${siteSlug}/domains`);
}

export async function makePrimaryAction(siteSlug: string, id: number) {
  const { tenantId, site } = await ctx(siteSlug);
  makePrimary(tenantId, site.id, id);
  revalidatePath(`/cms/${siteSlug}/domains`);
}

export async function verifyDomainAction(
  siteSlug: string,
  id: number,
): Promise<DomainState> {
  const { tenantId, site } = await ctx(siteSlug);
  const res = await verifyDomain(tenantId, site.id, id);
  revalidatePath(`/cms/${siteSlug}/domains`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
