import type { CarouselSlide, VideoProject } from "@/lib/db/schema";
import { listProjects } from "@/lib/video/projects";
import { listCarousels, type CarouselSummary } from "@/lib/image/carousels";
import { listBlogPosts } from "@/lib/blog/posts";
import { titleFrom } from "./title";
import { listAdCreatives, type AdCreativeView } from "@/lib/ads/creatives";
import { renderFileUrl } from "@/lib/image/renderStore.client";

/**
 * The Content Studio home shows every video, carousel and blog in ONE grid,
 * newest first, each with a real thumbnail. This module is the single source
 * that merges the three per-type lists into a uniform shape the home grid can
 * render without knowing the per-type quirks. Server-only (ambient tenant db).
 */

export type ContentKind = "video" | "image" | "blog" | "ad";
export type ContentTone = "neutral" | "info" | "success" | "warning" | "danger";
export interface ContentStatus {
  label: string;
  tone: ContentTone;
}

export interface ContentItem {
  kind: ContentKind;
  id: number;
  /** Card title: the stored name reduced to one line (see lib/content-studio/title.ts). */
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
  /** ad: the first version's feed image, already rendered. */
  imageUrl?: string | null;
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
    title: titleFrom(p.name),
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
    title: titleFrom(c.name),
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
    title: titleFrom(b.title),
    href: `/content-studio/blogs/${b.id}`,
    updatedAt: b.updatedAt,
    status,
    meta: readMin ? `${readMin} min read` : "Draft",
    coverImageUrl: b.coverImageUrl ?? null,
  };
}

function adToItem(a: AdCreativeView): ContentItem {
  const feed = a.versions[0]?.images["4:5"]?.renderFilename ?? null;
  const status: ContentStatus =
    a.status === "writing"
      ? { label: "Making", tone: "info" }
      : a.status === "failed"
        ? { label: "Failed", tone: "danger" }
        : { label: "Ad", tone: "neutral" };
  return {
    kind: "ad",
    id: a.id,
    title: titleFrom(a.name),
    href: `/content-studio/ads/${a.id}`,
    updatedAt: new Date(a.updatedAt),
    status,
    meta: `${a.kind === "video" ? "Video ad" : "Image ad"} · ${a.versions.length || 3} versions`,
    aspectRatio: "4:5",
    imageUrl: feed ? renderFileUrl(feed) : null,
  };
}

/** Every piece of content across the tools, newest-updated first. */
export function listRecentWork(): ContentItem[] {
  const items: ContentItem[] = [
    ...listProjects().map(videoToItem),
    ...listCarousels().map(carouselToItem),
    ...listBlogPosts().map(blogToItem),
    ...listAdCreatives().map(adToItem),
  ];
  return items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/** Per-kind counts for the filter tabs (All is the total). */
export function countByKind(items: ContentItem[]): Record<ContentKind, number> {
  return {
    video: items.filter((i) => i.kind === "video").length,
    image: items.filter((i) => i.kind === "image").length,
    blog: items.filter((i) => i.kind === "blog").length,
    ad: items.filter((i) => i.kind === "ad").length,
  };
}
