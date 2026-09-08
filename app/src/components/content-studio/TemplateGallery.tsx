"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import type { CarouselSlide, ImageLibraryAsset } from "@/lib/db/schema";
import {
  CATEGORIES,
  templatesByCategory,
  type Template,
  type TemplateCategory,
} from "@/lib/image/templates";
import type { BrandLabels } from "@/lib/image/paintSlide";
import { DEFAULT_CAROUSEL_SLOT, DEFAULT_SLOT } from "@/lib/image/slots";
import { LazyMount } from "./LazyMount";
import { SlideCanvas, useCanvasFonts, useLogoImage } from "./SlideCanvas";

/**
 * Every fixed template, shown as what it actually looks like.
 *
 * The thumbnails are REAL RENDERS: each is a full paintSlide through
 * SlideCanvas with representative content, the tenant's own brand labels,
 * fonts and logo, and a photograph from their library where the template wants
 * one. A picture of a template is the only honest way to choose between forty
 * of them, and painting them through the same function the export uses means a
 * template can never look one way here and another in the editor.
 *
 * Each is shown at ITS OWN aspect ratio. The home grid crops everything to
 * 4:3, which mangles the 9:16 stories — a known problem from that build, and
 * not one to repeat in the place whose entire job is showing what a template
 * looks like.
 */

/** Content chosen to exercise a template rather than flatter it: a heading
 *  long enough to wrap, a body with two sentences and a newline for the
 *  templates that read lines, and a tagline for the ones that use one. */
const SAMPLE: Pick<
  CarouselSlide,
  "headingText" | "bodyText" | "tagline" | "accentColor"
> = {
  headingText: "Feel stronger in ninety days, not someday",
  bodyText:
    "Three sessions a week, built around your own numbers.\nA coach who checks in.",
  tagline: "WHERE TO START",
  accentColor: "#2c6ce0",
};

function sampleSlide(
  template: Template,
  backgroundAssetId: number | null,
  accentColor: string,
): CarouselSlide {
  return {
    id: -1,
    templateId: template.id,
    aspectRatio: template.aspectRatio,
    headingText: template.headingHighlight
      ? "Feel *stronger* in ninety days, not someday"
      : SAMPLE.headingText,
    bodyText: SAMPLE.bodyText,
    tagline: template.usesTagline ? (template.taglineHint ?? SAMPLE.tagline) : null,
    accentColor,
    backgroundColor: null,
    backgroundAssetId: template.requiresPhoto || template.acceptsPhoto
      ? backgroundAssetId
      : null,
    backgroundFit: "cover",
    backgroundOffsetX: 0.5,
    backgroundOffsetY: 0.45,
    backgroundZoom: 1,
    headingScale: 1,
  } as CarouselSlide;
}

export function TemplateGallery({
  library,
  brand,
  defaultHeadingFontId,
  defaultBodyFontId,
  logoUrl,
  accentColor = SAMPLE.accentColor,
}: {
  library: ImageLibraryAsset[];
  brand?: BrandLabels;
  defaultHeadingFontId: string;
  defaultBodyFontId: string;
  logoUrl: string | null;
  /** The tenant's accent, so the gallery shows their colour, not ours. */
  accentColor?: string;
}) {
  const router = useRouter();
  const fontsReady = useCanvasFonts();
  const logo = useLogoImage(logoUrl);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One photograph, reused across every template that shows one, so the
  // gallery reads as one set rather than a scrapbook.
  const sampleAssetId = useMemo(() => {
    const image = library.find(
      (a) => (a as { kind?: string }).kind !== "video",
    );
    return image?.id ?? null;
  }, [library]);

  async function startFrom(template: Template) {
    setStarting(template.id);
    setError(null);
    const carousel = template.category === "carousels";
    const d = await fetch("/api/content-studio/carousels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: template.name,
        seedSlotKey: carousel ? DEFAULT_CAROUSEL_SLOT : DEFAULT_SLOT,
        seedTemplateId: template.id,
        seedSlideCount: 1,
      }),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (!d?.ok) {
      setError(d?.error ?? "Couldn't start a design from that template.");
      setStarting(null);
      return;
    }
    router.push(`/content-studio/images/${d.carouselId}`);
  }

  return (
    <div>
      <p
        style={{
          margin: "0 0 22px",
          fontSize: 13.5,
          color: "var(--text-secondary)",
          maxWidth: "62ch",
        }}
      >
        Pick a look and write the copy yourself. Every thumbnail is a real
        render with your brand, so what you see is what you get.
      </p>

      {error && (
        <div style={{ marginBottom: 16, fontSize: 13, color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {CATEGORIES.map((category) => (
        <Category
          key={category.id}
          id={category.id}
          label={category.label}
          blurb={category.blurb}
          library={library}
          brand={brand}
          defaultHeadingFontId={defaultHeadingFontId}
          defaultBodyFontId={defaultBodyFontId}
          fontsReady={fontsReady}
          logo={logo}
          sampleAssetId={sampleAssetId}
          accentColor={accentColor}
          starting={starting}
          onStart={startFrom}
        />
      ))}
    </div>
  );
}

function Category({
  id,
  label,
  blurb,
  library,
  brand,
  defaultHeadingFontId,
  defaultBodyFontId,
  fontsReady,
  logo,
  sampleAssetId,
  accentColor,
  starting,
  onStart,
}: {
  id: TemplateCategory;
  label: string;
  blurb: string;
  library: ImageLibraryAsset[];
  brand?: BrandLabels;
  defaultHeadingFontId: string;
  defaultBodyFontId: string;
  fontsReady: boolean;
  logo: HTMLImageElement | null;
  sampleAssetId: number | null;
  accentColor: string;
  starting: string | null;
  onStart: (template: Template) => void;
}) {
  const templates = templatesByCategory(id);
  if (templates.length === 0) return null;
  return (
    <section style={{ marginBottom: 34 }}>
      <h2
        style={{
          margin: "0 0 2px",
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: "-0.01em",
        }}
      >
        {label}
      </h2>
      <p
        style={{
          margin: "0 0 14px",
          fontSize: 12.5,
          color: "var(--text-tertiary)",
        }}
      >
        {blurb} · {templates.length} template{templates.length === 1 ? "" : "s"}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onStart(template)}
            disabled={starting !== null}
            title={template.blurb}
            style={{
              display: "block",
              textAlign: "left",
              padding: 0,
              background: "none",
              border: "none",
              cursor: starting ? "progress" : "pointer",
              fontFamily: "inherit",
              color: "inherit",
              opacity: starting && starting !== template.id ? 0.5 : 1,
            }}
          >
            <div
              style={{
                borderRadius: "var(--radius)",
                overflow: "hidden",
                position: "relative",
                // No fixed aspect ratio here: the canvas carries its own, so a
                // 9:16 story is tall and a 4:5 post is not cropped square.
              }}
            >
              <LazyMount
                placeholder={
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: template.aspectRatio.replace(":", " / "),
                      background: "var(--surface-2)",
                      borderRadius: "var(--radius)",
                    }}
                  />
                }
              >
                <SlideCanvas
                  slide={sampleSlide(template, sampleAssetId, accentColor)}
                  slideIdx={0}
                  total={5}
                  library={library}
                  fontsReady={fontsReady}
                  defaultHeadingFontId={defaultHeadingFontId}
                  defaultBodyFontId={defaultBodyFontId}
                  brand={brand}
                  logo={logo}
                />
              </LazyMount>
              {starting === template.id && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(10,10,10,0.55)",
                  }}
                >
                  <Loader2 size={20} className="spin" color="#fff" />
                </div>
              )}
            </div>
            <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600 }}>
              {template.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
              {template.aspectRatio}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
