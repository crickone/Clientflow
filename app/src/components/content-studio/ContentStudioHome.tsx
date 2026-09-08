"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Play,
  Plus,
  Video,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ImageLibraryAsset } from "@/lib/db/schema";
import type { BrandLabels } from "@/lib/image/paintSlide";
import type {
  ContentItem,
  ContentKind,
  ContentTone,
} from "@/lib/content-studio/recentWork";
import { SlideCanvas, useCanvasFonts, useLogoImage } from "./SlideCanvas";
import type { DesignSystem } from "@/lib/design/parse";
import { LazyMount } from "./LazyMount";

interface Props {
  items: ContentItem[];
  counts: Record<ContentKind, number>;
  /** Inputs for the carousel thumbnails' shared canvas render. */
  library: ImageLibraryAsset[];
  brand?: BrandLabels;
  defaultHeadingFontId: string;
  defaultBodyFontId: string;
  logoUrl: string | null;
  /** The tenant's design system, so AI-composed slides render in the grid
   *  too. Null for a tenant with none. */
  designSystem?: DesignSystem | null;
}

type Filter = "all" | ContentKind;

const KIND_LABEL: Record<ContentKind, string> = {
  video: "Reel",
  image: "Carousel",
  blog: "Blog",
};

const CREATE = [
  { href: "/content-studio/videos/new", Icon: Video, title: "New video", sub: "Upload a clip → auto-captioned reel" },
  { href: "/content-studio/images/new", Icon: ImageIcon, title: "New image", sub: "Pick a template, build a carousel" },
  { href: "/content-studio/blogs/new", Icon: FileText, title: "New blog", sub: "Draft a post from a prompt" },
] as const;

const TONE_COLOR: Record<ContentTone, string> = {
  neutral: "var(--text-tertiary)",
  info: "var(--info)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

function relTime(d: Date): string {
  // `new Date(d)` tolerates either a Date or an ISO string (RSC prop serialization).
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "Yesterday";
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString("en-IE", { day: "2-digit", month: "short" });
}

/** Dark-glass status chip that stays legible over any thumbnail (photo or canvas). */
function StatusChip({ item }: { item: ContentItem }) {
  const { tone, label } = item.status;
  return (
    <span className="cs-chip">
      <i
        className={tone === "info" ? "badge-dot-pulse" : undefined}
        style={{ width: 6, height: 6, borderRadius: "50%", background: TONE_COLOR[tone], flexShrink: 0 }}
      />
      {label}
    </span>
  );
}

function Thumb({
  item,
  library,
  brand,
  defaultHeadingFontId,
  defaultBodyFontId,
  fontsReady,
  logo,
  system,
}: {
  item: ContentItem;
  library: ImageLibraryAsset[];
  brand?: BrandLabels;
  defaultHeadingFontId: string;
  defaultBodyFontId: string;
  fontsReady: boolean;
  logo: HTMLImageElement | null;
  /** The tenant's design system, for AI-composed slides. */
  system: DesignSystem | null;
}) {
  if (item.kind === "image" && item.firstSlide) {
    const slide = item.firstSlide;
    return (
      <LazyMount placeholder={<div style={{ width: "100%", height: "100%", background: "var(--surface-2)" }} />}>
        <SlideCanvas
          slide={slide}
          slideIdx={0}
          total={item.slideCount ?? 1}
          library={library}
          fontsReady={fontsReady}
          defaultHeadingFontId={defaultHeadingFontId}
          defaultBodyFontId={defaultBodyFontId}
          brand={brand}
          logo={logo}
          system={system}
        />
      </LazyMount>
    );
  }
  if (item.kind === "video") {
    if (item.videoPosterUrl) {
      return (
        <>
          {/* #t seeks to a frame so the element posters itself without a separate image */}
          <video src={`${item.videoPosterUrl}#t=0.5`} preload="metadata" muted playsInline />
          <div className="cs-play"><span><Play size={17} fill="currentColor" /></span></div>
        </>
      );
    }
    return (
      <div className="cs-ph" style={{ background: "linear-gradient(160deg, #18202b, #24384d 55%, #365a78)" }}>
        <div className="cs-play"><span><Play size={17} fill="currentColor" /></span></div>
      </div>
    );
  }
  // blog
  if (item.coverImageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.coverImageUrl} alt="" />;
  }
  return (
    <div className="cs-ph" style={{ background: "linear-gradient(150deg, var(--surface-2), var(--surface-3))" }}>
      <div className="cs-ph-t">{item.title}</div>
    </div>
  );
}

export function ContentStudioHome({
  items,
  counts,
  library,
  brand,
  defaultHeadingFontId,
  defaultBodyFontId,
  logoUrl,
  designSystem = null,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const fontsReady = useCanvasFonts();
  const logo = useLogoImage(logoUrl);

  const shown = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.kind === filter)),
    [filter, items],
  );

  const FILTERS: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "All", n: items.length },
    { key: "video", label: "Videos", n: counts.video },
    { key: "image", label: "Images", n: counts.image },
    { key: "blog", label: "Blogs", n: counts.blog },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Content Studio"
        title="Content Studio"
        subtitle="Make a reel, a carousel, or a blog — then find everything you've made in one place."
      />

      <div className="cs-create">
        {CREATE.map(({ href, Icon, title, sub }) => (
          <Link key={href} href={href} className="cs-tile">
            <span className="cs-tile-ic"><Icon size={20} strokeWidth={1.7} /></span>
            <span style={{ display: "block", minWidth: 0 }}>
              <span className="cs-tile-t">{title}</span>
              <span className="cs-tile-s">{sub}</span>
            </span>
            <span className="cs-tile-plus"><Plus size={18} /></span>
          </Link>
        ))}
      </div>

      <div className="cs-filter" role="tablist" aria-label="Filter content by type">
        {FILTERS.map(({ key, label, n }) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className="cs-n">{n}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={<ImageIcon size={32} strokeWidth={1.4} />}
          title="Nothing here yet"
          message="Start with a video, an image, or a blog above — everything you make lands here."
        />
      ) : (
        <div className="cs-grid">
          {shown.map((item) => (
            <Link key={`${item.kind}-${item.id}`} href={item.href} className="cs-card">
              <div className="cs-thumb">
                <Thumb
                  item={item}
                  library={library}
                  brand={brand}
                  defaultHeadingFontId={defaultHeadingFontId}
                  defaultBodyFontId={defaultBodyFontId}
                  fontsReady={fontsReady}
                  logo={logo}
                  system={designSystem}
                />
                <div className="cs-thumb-ov">
                  <div className="cs-thumb-top"><StatusChip item={item} /></div>
                </div>
              </div>
              <div className="cs-card-body">
                <h3 className="cs-card-title">{item.title}</h3>
                <div className="cs-card-meta">
                  <span>{KIND_LABEL[item.kind]}</span>
                  <span className="cs-sep">·</span>
                  <span>{item.meta}</span>
                  <span className="cs-sep">·</span>
                  <span>{relTime(item.updatedAt)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
