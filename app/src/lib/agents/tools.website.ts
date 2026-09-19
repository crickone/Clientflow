import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { listPages, getPageByPath } from "@/lib/cms/pages";
import { getBlock } from "@/lib/cms/blocks";
import { splitPageBody, studioEditability } from "@/lib/cms/pageBody";
import { setDraftContent, publishDraft } from "@/lib/cms/pageDraft";
import fs from "node:fs";

import {
  listLibraryAssets,
  getLibraryAsset,
  canManageLibraryAsset,
  libraryUrl,
  addLibraryAsset,
} from "@/lib/cms/library";
import {
  listLibraryAssets as listStudioAssets,
  getLibraryAsset as getStudioAsset,
  libraryFilePath as studioFilePath,
} from "@/lib/image/library";
import { resolveSite } from "@/lib/agents/tools.marketing";
import type { ToolContext, ToolResult } from "@/lib/agents/toolKit";

/**
 * Editing a client's own website from the chat.
 *
 * The operator asked Adonis to swap an image on the website and was told it
 * had no way to do that, which was true: nothing in the tool set touched a
 * page, an image or the media library. These are the tools that close it.
 *
 * DELIBERATELY SURGICAL, NOT GENERATIVE. There is no tool here that takes
 * HTML from the model, and that is the central design decision:
 *
 *  - the `clientflow-live` template renders a page's stored HTML VERBATIM,
 *    scripts included, on the client's own domain and the same origin as the
 *    admin app. Model-authored markup landing there is a cross-site
 *    scripting hole approved by an operator who read a one-line summary, not
 *    the markup;
 *  - a bespoke page's layout is a single hand-built document. One confident
 *    rewrite destroys a design nobody can reconstruct from the chat.
 *
 * So the writes are a literal text substitution and an image swap. Neither
 * introduces a tag, an attribute or a URL the model composed. What they
 * cover is what people actually ask for: fix that wording, use this photo
 * instead.
 *
 * Everything goes through the paths the visual editor already uses — write
 * the CONTENT zone to a draft, then publish it — so the stylesheet and the
 * scripts around it are carried untouched, the too-small-draft gate applies,
 * and the publish is stamped with the operator's id so the deploy-time site
 * sync leaves the page alone afterwards.
 */

/**
 * Content Studio's photo library, made usable on the website.
 *
 * The business keeps its photographs in Content Studio — 77 of them, in
 * Inspire's case — while the CMS has its own, separate library that was
 * empty. Asking the client to upload everything a second time to put a
 * picture on their own site is the wrong answer, so a Studio photo is
 * COPIED into the CMS library the first time it is used.
 *
 * Copied, rather than served directly, on purpose. Studio images are behind
 * a login (`guard("user")` on their file route) because they are working
 * material, not published assets; exposing that route to the public would
 * make the whole library enumerable by id, including photographs the client
 * has not chosen to publish. Copying keeps the public surface to exactly the
 * images actually placed on a page, and reuses `/library-media/<id>`, which
 * is already public and already scoped.
 *
 * The copy is made once: a second use of the same photo finds the previous
 * copy by its marker and reuses it, so a picture used on three pages is one
 * file and one row, not three.
 */
const STUDIO_COPY_PREFIX = "studio-";

const studioCopyName = (studioId: number, name: string) => `${STUDIO_COPY_PREFIX}${studioId}-${name}`;

async function cmsAssetForStudioPhoto(
  tenantId: number,
  studioId: number,
): Promise<{ error: string } | { asset: { id: number; originalName: string } }> {
  const studio = getStudioAsset(studioId);
  if (!studio) return { error: `No image with id ${studioId} in Content Studio.` };
  if (studio.kind !== "image") return { error: `"${studio.originalName}" is a video, not an image.` };

  const marker = studioCopyName(studioId, studio.originalName);
  const already = listLibraryAssets(tenantId).find((a) => a.originalName === marker);
  if (already) return { asset: already };

  const file = studioFilePath(studio.filename);
  if (!fs.existsSync(file)) return { error: `The file for "${studio.originalName}" is missing from the library.` };

  const copied = await addLibraryAsset({
    originalName: marker,
    mimeType: studio.mimeType,
    bytes: fs.readFileSync(file),
    width: studio.width,
    height: studio.height,
    alt: studio.label ?? null,
    tenantId,
  });
  return { asset: copied };
}

/** A page's body split into what can be edited and what must be carried untouched. */
function readPage(ctx: ToolContext, siteId: number, path: string) {
  const page = getPageByPath(siteId, path);
  if (!page) return { error: `No page at ${path}.` };

  const body = getBlock(siteId, page.id, "body")?.value ?? "";
  const zones = splitPageBody(body);
  const editable = studioEditability(zones);
  if (!editable.ok) return { error: `${path} cannot be edited: ${editable.reason}` };

  return { page, zones };
}

/** Every <img> in a chunk of markup, in document order. */
function imagesIn(html: string): Array<{ src: string; alt: string }> {
  const out: Array<{ src: string; alt: string }> = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = (/\bsrc="([^"]*)"/i.exec(tag) || [, ""])[1];
    const alt = (/\balt="([^"]*)"/i.exec(tag) || [, ""])[1];
    if (src) out.push({ src, alt });
  }
  return out;
}

/**
 * The words on a page, with the markup taken out.
 *
 * The model needs to see the copy to quote a phrase back for replacement,
 * and showing it 17,000 characters of hand-written HTML wastes the context
 * and invites it to try rewriting the markup. Tags out, text in order.
 */
function visibleText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

// ─── Tool schemas ────────────────────────────────────────────────────────────

export const WEBSITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_website_pages",
    description:
      "List the pages of the business's website, with their paths and whether each one can be edited from here. Use before any website edit so you name a page that exists.",
    input_schema: {
      type: "object",
      properties: {
        siteId: { type: "integer", description: "Optional: which website, when the business has more than one." },
      },
    },
  },
  {
    name: "read_website_page",
    description:
      "Read one page of the website: its wording with the markup stripped out, and every image on it with its current source and alt text. Use this to find the exact phrase or image the operator means before calling an edit tool.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The page's path, e.g. / or /about (from list_website_pages)." },
        siteId: { type: "integer" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_website_images",
    description:
      "List every image the business can put on its website: the ones already used on the site, and its whole Content Studio photo library. Each has an id — pass it as imageId to replace_website_image. Use this to offer the operator real choices rather than guessing what photographs exist.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "edit_website_text",
    description:
      "Change wording on a website page by replacing an exact piece of text with new text. `find` must appear EXACTLY ONCE on the page and must be copied verbatim from read_website_page — if it appears twice or not at all the edit is refused, so quote enough surrounding words to be unique. This cannot add or change any markup: it swaps text for text. Show the operator the before and after and only call this once they approve it.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The page's path, e.g. / or /about." },
        find: { type: "string", description: "The exact existing text to replace, copied from read_website_page." },
        replace: { type: "string", description: "The new text. Plain text only — no HTML." },
        siteId: { type: "integer" },
      },
      required: ["path", "find", "replace"],
    },
  },
  {
    name: "replace_website_image",
    description:
      "Swap one image on a website page for a different image from the media library. Identify the image by its current src (from read_website_page) and give the library image's id (from list_website_images). The new image keeps the old one's position, size and styling — only the picture changes.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The page's path, e.g. / or /about." },
        currentSrc: { type: "string", description: "The src of the image being replaced, exactly as read_website_page reported it." },
        imageId: { type: "integer", description: "The image's id, from list_website_images." },
        source: {
          type: "string",
          enum: ["website", "content-studio"],
          description: "Which library the id came from — copy the `source` list_website_images reported for that image. The two libraries number their images separately, so this is what tells them apart.",
        },
        alt: { type: "string", description: "Optional: new alt text describing the new image." },
        siteId: { type: "integer" },
      },
      required: ["path", "currentSrc", "imageId", "source"],
    },
  },
];

// ─── Executors ───────────────────────────────────────────────────────────────

/** READ — the site's pages, and which are editable. */
export function listWebsitePagesTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const site = resolveSite(ctx, input.siteId);
  if ("error" in site) return site.error;

  const pages = listPages(site.id).map((p) => {
    const body = getBlock(site.id, p.id, "body")?.value ?? "";
    const editable = studioEditability(splitPageBody(body));
    return {
      path: p.path,
      title: p.title,
      status: p.status,
      editable: editable.ok,
      ...(editable.ok ? {} : { whyNot: editable.reason }),
    };
  });

  return {
    text: JSON.stringify({ siteId: site.id, siteName: site.name, count: pages.length, pages }),
  };
}

/** READ — one page's wording and images. */
export function readWebsitePageTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const path = String(input.path || "").trim();
  if (!path) return { text: JSON.stringify({ error: "path is required." }) };

  const site = resolveSite(ctx, input.siteId);
  if ("error" in site) return site.error;

  const read = readPage(ctx, site.id, path);
  if ("error" in read) return { text: JSON.stringify({ error: read.error }) };

  return {
    text: JSON.stringify({
      path,
      title: read.page.title,
      status: read.page.status,
      text: visibleText(read.zones.content),
      images: imagesIn(read.zones.content),
      note: "Quote `text` verbatim when calling edit_website_text, and an image's `src` verbatim when calling replace_website_image.",
    }),
  };
}

/**
 * READ — every image the business could put on its site.
 *
 * Both libraries, presented as one list, because the distinction is ours and
 * not the operator's: they have photographs, and they want one on a page.
 * A Content Studio photo is copied into the website's own library the first
 * time it is used (see cmsAssetForStudioPhoto), which is why its id is
 * offered here as an ordinary choice.
 */
export function listWebsiteImagesTool(ctx: ToolContext): ToolResult {
  const onSite = listLibraryAssets(ctx.tenantId)
    // The copies made from Studio photos are the same pictures under a
    // marker name; listing both halves would show every one of them twice.
    .filter((a) => !a.originalName.startsWith(STUDIO_COPY_PREFIX))
    .map((a) => ({ imageId: a.id, name: a.originalName, alt: a.alt ?? "", source: "website" as const }));

  const inStudio = listStudioAssets()
    .filter((a) => a.kind === "image")
    .map((a) => ({
      imageId: a.id,
      name: a.originalName,
      alt: a.label ?? "",
      source: "content-studio" as const,
    }));

  return {
    text: JSON.stringify({
      count: onSite.length + inStudio.length,
      images: [...onSite, ...inStudio].slice(0, 80),
      note: "Pass imageId to replace_website_image, together with the image's `source`. A Content Studio photo is copied to the website automatically the first time it is used.",
    }),
  };
}

/**
 * Shared write path: change the content zone, then publish it the way the
 * visual editor does. Keeping both writes here means neither can drift into
 * touching the head or tail zones, and both inherit the publish gate.
 */
function applyContentChange(
  ctx: ToolContext,
  siteId: number,
  pageId: number,
  nextContent: string,
): { error: string } | { ok: true } {
  setDraftContent(siteId, pageId, nextContent);
  // ctx.userId stamps content_blocks.updated_by, which is what stops the
  // deploy-time site sync replacing this page from the repo afterwards.
  const outcome = publishDraft(siteId, pageId, ctx.userId ?? null);
  if (outcome.ok) return { ok: true };
  if (outcome.reason === "no-draft") return { error: "Nothing changed on the page." };
  // The gate exists to catch an edit that would wipe most of a page. Report
  // it as the refusal it is rather than as success.
  return {
    error:
      outcome.reason === "empty"
        ? "Refused: that would leave the page empty."
        : "Refused: that would remove most of the page's content.",
  };
}

/** WRITE — replace an exact piece of text. Approve-gated. */
export function editWebsiteTextTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const path = String(input.path || "").trim();
  const find = String(input.find ?? "");
  const replace = String(input.replace ?? "");
  if (!path) return { text: JSON.stringify({ error: "path is required." }) };
  if (!find.trim()) return { text: JSON.stringify({ error: "find is required." }) };
  if (/[<>]/.test(replace)) {
    return {
      text: JSON.stringify({
        error: "replace must be plain text — it cannot contain < or >. Use the CMS editor for markup changes.",
      }),
    };
  }

  const site = resolveSite(ctx, input.siteId);
  if ("error" in site) return site.error;

  const read = readPage(ctx, site.id, path);
  if ("error" in read) return { text: JSON.stringify({ error: read.error }) };

  const occurrences = read.zones.content.split(find).length - 1;
  if (occurrences === 0) {
    return {
      text: JSON.stringify({
        error: `"${find}" does not appear on ${path}. Call read_website_page and copy the wording exactly — it may be split differently than it looks on screen.`,
      }),
    };
  }
  if (occurrences > 1) {
    return {
      text: JSON.stringify({
        error: `"${find}" appears ${occurrences} times on ${path}, so there is no way to tell which one you mean. Include more of the surrounding sentence.`,
      }),
    };
  }

  const applied = applyContentChange(ctx, site.id, read.page.id, read.zones.content.replace(find, replace));
  if ("error" in applied) return { text: JSON.stringify({ error: applied.error }) };

  return {
    text: JSON.stringify({
      result: `Updated ${path} on ${site.name}. "${find}" is now "${replace}". The change is live.`,
      path,
      siteId: site.id,
    }),
  };
}

/** WRITE — swap one image for a library image. Approve-gated. */
export async function replaceWebsiteImageTool(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const path = String(input.path || "").trim();
  const currentSrc = String(input.currentSrc || "").trim();
  const imageId = Number(input.imageId);
  const source = String(input.source || "website");
  if (!path) return { text: JSON.stringify({ error: "path is required." }) };
  if (!currentSrc) return { text: JSON.stringify({ error: "currentSrc is required." }) };
  if (!imageId) return { text: JSON.stringify({ error: "imageId is required." }) };
  if (source !== "website" && source !== "content-studio") {
    return { text: JSON.stringify({ error: 'source must be "website" or "content-studio".' }) };
  }

  const site = resolveSite(ctx, input.siteId);
  if ("error" in site) return site.error;

  // Resolve the picture to something the public can actually load.
  //
  // A Content Studio photo is copied into the website's library here — its
  // own file route is behind a login, so linking it directly would put a
  // broken image on the page for every visitor.
  //
  // Either way the id is checked against THIS tenant. Without that a model
  // could name any number and put a stranger's photograph on the page:
  // Studio ids are tenant-scoped by the database the row lives in, and CMS
  // ids by canManageLibraryAsset.
  let asset: { id: number; originalName: string };
  if (source === "content-studio") {
    const resolved = await cmsAssetForStudioPhoto(ctx.tenantId, imageId);
    if ("error" in resolved) return { text: JSON.stringify({ error: resolved.error }) };
    asset = resolved.asset;
  } else {
    const existing = getLibraryAsset(imageId);
    if (!existing || !canManageLibraryAsset(existing, ctx.tenantId)) {
      return { text: JSON.stringify({ error: `No image with id ${imageId} in this business's website images.` }) };
    }
    asset = existing;
  }

  const read = readPage(ctx, site.id, path);
  if ("error" in read) return { text: JSON.stringify({ error: read.error }) };

  const present = imagesIn(read.zones.content).filter((i) => i.src === currentSrc);
  if (present.length === 0) {
    return {
      text: JSON.stringify({
        error: `No image with src "${currentSrc}" on ${path}. Call read_website_page and copy a src exactly.`,
      }),
    };
  }
  if (present.length > 1) {
    return {
      text: JSON.stringify({
        error: `${present.length} images on ${path} share that src, so there is no way to tell which one you mean.`,
      }),
    };
  }

  const nextUrl = libraryUrl(asset.id);
  const newAlt = input.alt != null ? String(input.alt).trim() : "";

  // Rewrite only the src (and alt, if given) of that one tag. The tag's
  // classes, sizing and position are what make it fit the design, so they
  // are left exactly as they are.
  let replaced = false;
  const nextContent = read.zones.content.replace(/<img\b[^>]*>/gi, (tag) => {
    if (replaced) return tag;
    const src = (/\bsrc="([^"]*)"/i.exec(tag) || [, ""])[1];
    if (src !== currentSrc) return tag;
    replaced = true;
    let next = tag.replace(/\bsrc="[^"]*"/i, `src="${nextUrl}"`);
    if (newAlt) {
      next = /\balt="[^"]*"/i.test(next)
        ? next.replace(/\balt="[^"]*"/i, `alt="${newAlt.replace(/"/g, "&quot;")}"`)
        : next.replace(/<img\b/i, `<img alt="${newAlt.replace(/"/g, "&quot;")}"`);
    }
    return next;
  });

  if (!replaced) return { text: JSON.stringify({ error: "Could not find that image to replace." }) };

  const applied = applyContentChange(ctx, site.id, read.page.id, nextContent);
  if ("error" in applied) return { text: JSON.stringify({ error: applied.error }) };

  return {
    text: JSON.stringify({
      result: `Replaced the image on ${path} with "${asset.originalName.replace(new RegExp(`^${STUDIO_COPY_PREFIX}\\d+-`), "")}". The change is live.`,
      path,
      siteId: site.id,
      newSrc: nextUrl,
    }),
  };
}
