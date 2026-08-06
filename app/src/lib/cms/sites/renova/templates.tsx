import "server-only";

import { registerTemplate } from "@/lib/cms/templates";
import { getBlockValue } from "@/lib/cms/blocks";
import { sanitizeHtmlKeepStyles } from "@/lib/cms/html";

/**
 * Bespoke-site templates (controlled-HTML bridge) — shared by every imported
 * client site, not tied to any one client.
 *
 * - "clientflow-page": static render with scripts stripped (safe for any imported
 *   HTML; styles kept, no JS).
 * - "clientflow-live": renders the page's first-party HTML verbatim INCLUDING its
 *   own <style> and <script> (GSAP / Lenis / ScrollTrigger + the inline init).
 *   Because the page is server-rendered, those scripts are in the initial
 *   document and the browser executes them on load — so the helix video, scroll
 *   animations, page transitions and nav all work. Use ONLY for trusted
 *   first-party pages (admin-edited); never for untrusted input.
 */

registerTemplate({
  id: "clientflow-page",
  label: "Imported page (static HTML)",
  blocks: [{ name: "body", kind: "html", label: "Page HTML", fallback: "" }],
  Component: ({ ctx }) => {
    const row = getBlockValue(ctx.db, ctx.siteId, ctx.pageId, "body");
    return <div dangerouslySetInnerHTML={{ __html: sanitizeHtmlKeepStyles(row?.value ?? "") }} />;
  },
});

registerTemplate({
  id: "clientflow-live",
  // Shared by every bespoke imported site — keep the label brand-neutral so it
  // never shows a client's name under another client's pages.
  label: "Bespoke site (live — animations)",
  blocks: [{ name: "body", kind: "html", label: "Page HTML (with scripts)", fallback: "" }],
  Component: ({ ctx }) => {
    const row = getBlockValue(ctx.db, ctx.siteId, ctx.pageId, "body");
    // Verbatim render: first-party HTML with its own styles + scripts. Server-
    // rendered, so the browser runs the scripts on load.
    return <div dangerouslySetInnerHTML={{ __html: row?.value ?? "" }} />;
  },
});

export {};
