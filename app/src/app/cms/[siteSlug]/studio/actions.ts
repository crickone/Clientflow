"use server";

import { revalidatePath } from "next/cache";

import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { getPageByPath } from "@/lib/cms/pages";
import { setDraftContent, clearDraft, publishDraft } from "@/lib/cms/pageDraft";

type Result = { ok: boolean; error?: string };

/** Resolve site + page for the caller's own tenant, or an error result. */
async function resolve(siteSlug: string, path: string) {
  await requireAdminPage();
  const site = await getSiteBySlug(siteSlug);
  if (!site) return { error: "Unknown site." as const };
  const page = getPageByPath(site.id, path);
  if (!page) return { error: `No page at ${path}.` as const };
  return { site, page };
}

/**
 * Autosave from the canvas. Writes ONLY the content zone to the page's draft
 * block — the live page is untouched until publishDraftAction runs.
 */
export async function saveDraftAction(
  siteSlug: string,
  path: string,
  content: string,
): Promise<Result> {
  const r = await resolve(siteSlug, path);
  if ("error" in r) return { ok: false, error: r.error };
  setDraftContent(r.site.id, r.page.id, content);
  return { ok: true };
}

/** Push the draft onto the live page (head + draft content + tail) and consume it. */
export async function publishDraftAction(
  siteSlug: string,
  path: string,
): Promise<Result> {
  const r = await resolve(siteSlug, path);
  if ("error" in r) return { ok: false, error: r.error };
  if (!publishDraft(r.site.id, r.page.id)) {
    return { ok: false, error: "Nothing to publish." };
  }
  revalidatePath(`/site/${siteSlug}${path === "/" ? "" : path}`);
  return { ok: true };
}

/** Throw the draft away; the canvas reloads from the live body. */
export async function discardDraftAction(
  siteSlug: string,
  path: string,
): Promise<Result> {
  const r = await resolve(siteSlug, path);
  if ("error" in r) return { ok: false, error: r.error };
  clearDraft(r.site.id, r.page.id);
  return { ok: true };
}
