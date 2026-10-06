"use client";

import { useMemo } from "react";
import { Heart, MessageCircle, MoreHorizontal, Send } from "lucide-react";

import type { CarouselSlide, ImageLibraryAsset } from "@/lib/db/schema";
import type { BrandLabels } from "@/lib/image/paintSlide";
import { TEMPLATES } from "@/lib/image/templates";
import { titleFrom } from "@/lib/content-studio/title";
import { SlideCanvas, useCanvasFonts, useLogoImage } from "./SlideCanvas";

/**
 * The post as it will sit in an Instagram feed, while it is still a sentence
 * in a box: the topic's first line painted on a real slide (the same
 * renderer the editor and export use, with the business's fonts, logo, accent
 * and a photo from its library), framed by the feed chrome around it. A
 * carousel shows the next slide peeking in and the swipe dots; a single post
 * is one square.
 *
 * It is a sketch of the shape, not the finished design: Adonis writes the
 * real slides, and for a business with a design system lays them out too.
 */
const PREVIEW_TEMPLATE = TEMPLATES.find((t) => t.id === "bold-headline") ?? TEMPLATES[0];

export function PostPreview({
  topic,
  carousel,
  slides,
  library,
  brand,
  businessName,
  defaultHeadingFontId,
  defaultBodyFontId,
  logoUrl,
  accentColor,
}: {
  topic: string;
  carousel: boolean;
  slides: number;
  library: ImageLibraryAsset[];
  brand?: BrandLabels;
  businessName: string;
  defaultHeadingFontId: string;
  defaultBodyFontId: string;
  logoUrl: string | null;
  accentColor?: string;
}) {
  const fontsReady = useCanvasFonts();
  const logo = useLogoImage(logoUrl);
  const photoId = useMemo(() => library.find((a) => (a as { kind?: string }).kind !== "video" && (a as { kind?: string }).kind !== "file")?.id ?? null, [library]);
  const headline = titleFrom(topic, 90);
  const handle = (businessName || "yourbusiness").toLowerCase().replace(/[^a-z0-9]+/g, "");
  // Instagram shows a place, not an address: the town, which is the part
  // before the county ("Ard Gaoithe Business Park, Clonmel, Co. Tipperary").
  const parts = (brand?.location ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const place = parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? "";

  const slide = {
    id: -1,
    templateId: PREVIEW_TEMPLATE.id,
    aspectRatio: PREVIEW_TEMPLATE.aspectRatio,
    headingText: headline || "Your topic appears here as you type",
    // A space, not empty: an empty body paints the editor's "supporting copy
    // goes here" hint, which has no place in a preview.
    bodyText: " ",
    tagline: null,
    accentColor: accentColor ?? "#2c6ce0",
    // Under the photo, and in place of it when there is none or it has not
    // loaded: a plain dark ground, never the editor's
    // "drop a photo" placeholder.
    backgroundColor: "#16171a",
    backgroundAssetId: photoId,
    backgroundFit: "cover",
    backgroundOffsetX: 0.5,
    backgroundOffsetY: 0.45,
    backgroundZoom: 1,
    headingScale: 1,
  } as unknown as CarouselSlide;

  return (
    <aside className="pp" aria-label="Preview">
      <div className="pp-label">Preview</div>
      <div className="pp-phone">
        <div className="pp-head">
          <span className="pp-avatar">
            {logoUrl ? <img src={logoUrl} alt="" /> : (businessName || "Y").slice(0, 1)}
          </span>
          <span className="pp-who">
            <span className="pp-handle">{handle}</span>
            {place && <span className="pp-loc">{place}</span>}
          </span>
          <MoreHorizontal size={18} />
        </div>
        <div className={carousel ? "pp-media is-carousel" : "pp-media"}>
          <div className={headline ? "pp-slide" : "pp-slide is-empty"}>
            <SlideCanvas
              slide={slide}
              slideIdx={0}
              total={carousel ? slides : 1}
              library={library}
              fontsReady={fontsReady}
              defaultHeadingFontId={defaultHeadingFontId}
              defaultBodyFontId={defaultBodyFontId}
              brand={brand}
              logo={logo}
            />
          </div>
          {carousel && <div className="pp-peek" aria-hidden />}
        </div>
        <div className="pp-actions">
          <span className="pp-icons" aria-hidden>
            <Heart size={21} />
            <MessageCircle size={21} />
            <Send size={21} />
          </span>
          {carousel && (
            <span className="pp-dots" aria-label={`${slides} slides`}>
              {Array.from({ length: slides }, (_, i) => (
                <i key={i} className={i === 0 ? "is-on" : undefined} />
              ))}
            </span>
          )}
          <span className="pp-icons-spacer" />
        </div>
        <div className="pp-caption">
          <b>{handle}</b> {headline ? "Adonis writes the caption with the post." : ""}
        </div>
      </div>
      <p className="pp-note">A sketch of the shape. Adonis writes and designs the real {carousel ? "slides" : "post"}.</p>
    </aside>
  );
}
