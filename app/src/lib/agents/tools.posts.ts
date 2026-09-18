import "server-only";

import fs from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import JSZip from "jszip";

import { AiCapError, assertAiAllowed } from "@/lib/ai/usage";
import { saveDownload } from "@/lib/assistant/downloadStore";
import { createCarousel, getCarousel, listCarousels, type CarouselWithSlides } from "@/lib/image/carousels";
import { enqueueCarouselGeneration } from "@/lib/image/carouselGeneration";
import { renderFilePath } from "@/lib/image/renderStore";
import { DEFAULT_CAROUSEL_SLOT, DEFAULT_SLOT, isCarouselSlot } from "@/lib/image/slots";
import type { ToolContext, ToolResult } from "@/lib/agents/toolKit";

/**
 * Social posts from the chat: the three tools that let Adonis make a week of
 * posts in Content Studio and hand them back as a download.
 *
 * Before these existed the agent could only DRAFT a carousel as text
 * (draft_carousel, tools.marketing.ts) and tell the operator to go and build
 * it themselves. The posts the operator actually wanted -- designed, on-brand,
 * saved where the rest of their content lives -- were only reachable from the
 * Content Studio's own Generate button. These tools reach the same pipeline
 * from the chat:
 *
 *   create_social_post  WRITE  creates a design in Content Studio and queues
 *                              the SAME generation the studio's Generate
 *                              button runs (enqueueCarouselGeneration -> the
 *                              AI-designed satori path, or the template path
 *                              when the tenant has no design system). One
 *                              call per post; each is its own Approve card.
 *   list_social_posts   READ   what is in Content Studio and whether each
 *                              design is still writing, failed, or rendered.
 *   export_social_posts READ   zips the rendered PNGs (plus each caption) of
 *                              the posts asked for into one download and
 *                              attaches it to the chat as an artifact, the
 *                              way bundle_invoices attaches its zip.
 *
 * The generation is DETACHED and SERIAL (see carouselGeneration.ts): a create
 * returns the moment the design is queued, and a week of posts runs one after
 * another in the background -- two to four minutes each. That is why the
 * export is a separate step with an honest status per post rather than
 * something create could promise: nothing here claims a post is designed
 * until its render is on disk.
 *
 * What can be exported: a DESIGNED slide stores its render as a PNG on the
 * volume (renderFilename), which is what goes in the zip. A template-style
 * slide is painted in the browser and has no server-side file, so a design
 * made that way is reported as "export it from Content Studio" rather than
 * silently shipped without pictures.
 *
 * Every store function here reads/writes through the ambient request-scoped
 * `db` (@/lib/db), the same as @/lib/image/carousels' other callers; every
 * call site that reaches executeTool wraps it in runWithTenant(ctx.tenantId)
 * first, so the ambient tenant equals ctx.tenantId. ctx.tenantId is passed
 * explicitly where a detached continuation or a tenant-owned file needs it.
 */
export type { ToolContext, ToolResult };

const MIN_SLIDES = 2;
const MAX_SLIDES = 10;
const DEFAULT_SLIDES = 5;
/** How many posts one export will zip -- a week is seven, a fortnight fourteen. */
const MAX_EXPORT = 20;

// ─── Tool schemas (what the model sees) ──────────────────────────────────────

export const POSTS_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_social_post",
    description:
      "Create ONE social post in Content Studio and start designing it: either a single-image post (format \"single\", one statement, offer or quote) or a carousel (format \"carousel\", 2-10 slides that teach something). The copy is written and the post designed on-brand in the background, exactly as the studio's own Generate button does. Returns the new post's id and editor link. A design takes 1-4 minutes and posts queue one after another, so call this once per post (a week of posts = several calls, each approved separately), then use list_social_posts to see when they're ready and export_social_posts to hand them over as a download. Never say a post is designed until list_social_posts shows it rendered.",
    input_schema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["single", "carousel"],
          description: "\"single\" for a one-image post, \"carousel\" for a swipeable set (default carousel).",
        },
        name: {
          type: "string",
          description: "Short name for the post as it will appear in Content Studio, e.g. \"Mon - Why HBOT helps recovery\".",
        },
        topic: {
          type: "string",
          description: "What the post is about, with any angle or hook the operator agreed. This is the brief the slides are written from.",
        },
        slideCount: {
          type: "integer",
          description: `Carousels only: number of slides, ${MIN_SLIDES}-${MAX_SLIDES} (default ${DEFAULT_SLIDES}). Ignored for a single.`,
        },
        tone: { type: "string", description: "Optional tone notes." },
      },
      required: ["name", "topic"],
    },
  },
  {
    name: "list_social_posts",
    description:
      "List the social posts (designs) in Content Studio, newest first: id, name, how many slides, and whether each is still writing, failed, or rendered and ready to export. Use it to check on posts created with create_social_post before exporting them.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "How many to list (default 20, max 50)." },
      },
    },
  },
  {
    name: "export_social_posts",
    description:
      "Bundle the finished slides of the given posts into ONE zip (a folder per post with numbered PNGs and its caption) and attach it to the chat as a download. Posts still writing, failed, or without server-side renders are left out and named in the result so you can tell the operator. Use list_social_posts first to get ids and check readiness.",
    input_schema: {
      type: "object",
      properties: {
        postIds: {
          type: "array",
          items: { type: "integer" },
          description: `Ids of the posts to export (from create_social_post or list_social_posts), up to ${MAX_EXPORT}.`,
        },
      },
      required: ["postIds"],
    },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

type PostStatus = "writing" | "failed" | "ready" | "empty";

/**
 * The slides an export would ship, in order. A design can hold both a
 * single-image slot and a carousel slot; the carousel is the post. Only a
 * slide whose render exists on disk counts -- a designed slide whose render
 * failed, or a template slide (painted in the browser, no file), does not.
 */
function exportableSlides(carousel: CarouselWithSlides) {
  const carouselSlides = carousel.slides.filter((s) => isCarouselSlot(s.slotKey));
  const slides = carouselSlides.length > 0 ? carouselSlides : carousel.slides;
  return slides
    .slice()
    .sort((a, b) => a.slideOrder - b.slideOrder)
    .filter((s) => s.renderFilename && fs.existsSync(renderFilePath(s.renderFilename)));
}

function postStatus(carousel: CarouselWithSlides): PostStatus {
  if (carousel.generationStatus === "writing") return "writing";
  if (carousel.generationStatus === "failed") return "failed";
  if (carousel.slides.length === 0) return "empty";
  return "ready";
}

/** The caption lives on the first slide of the slot -- the studio's own convention. */
function captionOf(carousel: CarouselWithSlides): string {
  const carouselSlides = carousel.slides.filter((s) => isCarouselSlot(s.slotKey));
  const slides = carouselSlides.length > 0 ? carouselSlides : carousel.slides;
  const first = slides.slice().sort((a, b) => a.slideOrder - b.slideOrder)[0];
  return first?.caption ?? "";
}

function slugOf(name: string, id: number): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `post-${id}`
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function editorUrl(id: number): string {
  return `/content-studio/images/${id}`;
}

function summarise(carousel: CarouselWithSlides) {
  const status = postStatus(carousel);
  const rendered = exportableSlides(carousel).length;
  const hasCarousel = carousel.slides.some((s) => isCarouselSlot(s.slotKey));
  return {
    id: carousel.id,
    name: carousel.name,
    format: hasCarousel ? "carousel" : "single",
    status,
    stage: status === "writing" ? (carousel.generationStage ?? null) : null,
    error: status === "failed" ? (carousel.generationError ?? null) : null,
    slideCount: carousel.slides.length,
    renderedSlides: rendered,
    exportable: status === "ready" && rendered > 0,
    editorUrl: editorUrl(carousel.id),
    updatedAt: carousel.updatedAt ? new Date(carousel.updatedAt).toISOString() : null,
  };
}

// ─── Executors ───────────────────────────────────────────────────────────────

/** WRITE -- create a design in Content Studio and queue its generation. Approve-gated. */
export function createSocialPostTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const name = String(input.name || "").trim();
  const topic = String(input.topic || "").trim();
  if (!name) return { text: JSON.stringify({ error: "name is required." }) };
  if (!topic) return { text: JSON.stringify({ error: "topic is required." }) };
  const tone = input.tone != null ? String(input.tone).trim() || null : null;
  const format = String(input.format || "carousel").trim().toLowerCase() === "single" ? "single" : "carousel";
  const countArg = Number(input.slideCount);
  const slideCount =
    format === "single"
      ? 1
      : Number.isFinite(countArg) && countArg > 0
        ? Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, Math.round(countArg)))
        : DEFAULT_SLIDES;
  // A single lives in the studio's single-image slot, a carousel in its
  // carousel slot: the slot IS the kind as far as the editor is concerned.
  const slotKey = format === "single" ? DEFAULT_SLOT : DEFAULT_CAROUSEL_SLOT;

  // Checked HERE, before anything is created: a tenant over its allowance
  // gets a clean refusal instead of an empty design that fails a beat later
  // in the background. The generation re-checks on its own metered calls.
  try {
    assertAiAllowed(ctx.tenantId);
  } catch (err) {
    if (err instanceof AiCapError) return { text: JSON.stringify({ error: err.message }) };
    throw err;
  }

  const carousel = createCarousel({ name });
  enqueueCarouselGeneration({
    tenantId: ctx.tenantId,
    carouselId: carousel.id,
    topic,
    slideCount,
    tone,
    slotKey,
    replaceExisting: false,
  });

  return {
    text: JSON.stringify({
      result: `Created "${name}" in Content Studio and queued its design (${format === "single" ? "single image" : `${slideCount}-slide carousel`}). It is being written and designed in the background -- 1-4 minutes, one post at a time. Check list_social_posts before telling the operator it is ready.`,
      postId: carousel.id,
      status: "writing",
      format,
      slideCount,
      editorUrl: editorUrl(carousel.id),
    }),
  };
}

/** READ -- the designs in Content Studio with an honest status for each. */
export function listSocialPostsTool(_ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const limitArg = Number(input.limit);
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.min(50, Math.round(limitArg)) : 20;

  const posts = listCarousels()
    .slice(0, limit)
    .map((summary) => getCarousel(summary.id))
    .filter((c): c is CarouselWithSlides => c !== null)
    .map(summarise);

  return {
    text: JSON.stringify({
      count: posts.length,
      posts,
      note: "A post is exportable once status is \"ready\" and renderedSlides > 0. \"writing\" posts are still being designed; call again in a minute or two.",
    }),
  };
}

/** READ -- zip the rendered slides of the given posts into one download and attach it. */
export async function exportSocialPostsTool(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const raw = Array.isArray(input.postIds) ? input.postIds : [];
  const ids = [...new Set(raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_EXPORT);
  if (ids.length === 0) return { text: JSON.stringify({ error: "postIds is required -- one or more post ids from list_social_posts." }) };

  const zip = new JSZip();
  const included: { id: number; name: string; slides: number }[] = [];
  const skipped: { id: number; name: string | null; reason: string }[] = [];

  for (const id of ids) {
    const carousel = getCarousel(id);
    if (!carousel) {
      skipped.push({ id, name: null, reason: "No post with that id." });
      continue;
    }
    const status = postStatus(carousel);
    if (status === "writing") {
      skipped.push({ id, name: carousel.name, reason: "Still being designed -- try again in a minute or two." });
      continue;
    }
    if (status === "failed") {
      skipped.push({ id, name: carousel.name, reason: `Its design failed: ${carousel.generationError ?? "unknown error"}. Regenerate it in Content Studio.` });
      continue;
    }
    const slides = exportableSlides(carousel);
    if (slides.length === 0) {
      skipped.push({
        id,
        name: carousel.name,
        reason:
          carousel.slides.length === 0
            ? "It has no slides yet."
            : "Its slides have no server-side renders (a template-style design) -- export it from Content Studio instead.",
      });
      continue;
    }

    const folder = zip.folder(`${pad(included.length + 1)}-${slugOf(carousel.name, carousel.id)}`)!;
    slides.forEach((slide, i) => {
      folder.file(`${pad(i + 1)}.png`, fs.readFileSync(renderFilePath(slide.renderFilename!)));
    });
    const caption = captionOf(carousel);
    if (caption.trim()) folder.file("caption.txt", caption);
    included.push({ id: carousel.id, name: carousel.name, slides: slides.length });
  }

  if (included.length === 0) {
    return {
      text: JSON.stringify({
        error: "Nothing to export yet -- none of those posts has finished slides.",
        skipped,
      }),
    };
  }

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const filename = included.length === 1 ? `${slugOf(included[0].name, included[0].id)}.zip` : `social-posts-${new Date().toISOString().slice(0, 10)}.zip`;
  const saved = saveDownload(ctx.tenantId, filename, buf);
  const slideTotal = included.reduce((n, p) => n + p.slides, 0);
  const label =
    included.length === 1
      ? `Download "${included[0].name}" (${slideTotal} slides, .zip)`
      : `Download ${included.length} posts (${slideTotal} slides, .zip)`;

  return {
    text: JSON.stringify({
      result: `Bundled ${included.length} post${included.length === 1 ? "" : "s"} (${slideTotal} slides) into ${saved.filename}. The download link is attached to this chat; it expires in about two hours.`,
      downloadUrl: saved.url,
      included,
      skipped,
    }),
    artifact: { url: saved.url, filename: saved.filename, label },
  };
}
