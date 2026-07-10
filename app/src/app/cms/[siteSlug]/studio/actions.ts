"use server";

import { revalidatePath } from "next/cache";

import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { getPageByPath } from "@/lib/cms/pages";
import { getBlock, upsertBlock } from "@/lib/cms/blocks";

/**
 * Save in-place edits from the Studio. The editor sends the page's content HTML
 * (scripts stripped). We merge it back with the page's ORIGINAL <script> tags so
 * the animations keep working, then store it on the 'body' block.
 */
export async function savePageHtmlAction(
  siteSlug: string,
  path: string,
  contentHtml: string,
): Promise<{ ok: boolean; error?: string }> {
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
