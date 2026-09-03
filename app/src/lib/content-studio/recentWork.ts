import type { CarouselSlide, VideoProject } from "@/lib/db/schema";
import { listProjects } from "@/lib/video/projects";
import { listCarousels, type CarouselSummary } from "@/lib/image/carousels";
import { listBlogPosts } from "@/lib/blog/posts";

/**
 * The Content Studio home shows every video, carousel and blog in ONE grid,
 * newest first, each with a real thumbnail. This module is the single source
 * that merges the three per-type lists into a uniform shape the home grid can
 * render without knowing the per-type quirks. Server-only (ambient tenant db).
 */

export type ContentKind = "video" | "image" | "blog";
export type ContentTone = "neutral" | "info" | "success" | "warning" | "danger";
export interface ContentStatus {
  label: string;
  tone: ContentTone;
}

export interface ContentItem {
  kind: ContentKind;
  id: number;
  title: string;
  /** Link to the item's editor. */
  href: string;
  updatedAt: Date;
  status: ContentStatus;
  /** One-line secondary meta, e.g. "5 slides · 1:1" or "6 min read". */
  meta: string;
  aspectRatio?: string;
  // ── preview payloads (exactly one is set, keyed by `kind`) ──
  /** image: the first slide, rendered through the shared canvas paint path. */
  firstSlide?: CarouselSlide | null;
  /** image: total slide count, so the thumbnail draws the same chrome (indicator/tagline) as slide 1 of N. */
  slideCount?: number;
  /** blog: cover image URL, if any. */
  coverImageUrl?: string | null;
  /** video: same-origin URL of the rendered output (posters the card), else null. */
  videoPosterUrl?: string | null;
}

const VIDEO_STATUS: Record<VideoProject["status"], ContentStatus> = {
  queued: { label: "Queued", tone: "info" },
  transcribing: { label: "Transcribing", tone: "info" },
  transcribed: { label: "Ready to edit", tone: "neutral" },
  planning: { label: "Planning cuts", tone: "info" },
  rendering: { label: "Rendering", tone: "info" },
  rendered: { label: "Rendered", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

function videoToItem(p: VideoProject): ContentItem {
  const rendered = p.status === "rendered" && !!p.outputFilename;
  return {
    kind: "video",
    id: p.id,
    title: p.name,
    href: `/content-studio/videos/${p.id}`,
    updatedAt: p.updatedAt,
    status: VIDEO_STATUS[p.status] ?? { label: p.status, tone: "neutral" },
    meta: `${p.aspectRatio} · ${p.targetSeconds}s`,
    aspectRatio: p.aspectRatio,
    videoPosterUrl: rendered ? `/api/content-studio/projects/${p.id}/output` : null,
  };
}

function carouselToItem(c: CarouselSummary): ContentItem {
  const s = c.firstSlide;
  const status: ContentStatus =
    s?.imageStatus === "generating"
      ? { label: "Generating", tone: "info" }
      : s?.imageStatus === "failed"
        ? { label: "AI image failed", tone: "danger" }
        : { label: "Draft", tone: "neutral" };
  return {
    kind: "image",
    id: c.id,
    title: c.name,
    href: `/content-studio/images/${c.id}`,
    updatedAt: c.updatedAt,
    status,
    meta: `${c.slideCount} slide${c.slideCount === 1 ? "" : "s"}${s ? ` · ${s.aspectRatio}` : ""}`,
    aspectRatio: s?.aspectRatio,
    firstSlide: s,
    slideCount: c.slideCount,
  };
}

type BlogRow = ReturnType<typeof listBlogPosts>[number];

function blogToItem(b: BlogRow): ContentItem {
  const status: ContentStatus =
    b.status === "generating"
      ? { label: "Generating", tone: "info" }
      : b.status === "failed"
        ? { label: "Failed", tone: "danger" }
        : { label: "Draft", tone: "neutral" };
  const words = b.content ? b.content.trim().split(/\s+/).filter(Boolean).length : 0;
  const readMin = words ? Math.max(1, Math.round(words / 200)) : 0;
  return {
    kind: "blog",
    id: b.id,
    title: b.title,
    href: `/content-studio/blogs/${b.id}`,
    updatedAt: b.updatedAt,
    status,
    meta: readMin ? `${readMin} min read` : "Draft",
    coverImageUrl: b.coverImageUrl ?? null,
  };
}

/** Every piece of content across the three tools, newest-updated first. */
export function listRecentWork(): ContentItem[] {
  const items: ContentItem[] = [
    ...listProjects().map(videoToItem),
    ...listCarousels().map(carouselToItem),
    ...listBlogPosts().map(blogToItem),
  ];
  return items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/** Per-kind counts for the filter tabs (All is the total). */
export function countByKind(items: ContentItem[]): Record<ContentKind, number> {
  return {
    video: items.filter((i) => i.kind === "video").length,
    image: items.filter((i) => i.kind === "image").length,
    blog: items.filter((i) => i.kind === "blog").length,
  };
}
