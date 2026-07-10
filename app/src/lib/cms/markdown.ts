import { marked } from "marked";

/**
 * Render trusted markdown (Claude-generated blog content) to HTML. Synchronous.
 * For user-entered HTML content blocks we sanitize separately (see Block).
 */
export function renderMarkdown(md: string | null | undefined): string {
  if (!md) return "";
  return marked.parse(md, { async: false, gfm: true, breaks: false }) as string;
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
