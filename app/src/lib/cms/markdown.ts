import { marked } from "marked";

import { sanitizeHtml } from "@/lib/cms/html";

/**
 * Render markdown (blog posts, richtext blocks) to HTML. Synchronous. marked
 * passes raw HTML through, and posts are written by any staff member or
 * drafted by the model from outside sources, so the result goes through the
 * same rich-text allow-list as a kind:'html' block: no scripts, no handlers.
 */
export function renderMarkdown(md: string | null | undefined): string {
  if (!md) return "";
  return sanitizeHtml(marked.parse(md, { async: false, gfm: true, breaks: false }) as string);
}

/** Plain-text excerpt from markdown, for meta descriptions / cards. */
export function excerptFromMarkdown(md: string | null | undefined, max = 160): string {
  if (!md) return "";
  const text = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\-]+/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
