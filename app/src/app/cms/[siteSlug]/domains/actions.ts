"use server";

import { revalidatePath } from "next/cache";

import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { addDomain, removeDomain, makePrimary, verifyDomain, listDomains, normalizeHostInput } from "@/lib/cms/domains";
import { deleteCustomHostname, ensureCustomHostname } from "@/lib/cms/customHostnames";

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
  // Register it with Cloudflare straight away, so the certificate is issued
  // the moment the client's DNS points here. A failure is not a failed add:
  // the Domains page shows the reason and "Check again" retries.
  const added = listDomains(tenantId, site.id).find((d) => d.host === normalizeHostInput(host));
  if (added) await ensureCustomHostname(added.host);
  revalidatePath(`/cms/${siteSlug}/domains`);
  return { ok: true };
}

export async function removeDomainAction(siteSlug: string, id: number) {
  const { tenantId, site } = await ctx(siteSlug);
  const row = listDomains(tenantId, site.id).find((d) => d.id === id);
  removeDomain(tenantId, site.id, id);
  if (row) await deleteCustomHostname(row.host);
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
  const row = listDomains(tenantId, site.id).find((d) => d.id === id);
  if (row) await ensureCustomHostname(row.host);
  revalidatePath(`/cms/${siteSlug}/domains`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Re-check a domain: register it with Cloudflare if it is not yet, and refresh its status. */
export async function recheckDomainAction(siteSlug: string, id: number): Promise<DomainState> {
  const { tenantId, site } = await ctx(siteSlug);
  const row = listDomains(tenantId, site.id).find((d) => d.id === id);
  if (!row) return { ok: false, error: "Unknown domain." };
  const res = await ensureCustomHostname(row.host);
  revalidatePath(`/cms/${siteSlug}/domains`);
  return res.error ? { ok: false, error: res.error } : { ok: true };
}
