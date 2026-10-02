import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { db, schema } from "@/lib/db";
import { listPages, getPageByPath, setPageStatus } from "@/lib/cms/pages";
import { getBlock } from "@/lib/cms/blocks";
import { getSeo } from "@/lib/cms/seo";
import { splitPageBody, studioEditability, joinPageBody } from "@/lib/cms/pageBody";
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
import { getAppBaseUrl } from "@/lib/appUrl";
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
 * instead. A NEW page is the same idea one level up: a copy of an existing
 * page with those same swaps applied, created unpublished until the
 * operator has previewed it (create_website_page, publish_website_page).
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
function readPage(
  ctx: ToolContext,
  siteId: number,
  path: string,
): { error: string } | { page: NonNullable<ReturnType<typeof getPageByPath>>; zones: ReturnType<typeof splitPageBody> } {
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

/**
 * Replace one exact piece of text in a page's content zone.
 *
 * The only text write there is, shared by edit_website_text and
 * create_website_page so both refuse the same things: markup in the new text
 * (the page renders verbatim on the client's domain), a phrase that is not
 * there, and a phrase that is there more than once.
 */
function swapText(content: string, find: string, replace: string, where: string): { error: string } | { content: string } {
  if (!find.trim()) return { error: "find is required." };
  if (/[<>]/.test(replace)) {
    return { error: "replace must be plain text — it cannot contain < or >. Use the CMS editor for markup changes." };
  }
  const occurrences = content.split(find).length - 1;
  if (occurrences === 0) {
    return {
      error: `"${find}" does not appear on ${where}. Call read_website_page and copy the wording exactly — it may be split differently than it looks on screen.`,
    };
  }
  if (occurrences > 1) {
    return {
      error: `"${find}" appears ${occurrences} times on ${where}, so there is no way to tell which one you mean. Include more of the surrounding sentence.`,
    };
  }
  // A function, not a string: a replacement string would expand `$&` and
  // friends, letting the new text pull fragments of the page back in.
  return { content: content.replace(find, () => replace) };
}

/**
 * Point one <img> at a different picture, keeping its classes, sizing and
 * position — those are what make it fit the design. `nextUrl` is always one
 * this module built (libraryUrl), never one the model wrote.
 */
function swapImage(
  content: string,
  currentSrc: string,
  nextUrl: string,
  alt: string,
  where: string,
): { error: string } | { content: string } {
  const present = imagesIn(content).filter((i) => i.src === currentSrc);
  if (present.length === 0) {
    return { error: `No image with src "${currentSrc}" on ${where}. Call read_website_page and copy a src exactly.` };
  }
  if (present.length > 1) {
    return { error: `${present.length} images on ${where} share that src, so there is no way to tell which one you mean.` };
  }

  const safeAlt = alt.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let replaced = false;
  const next = content.replace(/<img\b[^>]*>/gi, (tag) => {
    if (replaced) return tag;
    const src = (/\bsrc="([^"]*)"/i.exec(tag) || [, ""])[1];
    if (src !== currentSrc) return tag;
    replaced = true;
    let out = tag.replace(/\bsrc="[^"]*"/i, () => `src="${nextUrl}"`);
    if (alt) {
      out = /\balt="[^"]*"/i.test(out)
        ? out.replace(/\balt="[^"]*"/i, () => `alt="${safeAlt}"`)
        : out.replace(/<img\b/i, `<img alt="${safeAlt}"`);
    }
    return out;
  });
  if (!replaced) return { error: "Could not find that image to replace." };
  return { content: next };
}

/**
 * Resolve an image the model named to one in THIS tenant's website library,
 * copying a Content Studio photo across first when that is where it lives.
 *
 * Either way the id is checked against this tenant. Without that a model
 * could name any number and put a stranger's photograph on the page: Studio
 * ids are tenant-scoped by the database the row lives in, and CMS ids by
 * canManageLibraryAsset.
 */
async function resolveWebsiteImage(
  ctx: ToolContext,
  imageId: number,
  source: string,
): Promise<{ error: string } | { asset: { id: number; originalName: string } }> {
  if (!imageId) return { error: "imageId is required." };
  if (source !== "website" && source !== "content-studio") {
    return { error: 'source must be "website" or "content-studio".' };
  }
  // A Content Studio photo is copied into the website's library here — its
  // own file route is behind a login, so linking it directly would put a
  // broken image on the page for every visitor.
  if (source === "content-studio") return cmsAssetForStudioPhoto(ctx.tenantId, imageId);
  const existing = getLibraryAsset(imageId);
  if (!existing || !canManageLibraryAsset(existing, ctx.tenantId)) {
    return { error: `No image with id ${imageId} in this business's website images.` };
  }
  return { asset: existing };
}

/** The asset's name as the operator knows it, without the Studio-copy marker. */
const displayName = (asset: { originalName: string }) =>
  asset.originalName.replace(new RegExp(`^${STUDIO_COPY_PREFIX}\\d+-`), "");

/**
 * A new page's path: lowercase words joined by hyphens, one or more segments.
 *
 * Narrow on purpose. The path is a URL on the client's live domain, and it is
 * also matched against routes the platform owns: /blog and /blog-posts belong
 * to the blog, /c to campaign landing pages, and a page there would either be
 * shadowed or shadow them.
 */
const PAGE_PATH = /^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const RESERVED_FIRST_SEGMENTS = new Set(["blog", "blog-posts", "c", "site", "site-media", "api", "sites"]);

function checkNewPath(raw: string): { error: string } | { path: string } {
  const path = raw.trim().toLowerCase().replace(/\/+$/, "");
  if (!path || path === "/") return { error: "path is required, e.g. /vouchers. The home page already exists." };
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  if (withSlash.length > 80 || !PAGE_PATH.test(withSlash)) {
    return {
      error: `"${raw}" is not a usable page address. Use lowercase words joined by hyphens, e.g. /gift-vouchers.`,
    };
  }
  const first = withSlash.split("/")[1]!;
  if (RESERVED_FIRST_SEGMENTS.has(first)) {
    return { error: `/${first} is used by the platform itself (blog, campaign pages), so a page cannot live there. Pick another address.` };
  }
  return { path: withSlash };
}

/**
 * Where an admin can look at a page that is not live yet (see
 * draftPageForPreview in lib/cms/render). Absolute, on the APP host — the
 * only host the operator's session cookie reaches — and because the chat
 * only turns full URLs into links.
 */
const previewUrlFor = (siteSlug: string, path: string) => `${getAppBaseUrl()}/site/${siteSlug}${path}?preview=1`;

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
  {
    name: "create_website_page",
    description:
      "Add a NEW page to the website by copying an existing page's design and changing its words and pictures. The new page keeps the copied page's layout, styling, navbar, footer and animations exactly; only the text and images you list change. It is created UNPUBLISHED — the public cannot see it until publish_website_page — and the result includes a preview link for the operator. Workflow: list_website_pages, pick the page whose layout best fits, read_website_page on it, then plan EVERY wording change (headings, paragraphs, button labels, the page's own title text) so nothing about the old topic is left behind, and choose images with list_website_images. Show the operator the plan (new address, title, what each section will say) and only call this once they approve. Each `find` must appear exactly once in the copied page, copied verbatim from read_website_page; changes apply in order, so a later find is matched against the text after earlier changes. This cannot add or remove sections or change the layout. It also does not add the page to the site's menu.",
    input_schema: {
      type: "object",
      properties: {
        copyFrom: { type: "string", description: "Path of the existing page whose design to copy, e.g. /massage (from list_website_pages)." },
        path: { type: "string", description: "The new page's address: lowercase words joined by hyphens, e.g. /gift-vouchers. Must not already exist." },
        title: { type: "string", description: "The new page's title, shown in the browser tab and search results. Plain text." },
        description: { type: "string", description: "Optional: one or two sentences for search results. Plain text." },
        textChanges: {
          type: "array",
          description: "Wording changes to make on the copy, in order.",
          items: {
            type: "object",
            properties: {
              find: { type: "string", description: "Exact existing text, copied from read_website_page." },
              replace: { type: "string", description: "The new text. Plain text only — no HTML." },
            },
            required: ["find", "replace"],
          },
        },
        imageChanges: {
          type: "array",
          description: "Optional: pictures to swap on the copy.",
          items: {
            type: "object",
            properties: {
              currentSrc: { type: "string", description: "The src of an image on the copied page, exactly as read_website_page reported it." },
              imageId: { type: "integer", description: "The image's id, from list_website_images." },
              source: { type: "string", enum: ["website", "content-studio"] },
              alt: { type: "string", description: "Optional: alt text describing the new image." },
            },
            required: ["currentSrc", "imageId", "source"],
          },
        },
        siteId: { type: "integer" },
      },
      required: ["copyFrom", "path", "title", "textChanges"],
    },
  },
  {
    name: "publish_website_page",
    description:
      "Put an unpublished page live on the website, so the public can visit it. Use after create_website_page once the operator has looked at the preview and said it is ready. Only call this with the operator's go-ahead.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The page's path, e.g. /gift-vouchers." },
        siteId: { type: "integer" },
      },
      required: ["path"],
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

  const swapped = swapText(read.zones.content, find, replace, path);
  if ("error" in swapped) return { text: JSON.stringify({ error: swapped.error }) };

  const applied = applyContentChange(ctx, site.id, read.page.id, swapped.content);
  if ("error" in applied) return { text: JSON.stringify({ error: applied.error }) };

  const live = read.page.status === "published";
  return {
    text: JSON.stringify({
      result: `Updated ${path} on ${site.name}. "${find}" is now "${replace}". ${live ? "The change is live." : "The page is not published yet."}`,
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

  const resolved = await resolveWebsiteImage(ctx, imageId, source);
  if ("error" in resolved) return { text: JSON.stringify({ error: resolved.error }) };
  const asset = resolved.asset;

  const read = readPage(ctx, site.id, path);
  if ("error" in read) return { text: JSON.stringify({ error: read.error }) };

  const nextUrl = libraryUrl(asset.id);
  const newAlt = input.alt != null ? String(input.alt).trim() : "";
  const swapped = swapImage(read.zones.content, currentSrc, nextUrl, newAlt, path);
  if ("error" in swapped) return { text: JSON.stringify({ error: swapped.error }) };

  const applied = applyContentChange(ctx, site.id, read.page.id, swapped.content);
  if ("error" in applied) return { text: JSON.stringify({ error: applied.error }) };

  const live = read.page.status === "published";
  return {
    text: JSON.stringify({
      result: `Replaced the image on ${path} with "${displayName(asset)}". ${live ? "The change is live." : "The page is not published yet."}`,
      path,
      siteId: site.id,
      newSrc: nextUrl,
    }),
  };
}

/**
 * WRITE — a new page, made by copying an existing one. Approve-gated.
 *
 * This is how Adonis adds a page without ever writing markup. The copy
 * carries the source page's whole body — stylesheet, markup, scripts — and
 * the only changes are the same text and image swaps the edit tools make, so
 * every tag on the new page was written by whoever built the site. That
 * keeps both promises at the top of this file: no model-authored HTML on the
 * client's domain, and no design the chat could wreck.
 *
 * Everything is checked before anything is written, so a refused change
 * leaves no half-made page behind. The page is created UNPUBLISHED; the
 * operator previews it and publish_website_page puts it live.
 */
export async function createWebsitePageTool(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const fail = (error: string): ToolResult => ({ text: JSON.stringify({ error }) });

  const copyFrom = String(input.copyFrom || "").trim();
  if (!copyFrom) return fail("copyFrom is required — the path of the page whose design to copy.");
  const checked = checkNewPath(String(input.path ?? ""));
  if ("error" in checked) return fail(checked.error);
  const path = checked.path;

  const title = String(input.title ?? "").trim();
  const description = String(input.description ?? "").trim();
  if (!title) return fail("title is required.");
  if (title.length > 120 || /[<>]/.test(title)) return fail("title must be plain text, under 120 characters.");
  if (description.length > 320 || /[<>]/.test(description)) {
    return fail("description must be plain text, under 320 characters.");
  }

  const textChanges = Array.isArray(input.textChanges) ? (input.textChanges as Array<Record<string, unknown>>) : [];
  const imageChanges = Array.isArray(input.imageChanges) ? (input.imageChanges as Array<Record<string, unknown>>) : [];
  if (textChanges.length === 0) {
    return fail("textChanges is empty. A new page needs its own wording — otherwise it is a duplicate of " + copyFrom + ".");
  }
  if (textChanges.length > 80 || imageChanges.length > 30) return fail("Too many changes in one go (80 text, 30 images at most).");

  const site = resolveSite(ctx, input.siteId);
  if ("error" in site) return site.error;

  if (getPageByPath(site.id, path)) return fail(`There is already a page at ${path}. Pick another address.`);

  const read = readPage(ctx, site.id, copyFrom);
  if ("error" in read) return fail(read.error);

  // Apply every change to the copy in memory first.
  let content = read.zones.content;
  for (const [i, change] of textChanges.entries()) {
    const swapped = swapText(content, String(change?.find ?? ""), String(change?.replace ?? ""), `the copy of ${copyFrom}`);
    if ("error" in swapped) return fail(`Text change ${i + 1}: ${swapped.error}`);
    content = swapped.content;
  }
  const placed: string[] = [];
  for (const [i, change] of imageChanges.entries()) {
    const resolved = await resolveWebsiteImage(ctx, Number(change?.imageId), String(change?.source || "website"));
    if ("error" in resolved) return fail(`Image change ${i + 1}: ${resolved.error}`);
    const swapped = swapImage(
      content,
      String(change?.currentSrc ?? "").trim(),
      libraryUrl(resolved.asset.id),
      change?.alt != null ? String(change.alt).trim() : "",
      `the copy of ${copyFrom}`,
    );
    if ("error" in swapped) return fail(`Image change ${i + 1}: ${swapped.error}`);
    content = swapped.content;
    placed.push(displayName(resolved.asset));
  }

  const body = joinPageBody({ ...read.zones, content });
  const sourceSeo = getSeo(site.id, read.page.id);
  const pageKey = path.slice(1).replace(/\//g, "-");

  const pageId = db.transaction((tx) => {
    const row = tx
      .insert(schema.pages)
      .values({
        siteId: site.id,
        pageKey,
        path,
        title,
        templateId: read.page.templateId,
        status: "draft",
        sortOrder: read.page.sortOrder,
        showInSitemap: read.page.showInSitemap,
      })
      .returning({ id: schema.pages.id })
      .get();
    tx.insert(schema.contentBlocks)
      .values({
        siteId: site.id,
        pageId: row.id,
        name: "body",
        kind: "html",
        value: body,
        // Stamped like any operator edit, so a deploy-time site sync can
        // never overwrite the page even if the repo later gains one here.
        updatedBy: ctx.userId ?? null,
      })
      .run();
    // The copied page's canonical URL and structured data describe THAT
    // page, so neither is carried over; the share image and robots are.
    tx.insert(schema.seoMeta)
      .values({
        siteId: site.id,
        pageId: row.id,
        seoTitle: title,
        seoDescription: description || null,
        robots: sourceSeo?.robots ?? "index,follow",
        ogImageAssetId: sourceSeo?.ogImageAssetId ?? null,
      })
      .run();
    return row.id;
  });

  const previewUrl = previewUrlFor(site.slug, path);
  return {
    text: JSON.stringify({
      // `result` is the sentence the operator sees once they approve, so the
      // preview link has to be in it.
      result:
        `Created ${path} ("${title}") on ${site.name}, copied from ${copyFrom}. It is not live yet - preview it here: ${previewUrl} ` +
        `When it looks right, ask me to publish it. It is not in the site's menu yet.`,
      path,
      pageId,
      siteId: site.id,
      previewUrl,
      next:
        "Give the operator the previewUrl as a link so they can check it. Fix anything with edit_website_text / replace_website_image on the new path, then publish_website_page once they say it is ready. Tell them the page is not in the site's menu; they can link to it from the CMS or another page.",
    }),
  };
}

/** WRITE — put an unpublished page live. Approve-gated. */
export function publishWebsitePageTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const path = String(input.path || "").trim();
  if (!path) return { text: JSON.stringify({ error: "path is required." }) };

  const site = resolveSite(ctx, input.siteId);
  if ("error" in site) return site.error;

  const page = getPageByPath(site.id, path);
  if (!page) return { text: JSON.stringify({ error: `No page at ${path}.` }) };
  if (page.status === "published") return { text: JSON.stringify({ result: `${path} is already live.`, path }) };

  setPageStatus(site.id, page.id, "published");
  return {
    text: JSON.stringify({ result: `${path} is now live on ${site.name}.`, path, siteId: site.id }),
  };
}
