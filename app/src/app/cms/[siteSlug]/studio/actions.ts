"use server";

import { revalidatePath } from "next/cache";

import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { getPageByPath } from "@/lib/cms/pages";
import { getBlock, upsertBlock } from "@/lib/cms/blocks";
import { setDraftContent, clearDraft, publishDraft } from "@/lib/cms/pageDraft";

type Result = { ok: boolean; error?: string };

/**
 * Save in-place edits from the OLD Studio canvas (StudioShell.tsx). This
 * writes straight to the live 'body' block and is being replaced by the
 * draft actions below; kept only because StudioShell.tsx still calls it with
 * a whole sanitised-body capture (head styles included, scripts stripped) —
 * a different shape than the content-zone-only contract the new draft
 * actions expect, so routing it into setDraftContent here would duplicate
 * the head zone on publish. Repointing StudioShell.tsx at the new canvas and
 * the draft actions is Task 3's job; remove this once nothing calls it.
 */
export async function savePageHtmlAction(
  siteSlug: string,
  path: string,
  contentHtml: string,
): Promise<Result> {
  await requireAdminPage();
  const site = await getSiteBySlug(siteSlug);
  if (!site) return { ok: false, error: "Unknown site." };
  const page = getPageByPath(site.id, path);
  if (!page) return { ok: false, error: `No page at ${path}.` };

  const block = getBlock(site.id, page.id, "body");
  const stored = block?.value ?? "";
  const scripts = (stored.match(/<script\b[\s\S]*?<\/script>/gi) || []).join("\n");

  const merged = scripts ? `${contentHtml}\n${scripts}` : contentHtml;
  upsertBlock({
    siteId: site.id,
    pageId: page.id,
    name: "body",
    kind: "html",
    value: merged,
  });

  revalidatePath(`/site/${siteSlug}${path === "/" ? "" : path}`);
  return { ok: true };
}

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
