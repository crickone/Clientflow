import "server-only";

import type { TenantDb } from "@/lib/db/tenant";
import type { BlockKind } from "@/lib/db/schema";
import { getBlockValue } from "@/lib/cms/blocks";
import { renderMarkdown } from "@/lib/cms/markdown";
import { sanitizeHtml } from "@/lib/cms/html";

export interface RenderCtx {
  db: TenantDb;
  siteId: number;
  siteSlug: string;
  pageId: number;
}

/** Public rendering of a single editable content slot. Server component. */
export function Block({
  ctx,
  name,
  kind = "richtext",
  fallback = "",
  className,
}: {
  ctx: RenderCtx;
  name: string;
  kind?: BlockKind;
  fallback?: string;
  className?: string;
}) {
  const row = getBlockValue(ctx.db, ctx.siteId, ctx.pageId, name);
  const k = row?.kind ?? kind;

  if (k === "image") {
    const id = row?.mediaAssetId;
    const src = id ? `/site-media/${ctx.siteSlug}/${id}` : fallback;
    if (!src) return null;
    return <img src={src} alt="" className={className} />;
  }

  const value = row?.value ?? fallback;
  if (!value) return null;

  if (k === "text") {
    return <span className={className}>{value}</span>;
  }
  const html = k === "html" ? sanitizeHtml(value) : renderMarkdown(value);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
