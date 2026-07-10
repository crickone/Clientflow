import "server-only";

import { registerTemplate } from "@/lib/cms/templates";
import { getBlockValue } from "@/lib/cms/blocks";
import { sanitizeHtmlKeepStyles } from "@/lib/cms/html";

/**
 * Renova migration templates (controlled-HTML bridge).
 *
 * - "renova-page": static render with scripts stripped (safe for any imported
 *   HTML; styles kept, no JS).
 * - "renova-live": renders the page's first-party HTML verbatim INCLUDING its
 *   own <style> and <script> (GSAP / Lenis / ScrollTrigger + the inline init).
 *   Because the page is server-rendered, those scripts are in the initial
 *   document and the browser executes them on load — so the helix video, scroll
 *   animations, page transitions and nav all work. Use ONLY for trusted
 *   first-party pages (admin-edited); never for untrusted input.
 */

registerTemplate({
  id: "renova-page",
  label: "Renova page (static HTML)",
  blocks: [{ name: "body", kind: "html", label: "Page HTML", fallback: "" }],
  Component: ({ ctx }) => {
    const row = getBlockValue(ctx.db, ctx.siteId, ctx.pageId, "body");
    return <div dangerouslySetInnerHTML={{ __html: sanitizeHtmlKeepStyles(row?.value ?? "") }} />;
  },
});

registerTemplate({
  id: "renova-live",
  label: "Renova page (live — animations)",
  blocks: [{ name: "body", kind: "html", label: "Page HTML (with scripts)", fallback: "" }],
  Component: ({ ctx }) => {
    const row = getBlockValue(ctx.db, ctx.siteId, ctx.pageId, "body");
    // Verbatim render: first-party HTML with its own styles + scripts. Server-
    // rendered, so the browser runs the scripts on load.
    return <div dangerouslySetInnerHTML={{ __html: row?.value ?? "" }} />;
  },
});

export {};
