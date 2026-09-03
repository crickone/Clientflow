"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import JSZip from "jszip";
import {
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/Dialog";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Tooltip } from "@/components/ui/Tooltip";
import type {
  CarouselSlide,
  ImageLibraryAsset,
} from "@/lib/db/schema";
import {
  CATEGORIES,
  getTemplate,
  templatesByCategory,
  type Template,
  type TemplateCategory,
} from "@/lib/image/templates";
import {
  DEFAULT_BODY_FONT_ID,
  DEFAULT_HEADING_FONT_ID,
  FONT_OPTIONS,
  resolveCanvasFont,
} from "@/lib/image/fonts";
import {
  autoTagline,
  libraryFileUrl,
  padNumber,
  paintSlide,
  type BrandLabels,
} from "@/lib/image/paintSlide";
import { SlideCanvas, useCanvasFonts, useLogoImage } from "./SlideCanvas";

const ACCENT_SWATCHES = [
  "#2c6ce0",
  "#d2691e",
  "#c9a24c", // gold
  "#8a3fd1",
  "#0a0a0a",
  "#15803d",
  "#dc2626",
];

// Solid background colours (incl. gold) offered as quick swatches.
const BACKGROUND_SWATCHES = [
  "#0a0a0a",
  "#16161a",
  "#c9a24c", // gold
  "#1a2a4a",
  "#14532d",
  "#7c1d1d",
  "#f4f1ea",
];

interface Props {
  designId: number;
  initialName: string;
  initialSlides: CarouselSlide[];
  initialLibrary: ImageLibraryAsset[];
  /** Account-level brand fonts (Branding settings); used for slides with no override. */
  defaultHeadingFontId?: string;
  defaultBodyFontId?: string;
  /** Brand labels drawn on the templates (from the account's Business Profile). */
  brand?: BrandLabels;
  /** Whether AI background generation is configured (FAL_KEY set) — gates the AI panel + related UI. */
  imageGenEnabled?: boolean;
  /** Same-origin URL of the tenant's uploaded logo (`getChromeLogoSrc()`), or null when none is uploaded. */
  logoUrl?: string | null;
  /** Whether this design currently draws the logo on its slides (persisted per-design). */
  initialShowLogo?: boolean;
}

export function ImageDesigner({
  designId,
  initialName,
  initialSlides,
  initialLibrary,
  defaultHeadingFontId = DEFAULT_HEADING_FONT_ID,
  defaultBodyFontId = DEFAULT_BODY_FONT_ID,
  brand,
  imageGenEnabled = false,
  logoUrl = null,
  initialShowLogo = true,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [name, setName] = useState(initialName);
  const [slides, setSlides] = useState<CarouselSlide[]>(initialSlides);
  const [activeIdx, setActiveIdx] = useState(0);
  const [library, setLibrary] = useState<ImageLibraryAsset[]>(initialLibrary);
  // Backgrounds can only be images — videos in the shared library are excluded
  // from the picker (they live in the Library tab and the video editor).
  const imageLibrary = library.filter(
    (a) => (a as { kind?: string }).kind !== "video",
  );
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportingZip, setExportingZip] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState<
    "slot" | "slide" | "caption" | null
  >(null);
  const [captionCopied, setCaptionCopied] = useState(false);

  const fontsReady = useCanvasFonts();

  // Tenant logo overlay — loaded once client-side (same-origin, so the export
  // canvas stays untainted) and drawn on every slide when showLogo is on.
  const [showLogo, setShowLogo] = useState(initialShowLogo);
  const logoImg = useLogoImage(logoUrl);

  /**
   * Resolve per-slide font families for canvas. Falls back to the Renova
   * defaults (Nebula heading, Hanken Grotesk body) when the slide doesn't
   * override them.
   */
  const slideFonts = useCallback(
    (slide: CarouselSlide | null | undefined) => ({
      heading: resolveCanvasFont(
        slide?.headingFont,
        defaultHeadingFontId,
      ),
      body: resolveCanvasFont(slide?.bodyFont, defaultBodyFontId),
    }),
    [defaultHeadingFontId, defaultBodyFontId],
  );

  // Active slot. A "slot" lets a single design hold multiple independent
  // carousels — each keyed by a carousel template (cover / content / cta /
  // tip / quote / question-hook). Switching slots preserves whatever's in
  // the other slots.
  const initialSlot =
    initialSlides.find((s) => s.slotKey !== "default")?.slotKey ??
    initialSlides[0]?.slotKey ??
    "default";
  const [activeSlot, setActiveSlot] = useState<string>(initialSlot);

  // Slides in the current slot only.
  const slidesInSlot = useMemo(
    () => slides.filter((s) => s.slotKey === activeSlot),
    [slides, activeSlot],
  );
  const total = slidesInSlot.length;
  const isCarousel = total > 1;
  const activeSlide = slidesInSlot[activeIdx] ?? null;

  // Slide counts per slot (used for badges on the Carousels template cards).
  const slotCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of slides) {
      counts[s.slotKey] = (counts[s.slotKey] ?? 0) + 1;
    }
    return counts;
  }, [slides]);

  // Clamp activeIdx when the slot or slide count changes.
  useEffect(() => {
    if (activeIdx >= slidesInSlot.length) {
      setActiveIdx(Math.max(0, slidesInSlot.length - 1));
    }
  }, [activeSlot, slidesInSlot.length, activeIdx]);

  const updateActiveSlide = useCallback(
    (patch: Partial<CarouselSlide>) => {
      if (!activeSlide) return;
      const slideId = activeSlide.id;
      setSlides((prev) =>
        prev.map((s) => (s.id === slideId ? { ...s, ...patch } : s)),
      );
    },
    [activeSlide],
  );

  // A MANUAL background change resolves any pending AI generation for the
  // active slide: clear image_status locally (kills the poll's merge guard +
  // the chip) and persist that resolution immediately — the detached queue
  // checks it before writing, so the user's pick wins over a late AI result.
  const setSlideBackgroundManually = useCallback(
    (backgroundAssetId: number | null) => {
      if (!activeSlide) return;
      const wasGenerating = activeSlide.imageStatus === "generating";
      updateActiveSlide(
        wasGenerating
          ? { backgroundAssetId, imageStatus: null, imageError: null }
          : { backgroundAssetId },
      );
      if (wasGenerating) {
        void fetch(
          `/api/content-studio/carousels/${designId}/slides/${activeSlide.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageStatus: null }),
          },
        ).catch(() => {});
      }
    },
    [activeSlide, designId, updateActiveSlide],
  );

  // Auto-save active slide (debounced)
  const lastSavedRef = useRef<Record<number, string>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeSlide) return;
    const snapshot = JSON.stringify({
      templateId: activeSlide.templateId,
      aspectRatio: activeSlide.aspectRatio,
      headingText: activeSlide.headingText,
      bodyText: activeSlide.bodyText,
      tagline: activeSlide.tagline,
      headingFont: activeSlide.headingFont,
      bodyFont: activeSlide.bodyFont,
      accentColor: activeSlide.accentColor,
      backgroundColor: activeSlide.backgroundColor,
      // backgroundAssetId's inclusion here is load-bearing for the
      // manual-pick-wins convergence — see setSlideBackgroundManually.
      backgroundAssetId: activeSlide.backgroundAssetId,
      backgroundFit: activeSlide.backgroundFit,
      backgroundOffsetX: activeSlide.backgroundOffsetX,
      backgroundOffsetY: activeSlide.backgroundOffsetY,
      backgroundZoom: activeSlide.backgroundZoom,
    });
    if (lastSavedRef.current[activeSlide.id] === snapshot) return;
    setSaveStatus("idle");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const res = await fetch(
          `/api/content-studio/carousels/${designId}/slides/${activeSlide.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: snapshot,
          },
        );
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Save failed.");
        lastSavedRef.current[activeSlide.id] = snapshot;
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 1500);
      } catch (err) {
        setSaveStatus("error");
        setActionError(err instanceof Error ? err.message : "Save failed.");
      }
    }, 600);
  }, [activeSlide, designId]);

  // Auto-save design name (debounced)
  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedNameRef = useRef(initialName);
  useEffect(() => {
    if (name === lastSavedNameRef.current) return;
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current);
    nameTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/content-studio/carousels/${designId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const json = await res.json();
        if (res.ok && json.ok) {
          lastSavedNameRef.current = name;
          router.refresh();
        }
      } catch {}
    }, 700);
  }, [name, designId, router]);

  // Poll while any slide's AI background is generating — the detached server
  // queue flips image_status/backgroundAssetId as each image completes. Merge
  // ONLY the generation-owned fields; backgroundAssetId only while the local
  // slide is still 'generating' (a manual pick mid-flight wins). These fields
  // are NOT in the auto-save snapshot, so polling never fights the debounce.
  const libraryRef = useRef(library);
  useEffect(() => {
    libraryRef.current = library;
  }, [library]);
  const anyGenerating = slides.some((s) => s.imageStatus === "generating");
  useEffect(() => {
    if (!anyGenerating) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/content-studio/carousels/${designId}`);
        const json = await res.json();
        if (stopped || !res.ok || !json.ok) return;
        const server: CarouselSlide[] = json.carousel?.slides ?? [];
        const byId = new Map(server.map((s) => [s.id, s]));
        // Hydrate newly-generated assets we don't have locally yet.
        const known = new Set(libraryRef.current.map((a) => a.id));
        const missing = Array.from(
          new Set(
            server
              .map((s) => s.backgroundAssetId)
              .filter((id): id is number => id != null && !known.has(id)),
          ),
        );
        for (const id of missing) {
          try {
            const ares = await fetch(`/api/content-studio/image-library/${id}`);
            const ajson = await ares.json();
            if (!stopped && ares.ok && ajson.ok && ajson.asset) {
              setLibrary((prev) =>
                prev.some((a) => a.id === ajson.asset.id) ? prev : [ajson.asset, ...prev],
              );
            }
          } catch {}
        }
        if (stopped) return;
        setSlides((prev) =>
          prev.map((s) => {
            const sv = byId.get(s.id);
            if (!sv) return s;
            const patch: Partial<CarouselSlide> = {
              imageStatus: sv.imageStatus,
              imageError: sv.imageError,
              imagePrompt: sv.imagePrompt,
            };
            if (s.imageStatus === "generating" && sv.backgroundAssetId != null) {
              patch.backgroundAssetId = sv.backgroundAssetId;
            }
            return { ...s, ...patch };
          }),
        );
      } catch {}
    };
    const iv = setInterval(tick, 2500);
    tick();
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [anyGenerating, designId]);

  async function addSlide() {
    setActionError(null);
    try {
      const lastInSlot = slidesInSlot[slidesInSlot.length - 1];
      // Pick a sensible template default. Within carousel slots, prefer the
      // matching content template; outside, mirror the slot's last slide.
      let templateId = lastInSlot?.templateId ?? "carousel-content";
      if (activeSlot.startsWith("carousel-") || activeSlot === "question-hook") {
        templateId =
          slidesInSlot.length === 0
            ? activeSlot
            : "carousel-content";
      }
      const res = await fetch(
        `/api/content-studio/carousels/${designId}/slides`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slotKey: activeSlot,
            templateId,
            aspectRatio: lastInSlot?.aspectRatio ?? "1:1",
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok)
        throw new Error(json.error || "Couldn't add slide.");
      const newSlide = json.slide as CarouselSlide;
      setSlides((prev) => [...prev, newSlide]);
      setActiveIdx(slidesInSlot.length);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't add slide.");
    }
  }

  async function deleteSlide() {
    if (!activeSlide) return;
    if (slidesInSlot.length <= 1) {
      setActionError(
        "This slot needs at least one slide. Use 'Delete design' to remove the design, or switch slots.",
      );
      return;
    }
    if (!(await confirm({ title: "Delete this slide?", destructive: true }))) return;
    try {
      const res = await fetch(
        `/api/content-studio/carousels/${designId}/slides/${activeSlide.id}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Couldn't delete.");
      setSlides((prev) => prev.filter((s) => s.id !== activeSlide.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't delete.");
    }
  }

  // ---------------------------------------------------------------------
  //  Caption — lives on slide[0] of the active slot. We read / write through
  //  that slide so the existing slide save pipeline carries the changes.
  // ---------------------------------------------------------------------
  const captionSlide = slidesInSlot[0] ?? null;
  const caption = captionSlide?.caption ?? "";

  function updateCaption(next: string) {
    if (!captionSlide) return;
    const id = captionSlide.id;
    setSlides((prev) =>
      prev.map((s) => (s.id === id ? { ...s, caption: next } : s)),
    );
  }

  // Caption auto-save (independent of active slide editing).
  const lastSavedCaptionRef = useRef<Record<number, string>>({});
  const captionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!captionSlide) return;
    const id = captionSlide.id;
    const value = captionSlide.caption;
    if (lastSavedCaptionRef.current[id] === value) return;
    if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
    captionTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/content-studio/carousels/${designId}/slides/${id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caption: value }),
          },
        );
        const json = await res.json();
        if (res.ok && json.ok) {
          lastSavedCaptionRef.current[id] = value;
        }
      } catch (err) {
        console.error("[caption] auto-save failed:", err);
      }
    }, 700);
  }, [captionSlide?.id, captionSlide?.caption, designId]);

  async function copyCaption() {
    if (!caption.trim()) return;
    try {
      await navigator.clipboard.writeText(caption);
      setCaptionCopied(true);
      setTimeout(() => setCaptionCopied(false), 1600);
    } catch {
      setActionError("Couldn't copy the caption.");
    }
  }

  async function refreshCaption() {
    if (!captionSlide) return;
    setRefreshing("caption");
    setActionError(null);
    try {
      const res = await fetch(
        `/api/content-studio/carousels/${designId}/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slotKey: activeSlot, captionOnly: true }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok)
        throw new Error(json.error || "Couldn't refresh the caption.");
      const newSlides = json?.carousel?.slides;
      if (Array.isArray(newSlides)) {
        lastSavedCaptionRef.current = {};
        setSlides(newSlides as CarouselSlide[]);
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Couldn't refresh the caption.",
      );
    } finally {
      setRefreshing(null);
    }
  }

  async function refreshContent(scope: "slot" | "slide") {
    if (!activeSlide) return;
    setRefreshing(scope);
    setActionError(null);
    try {
      const body: Record<string, unknown> = { slotKey: activeSlot };
      if (scope === "slide") body.slideIds = [activeSlide.id];
      const res = await fetch(
        `/api/content-studio/carousels/${designId}/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Couldn't refresh content.");
      }
      const newSlides = json?.carousel?.slides;
      if (!Array.isArray(newSlides)) {
        throw new Error("Refresh returned no slides.");
      }
      // Clear save snapshots — server changed heading/body so local PATCH
      // diffing should pick up the new state as 'clean'.
      lastSavedRef.current = {};
      setSlides(newSlides as CarouselSlide[]);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Couldn't refresh content.",
      );
    } finally {
      setRefreshing(null);
    }
  }

  async function deleteDesign() {
    if (!(await confirm({ title: "Delete this design?", body: "This can't be undone.", destructive: true }))) return;
    try {
      const res = await fetch(`/api/content-studio/carousels/${designId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Couldn't delete.");
      router.push("/content-studio/images");
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't delete.");
    }
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setActionError(null);
    try {
      const fd = new FormData();
      for (const file of files) {
        fd.append("file", file);
        const dims = await readImageDimensions(file);
        fd.append("width", String(dims?.width ?? 0));
        fd.append("height", String(dims?.height ?? 0));
      }
      const res = await fetch("/api/content-studio/image-library", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Upload failed.");
      const newAssets = json.assets as ImageLibraryAsset[];
      setLibrary((prev) => [...newAssets, ...prev]);
      if (newAssets.length > 0) {
        setSlideBackgroundManually(newAssets[0].id);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function deleteAsset(assetId: number) {
    if (!(await confirm({ title: "Remove this photo from the library?", destructive: true }))) return;
    try {
      const res = await fetch(`/api/content-studio/image-library/${assetId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Couldn't delete.");
      setLibrary((prev) => prev.filter((a) => a.id !== assetId));
      if (activeSlide?.backgroundAssetId === assetId) {
        setSlideBackgroundManually(null);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't delete.");
    }
  }

  async function exportCurrentSlide() {
    if (!activeSlide || !fontsReady) return;
    const template = getTemplate(activeSlide.templateId);
    const blob = await renderSlideToBlob(
      activeSlide,
      activeIdx,
      total,
      library,
      slideFonts(activeSlide),
      brand,
      showLogo ? logoImg : null,
    );
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug =
      (name || `renova-${template?.id ?? "design"}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "renova";
    a.download = isCarousel
      ? `${padNumber(activeIdx + 1, 2)}-${slug}.png`
      : `${slug}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportAllAsZip() {
    if (!fontsReady) return;
    setExportingZip(true);
    setActionError(null);
    try {
      const zip = new JSZip();
      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || `design-${designId}`;
      for (let i = 0; i < slidesInSlot.length; i++) {
        const blob = await renderSlideToBlob(
          slidesInSlot[i],
          i,
          slidesInSlot.length,
          library,
          slideFonts(slidesInSlot[i]),
          brand,
          showLogo ? logoImg : null,
        );
        if (blob) {
          zip.file(`${padNumber(i + 1, 2)}-${slug}.png`, blob);
        }
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportingZip(false);
    }
  }

  const template = useMemo(
    () => (activeSlide ? getTemplate(activeSlide.templateId) : null),
    [activeSlide],
  );

  const [activeCategory, setActiveCategory] = useState<TemplateCategory>(
    (template?.category as TemplateCategory) ?? "social",
  );

  // The first existing carousel slot, or the canonical one for a new carousel.
  const carouselSlotFor = useCallback(
    () =>
      slides.find(
        (s) => s.slotKey.startsWith("carousel-") || s.slotKey === "question-hook",
      )?.slotKey ?? "carousel-content",
    [slides],
  );

  // Switching a format tab maps to a slot: single-image formats (Social Posts,
  // Stories, Testimonials, Promos, Educational) all live in the "default" slot;
  // carousels live in a carousel slot. This keeps a generated carousel in the
  // Carousels tab and stops a single-image format from being applied to — and
  // getting stuck on — the carousel.
  const selectCategory = useCallback(
    (cat: TemplateCategory) => {
      setActiveCategory(cat);
      setActiveIdx(0);
      setActiveSlot(cat === "carousels" ? carouselSlotFor() : "default");
    },
    [carouselSlotFor],
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // We DON'T early-return when activeSlide is null — the slot may simply be
  // empty (e.g. the user clicked a Carousels template card for the first
  // time). The toolbar + template picker stay visible so the user can switch
  // slots or hit Generate.
  const previewMaxWidth = template?.aspectRatio === "9:16" ? 320 : 460;
  const isEmptySlot = !activeSlide || !template;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Top toolbar */}
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 280 }}>
          <Label htmlFor="design-name">Design name</Label>
          <Input
            id="design-name"
            value={name}
            placeholder="e.g. Welcome offer · IG square"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingTop: 22,
          }}
        >
          <SaveStatus status={saveStatus} />
          <GenerateCarouselButton
            designId={designId}
            slotKey={
              activeSlot.startsWith("carousel-") || activeSlot === "question-hook"
                ? activeSlot
                : carouselSlotFor()
            }
            defaultTopic={
              slidesInSlot[0]?.headingText?.trim() ||
              slides[0]?.headingText?.trim() ||
              name.trim() ||
              ""
            }
            onGenerated={(newSlides, images) => {
              lastSavedRef.current = {};
              setSlides(newSlides);
              // The carousel lives in its carousel slot — switch the view to the
              // Carousels tab + that slot so we land on it (and never pollute the
              // single-image "default" slot).
              const cslot =
                newSlides.find(
                  (s) =>
                    s.slotKey.startsWith("carousel-") ||
                    s.slotKey === "question-hook",
                )?.slotKey ?? "carousel-content";
              setActiveSlot(cslot);
              setActiveCategory("carousels");
              setActiveIdx(0);
              router.refresh();
              if (images && images.queued > 0) {
                toast.success(`Generating ${images.queued} AI backgrounds — they'll appear as they finish.`);
              }
            }}
          />
          {slidesInSlot.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshContent("slot")}
              disabled={refreshing !== null}
              title={
                isCarousel
                  ? "Rewrite every slide's heading and body with Claude — keeps layouts, photos, and colours"
                  : "Rewrite this image's heading and body with Claude"
              }
            >
              <RefreshCw
                size={14}
                style={{
                  animation:
                    refreshing === "slot"
                      ? "spin 1s linear infinite"
                      : undefined,
                }}
              />
              {refreshing === "slot"
                ? "Refreshing…"
                : isCarousel
                  ? "Refresh all copy"
                  : "Refresh copy"}
            </Button>
          )}
          {isCarousel && (
            <Button
              variant="outline"
              size="sm"
              onClick={exportAllAsZip}
              disabled={exportingZip || !fontsReady}
              title="Download all slides as a zip"
            >
              <Download size={14} />
              {exportingZip ? "Zipping…" : "Export all (.zip)"}
            </Button>
          )}
          {logoUrl && (
            <Button
              type="button"
              size="sm"
              variant={showLogo ? "primary" : "outline"}
              title="Draw your logo on every slide (preview + export)"
              onClick={async () => {
                const next = !showLogo;
                setShowLogo(next); // optimistic — canvas re-renders immediately
                try {
                  await fetch(`/api/content-studio/carousels/${designId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ showLogo: next }),
                  });
                } catch {}
              }}
            >
              <ImageIcon size={14} />
              {showLogo ? "Logo on" : "Logo off"}
            </Button>
          )}
          <Button variant="destructive" size="sm" onClick={deleteDesign}>
            <Trash2 size={14} />
            Delete design
          </Button>
        </div>
      </div>

      {actionError && (
        <div
          style={{
            color: "#dc2626",
            fontSize: 13,
            padding: "8px 12px",
            border: "1px solid #dc2626",
            background: "rgba(220,38,38,0.06)",
            borderRadius: "var(--radius)",
          }}
        >
          {actionError}
        </div>
      )}

      {/* Main layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 480px) 1fr",
          gap: 28,
          alignItems: "start",
        }}
      >
        {/* Preview */}
        <div style={{ display: "grid", gap: 14, position: "sticky", top: 24 }}>
          {isEmptySlot ? (
            <div
              style={{
                background: "var(--surface-1)",
                border: "1px dashed var(--hairline-strong)",
                borderRadius: "var(--radius)",
                padding: 36,
                textAlign: "center",
                display: "grid",
                gap: 10,
                minHeight: 360,
                alignContent: "center",
              }}
            >
              <Sparkles
                size={28}
                strokeWidth={1.4}
                style={{
                  margin: "0 auto",
                  color: "var(--text-tertiary)",
                }}
              />
              <div
                style={{
                  fontFamily: "var(--font-heading), sans-serif",
                  fontSize: 18,
                  color: "var(--text-primary)",
                  textTransform: "uppercase",
                }}
              >
                Empty slot
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  maxWidth: 320,
                  margin: "0 auto",
                }}
              >
                Click <strong>Generate carousel</strong> in the toolbar to
                fill this slot, or click <strong>Add slide</strong> to start
                manually.
              </div>
            </div>
          ) : isCarousel ? (
            <div
              style={{
                background: "var(--surface-1)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: 14,
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
                maxHeight: "calc(100vh - 120px)",
                overflowY: "auto",
              }}
            >
              {slidesInSlot.map((slide, idx) => (
                <SlideThumb
                  key={slide.id}
                  slide={slide}
                  slideIdx={idx}
                  total={total}
                  isActive={idx === activeIdx}
                  fontsReady={fontsReady}
                  library={library}
                  onSelect={() => setActiveIdx(idx)}
                  defaultHeadingFontId={defaultHeadingFontId}
                  defaultBodyFontId={defaultBodyFontId}
                  brand={brand}
                  logo={showLogo ? logoImg : null}
                />
              ))}
            </div>
          ) : (
            activeSlide && (
              <div
                style={{
                  background: "var(--surface-1)",
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                  padding: 18,
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    maxWidth: previewMaxWidth,
                    width: "100%",
                    position: "relative",
                  }}
                >
                  <SlideCanvas
                    slide={activeSlide}
                    slideIdx={activeIdx}
                    total={total}
                    library={library}
                    fontsReady={fontsReady}
                    defaultHeadingFontId={defaultHeadingFontId}
                    defaultBodyFontId={defaultBodyFontId}
                    brand={brand}
                    logo={showLogo ? logoImg : null}
                  />
                  {activeSlide?.imageStatus === "generating" && (
                    <div
                      style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: "rgba(10,10,10,0.72)",
                        color: "#fff",
                      }}
                    >
                      <RefreshCw
                        size={11}
                        style={{ animation: "spin 1s linear infinite" }}
                      />
                      Generating image…
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {/* Slide indicator */}
          <div
            style={{
              textAlign: "center",
              fontSize: 12,
              color: "var(--text-secondary)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {isEmptySlot
              ? "No slides in this slot"
              : isCarousel
                ? `Editing slide ${padNumber(activeIdx + 1, 2)} of ${padNumber(total, 2)} — click a thumbnail to switch`
                : "Single image"}
          </div>

          {/* Slide actions */}
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                variant="outline"
                size="sm"
                onClick={addSlide}
                title="Add another slide to make this a carousel"
              >
                <Plus size={14} />
                Add slide
              </Button>
              {isCarousel && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={deleteSlide}
                  title="Delete the current slide"
                >
                  <Trash2 size={14} />
                  Delete slide
                </Button>
              )}
            </div>
            {!isEmptySlot && (
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshContent("slide")}
                  disabled={refreshing !== null}
                  title="Rewrite this slide's heading and body with Claude"
                >
                  <RefreshCw
                    size={14}
                    style={{
                      animation:
                        refreshing === "slide"
                          ? "spin 1s linear infinite"
                          : undefined,
                    }}
                  />
                  {refreshing === "slide" ? "Refreshing…" : "Refresh slide"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportCurrentSlide}
                  disabled={!fontsReady}
                >
                  <Download size={14} />
                  Export PNG
                </Button>
              </div>
            )}
          </div>

          {template && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text-tertiary)",
                textAlign: "center",
                letterSpacing: "0.04em",
              }}
            >
              {template.aspectRatio} · {template.width}×{template.height} ·{" "}
              {template.name}
            </div>
          )}
        </div>

        {/* Controls column */}
        <div style={{ display: "grid", gap: 22 }}>
          <div>
            <Label>Template</Label>
            <div
              style={{
                display: "flex",
                gap: 2,
                borderBottom: "1px solid var(--hairline)",
                marginBottom: 12,
                overflowX: "auto",
              }}
            >
              {CATEGORIES.map((cat) => {
                const active = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => selectCategory(cat.id)}
                    style={{
                      padding: "10px 14px",
                      background: "transparent",
                      border: "none",
                      borderBottom: `2px solid ${
                        active ? "var(--text-primary)" : "transparent"
                      }`,
                      marginBottom: -1,
                      color: active
                        ? "var(--text-primary)"
                        : "var(--text-secondary)",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-tertiary)",
                marginBottom: 10,
                letterSpacing: "0.02em",
              }}
            >
              {CATEGORIES.find((c) => c.id === activeCategory)?.blurb}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
              }}
            >
              {templatesByCategory(activeCategory).map((t) => {
                // In Carousels category, each template card represents an
                // INDEPENDENT slot — clicking switches which carousel you're
                // viewing rather than re-skinning the current slide.
                const isSlotMode = activeCategory === "carousels";
                const active = isSlotMode
                  ? activeSlot === t.id
                  : activeSlide.templateId === t.id;
                const count = isSlotMode ? slotCounts[t.id] ?? 0 : 0;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      if (isSlotMode) {
                        setActiveSlot(t.id);
                        setActiveIdx(0);
                      } else {
                        updateActiveSlide({
                          templateId: t.id,
                          aspectRatio: t.aspectRatio,
                        });
                      }
                    }}
                    style={{
                      textAlign: "left",
                      padding: "12px 14px",
                      borderRadius: "var(--radius)",
                      border: active
                        ? "1px solid var(--text-primary)"
                        : "1px solid var(--hairline)",
                      background: active ? "var(--surface-2)" : "var(--bg)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      display: "grid",
                      gap: 4,
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                        }}
                      >
                        {t.name}
                      </span>
                      {isSlotMode ? (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: "0.06em",
                            padding: "3px 8px",
                            borderRadius: "var(--radius)",
                            background:
                              count > 0
                                ? "var(--text-primary)"
                                : "var(--surface-3)",
                            color:
                              count > 0
                                ? "var(--bg)"
                                : "var(--text-tertiary)",
                          }}
                        >
                          {count > 0
                            ? `${count} SLIDE${count === 1 ? "" : "S"}`
                            : "EMPTY"}
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--text-tertiary)",
                          }}
                        >
                          {t.aspectRatio}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-tertiary)",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {t.blurb}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {activeSlide && template && (
          <>
          {template.usesTagline && (
            <div>
              <Label htmlFor="tagline">
                {template.category === "carousels"
                  ? "Slide indicator (auto-numbered if blank)"
                  : "Tagline"}
              </Label>
              <Input
                id="tagline"
                value={activeSlide.tagline ?? ""}
                placeholder={
                  template.taglineHint ?? autoTagline(activeIdx, total) ?? ""
                }
                onChange={(e) =>
                  updateActiveSlide({ tagline: e.target.value || null })
                }
              />
            </div>
          )}

          <div>
            <Label htmlFor="heading">Heading</Label>
            <Textarea
              id="heading"
              value={activeSlide.headingText}
              placeholder="Big idea — 3-6 words is best."
              onChange={(e) =>
                updateActiveSlide({ headingText: e.target.value })
              }
              style={{ minHeight: 70 }}
            />
          </div>

          <div>
            <Label htmlFor="body">Body text</Label>
            <Textarea
              id="body"
              value={activeSlide.bodyText}
              placeholder="One supporting line."
              onChange={(e) =>
                updateActiveSlide({ bodyText: e.target.value })
              }
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Label htmlFor="heading-font">Heading font</Label>
              <select
                id="heading-font"
                value={activeSlide.headingFont ?? defaultHeadingFontId}
                onChange={(e) =>
                  updateActiveSlide({
                    headingFont:
                      e.target.value === defaultHeadingFontId
                        ? null
                        : e.target.value,
                  })
                }
                style={{
                  width: "100%",
                  background: "var(--bg)",
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                  padding: "10px 14px",
                  color: "var(--text-primary)",
                  fontSize: 14,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {FONT_OPTIONS.filter((f) => f.forHeading !== false).map(
                  (opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.name}
                      {opt.id === defaultHeadingFontId ? "  (brand default)" : ""}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div>
              <Label htmlFor="body-font">Body font</Label>
              <select
                id="body-font"
                value={activeSlide.bodyFont ?? defaultBodyFontId}
                onChange={(e) =>
                  updateActiveSlide({
                    bodyFont:
                      e.target.value === defaultBodyFontId
                        ? null
                        : e.target.value,
                  })
                }
                style={{
                  width: "100%",
                  background: "var(--bg)",
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                  padding: "10px 14px",
                  color: "var(--text-primary)",
                  fontSize: 14,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {FONT_OPTIONS.filter((f) => f.forBody !== false).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                    {opt.id === defaultBodyFontId ? "  (brand default)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label>Accent colour</Label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ACCENT_SWATCHES.map((c) => {
                const active =
                  activeSlide.accentColor.toLowerCase() === c.toLowerCase();
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => updateActiveSlide({ accentColor: c })}
                    aria-label={c}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "var(--radius)",
                      background: c,
                      border: active
                        ? "2px solid var(--text-primary)"
                        : "1px solid var(--hairline-strong)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                );
              })}
              <input
                type="color"
                value={activeSlide.accentColor}
                onChange={(e) =>
                  updateActiveSlide({ accentColor: e.target.value })
                }
                style={{
                  width: 36,
                  height: 36,
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                  padding: 0,
                  background: "transparent",
                  cursor: "pointer",
                }}
                title="Custom colour"
              />
            </div>
          </div>

          <div>
            <Label>Background colour</Label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Tooltip label="No colour">
                <button
                  type="button"
                  onClick={() => updateActiveSlide({ backgroundColor: null })}
                  aria-label="No colour"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "var(--radius)",
                    background:
                      "repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 50% / 12px 12px",
                    border: !activeSlide.backgroundColor
                      ? "2px solid var(--text-primary)"
                      : "1px solid var(--hairline-strong)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              </Tooltip>
              {BACKGROUND_SWATCHES.map((c) => {
                const active =
                  (activeSlide.backgroundColor ?? "").toLowerCase() ===
                  c.toLowerCase();
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => updateActiveSlide({ backgroundColor: c })}
                    aria-label={c}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "var(--radius)",
                      background: c,
                      border: active
                        ? "2px solid var(--text-primary)"
                        : "1px solid var(--hairline-strong)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                );
              })}
              <input
                type="color"
                value={activeSlide.backgroundColor ?? "#0a0a0a"}
                onChange={(e) =>
                  updateActiveSlide({ backgroundColor: e.target.value })
                }
                style={{
                  width: 36,
                  height: 36,
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                  padding: 0,
                  background: "transparent",
                  cursor: "pointer",
                }}
                title="Custom background colour"
              />
            </div>
            <p style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 6 }}>
              Used when no background photo is set. A photo always takes priority.
            </p>
          </div>

          {imageGenEnabled && activeSlide && (
            <div>
              <Label>AI background</Label>
              <AiImagePanel
                key={activeSlide.id}
                slide={activeSlide}
                designId={designId}
                onAsset={(asset) =>
                  setLibrary((prev) =>
                    prev.some((a) => a.id === asset.id) ? prev : [asset, ...prev],
                  )
                }
                onSlidePatch={updateActiveSlide}
              />
            </div>
          )}

          <div>
            <Label>Background photo</Label>
            <div
              style={{
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: 14,
                background: "var(--surface-1)",
                display: "grid",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {imageLibrary.length} photo{imageLibrary.length === 1 ? "" : "s"} in
                  library
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  {activeSlide.backgroundAssetId != null && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setSlideBackgroundManually(null)}
                    >
                      Clear
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    <Upload size={14} />
                    {uploading ? "Uploading…" : "Upload photos"}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const list = Array.from(e.target.files ?? []);
                      if (list.length > 0) uploadFiles(list);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
              {imageLibrary.length === 0 ? (
                <div
                  style={{
                    border: "1px dashed var(--hairline)",
                    borderRadius: "var(--radius)",
                    padding: 24,
                    textAlign: "center",
                    color: "var(--text-tertiary)",
                    fontSize: 13,
                  }}
                >
                  <ImageIcon
                    size={24}
                    strokeWidth={1.5}
                    style={{ marginBottom: 6, opacity: 0.5 }}
                  />
                  <div>Upload clinic photos to use as backgrounds.</div>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                    gap: 8,
                    maxHeight: 320,
                    overflowY: "auto",
                  }}
                >
                  {imageLibrary.map((asset) => {
                    const active = asset.id === activeSlide.backgroundAssetId;
                    return (
                      <div
                        key={asset.id}
                        style={{
                          position: "relative",
                          width: "100%",
                          paddingBottom: "100%",
                          borderRadius: "var(--radius)",
                          overflow: "hidden",
                          border: active
                            ? "2px solid var(--text-primary)"
                            : "1px solid var(--hairline)",
                          cursor: "pointer",
                          background: "var(--surface-2)",
                        }}
                        onClick={() => setSlideBackgroundManually(asset.id)}
                      >
                        <img
                          src={libraryFileUrl(asset.filename)}
                          alt={asset.originalName}
                          style={{
                            position: "absolute",
                            inset: 0,
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                        <Tooltip label="Remove from library">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAsset(asset.id);
                            }}
                            aria-label="Remove from library"
                            style={{
                              position: "absolute",
                              top: 4,
                              right: 4,
                              background: "rgba(0,0,0,0.6)",
                              color: "#fff",
                              borderRadius: "var(--radius)",
                              border: "none",
                              width: 22,
                              height: 22,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {activeSlide.backgroundAssetId != null && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
              }}
            >
              <div>
                <Label>Fit</Label>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["cover", "contain"] as const).map((mode) => {
                    const active = activeSlide.backgroundFit === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => updateActiveSlide({ backgroundFit: mode })}
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          borderRadius: "var(--radius)",
                          border: active
                            ? "1px solid var(--text-primary)"
                            : "1px solid var(--hairline)",
                          background: active ? "var(--surface-2)" : "var(--bg)",
                          color: "var(--text-primary)",
                          cursor: "pointer",
                          fontSize: 13,
                          fontFamily: "inherit",
                          textTransform: "capitalize",
                        }}
                      >
                        {mode}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label htmlFor="zoom">
                  Zoom ({activeSlide.backgroundZoom.toFixed(2)}×)
                </Label>
                <input
                  id="zoom"
                  type="range"
                  min={1}
                  max={2.5}
                  step={0.05}
                  value={activeSlide.backgroundZoom}
                  onChange={(e) =>
                    updateActiveSlide({
                      backgroundZoom: Number(e.target.value),
                    })
                  }
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <Label>Horizontal position</Label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={activeSlide.backgroundOffsetX}
                  onChange={(e) =>
                    updateActiveSlide({
                      backgroundOffsetX: Number(e.target.value),
                    })
                  }
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <Label>Vertical position</Label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={activeSlide.backgroundOffsetY}
                  onChange={(e) =>
                    updateActiveSlide({
                      backgroundOffsetY: Number(e.target.value),
                    })
                  }
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {/* Caption section — full-width below the main grid */}
      {captionSlide && (
        <div
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius)",
            padding: 20,
            display: "grid",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "var(--font-heading), sans-serif",
                  fontSize: 16,
                  color: "var(--text-primary)",
                  textTransform: "uppercase",
                  letterSpacing: "-0.005em",
                }}
              >
                Post caption
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-tertiary)",
                  marginTop: 4,
                }}
              >
                The Instagram / Facebook caption that goes with this{" "}
                {isCarousel ? "carousel" : "post"}. Auto-saves as you type.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyCaption}
                disabled={!caption.trim()}
              >
                <Copy size={14} />
                {captionCopied ? "Copied" : "Copy"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={refreshCaption}
                disabled={refreshing !== null}
                title="Rewrite the caption with Claude"
              >
                <RefreshCw
                  size={14}
                  style={{
                    animation:
                      refreshing === "caption"
                        ? "spin 1s linear infinite"
                        : undefined,
                  }}
                />
                {refreshing === "caption" ? "Refreshing…" : "Refresh caption"}
              </Button>
            </div>
          </div>
          <Textarea
            value={caption}
            onChange={(e) => updateCaption(e.target.value)}
            placeholder={
              "Write the caption here, or click Refresh caption to generate one with Claude."
            }
            spellCheck
            style={{
              minHeight: 200,
              fontSize: 14,
              lineHeight: 1.55,
              fontFamily: "inherit",
            }}
          />
          <div
            style={{
              fontSize: 11,
              color: "var(--text-tertiary)",
              letterSpacing: "0.02em",
            }}
          >
            {caption.trim()
              ? `${caption.split(/\s+/).filter(Boolean).length} words · ${caption.length} chars`
              : "Empty — click Refresh caption to generate one."}
          </div>
        </div>
      )}
    </div>
  );
}

function SaveStatus({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error";
}) {
  const text =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "error"
          ? "Save failed"
          : "";
  const color =
    status === "error"
      ? "#dc2626"
      : status === "saved"
        ? "#15803d"
        : "var(--text-tertiary)";
  if (!text) return <span style={{ width: 60 }} />;
  return (
    <span
      style={{
        fontSize: 12,
        color,
        letterSpacing: "0.04em",
        minWidth: 60,
        textAlign: "right",
      }}
    >
      {text}
    </span>
  );
}

/**
 * Generate carousel button — opens a dialog and POSTs to the generate API
 * to regenerate a coherent set of slides on a topic via Claude.
 */
function GenerateCarouselButton({
  designId,
  slotKey,
  defaultTopic,
  onGenerated,
}: {
  designId: number;
  slotKey: string;
  defaultTopic: string;
  onGenerated: (
    newSlides: CarouselSlide[],
    images?: { queued: number; estCents: number },
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState(defaultTopic);
  const [slideCount, setSlideCount] = useState(5);
  const [tone, setTone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTopic(defaultTopic);
      setError(null);
    }
  }, [open, defaultTopic]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) {
      setError("Topic is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-studio/carousels/${designId}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: topic.trim(),
            slideCount,
            tone: tone.trim() || null,
            slotKey,
            replaceExisting: true,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Couldn't generate the carousel.");
      }
      const newSlides = json?.carousel?.slides;
      if (!Array.isArray(newSlides) || newSlides.length === 0) {
        throw new Error("Generator returned no slides.");
      }
      setOpen(false);
      onGenerated(newSlides as CarouselSlide[], json.images);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't generate the carousel.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title="Generate a full carousel on a topic with Claude"
        >
          <Sparkles size={14} />
          Generate carousel
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Generate a carousel"
        description="Claude will write a cohesive 2-10 slide series on your topic and replace the current slides."
      >
        <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
          <div>
            <Label htmlFor="gen-topic">Topic</Label>
            <Textarea
              id="gen-topic"
              required
              value={topic}
              placeholder="e.g. 5 quick tips to get started"
              onChange={(e) => setTopic(e.target.value)}
              style={{ minHeight: 70 }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Label htmlFor="gen-count">Number of slides</Label>
              <Input
                id="gen-count"
                type="number"
                min={2}
                max={10}
                value={slideCount}
                onChange={(e) => setSlideCount(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="gen-tone">Tone (optional)</Label>
              <Input
                id="gen-tone"
                value={tone}
                placeholder="calm, grounded, no hype"
                onChange={(e) => setTone(e.target.value)}
              />
            </div>
          </div>
          {error && (
            <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
              Existing slides will be replaced.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={submitting || !topic.trim()}>
                <Sparkles size={15} />
                {submitting ? "Generating…" : "Generate"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Per-slide AI background controls: prompt textarea (prefilled with the
 * stored prompt), Generate/Regenerate via the sync slide-image route, cost
 * hint, and failed-state retry. Rendered only when imageGenEnabled.
 */
function AiImagePanel({
  slide,
  designId,
  onAsset,
  onSlidePatch,
}: {
  slide: CarouselSlide;
  designId: number;
  onAsset: (asset: ImageLibraryAsset) => void;
  onSlidePatch: (patch: Partial<CarouselSlide>) => void;
}) {
  const [prompt, setPrompt] = useState(slide.imagePrompt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPrompt(slide.imagePrompt ?? "");
    setError(null);
  }, [slide.id, slide.imagePrompt]);

  // Live mirror of the slide's status for the in-flight generate() closure
  // below — belt-and-braces for the fetch-throw path (no response to read
  // `superseded` from) when a manual pick resolves this slide mid-flight.
  const statusRef = useRef(slide.imageStatus);
  useEffect(() => {
    statusRef.current = slide.imageStatus;
  }, [slide.imageStatus]);

  const generating = slide.imageStatus === "generating";
  const failed = slide.imageStatus === "failed";

  async function generate() {
    setBusy(true);
    setError(null);
    // Mark pending locally BEFORE the fetch so a manual pick mid-flight
    // (setSlideBackgroundManually) sees imageStatus === "generating" and
    // takes its protective branch — same contract as the async queue path.
    onSlidePatch({ imageStatus: "generating", imageError: null });
    try {
      const res = await fetch(
        `/api/content-studio/carousels/${designId}/slides/${slide.id}/image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt.trim() || null }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Image generation failed.");
      if (json.asset) onAsset(json.asset as ImageLibraryAsset);
      // A manual pick mid-flight wins: json.superseded (server truth) is the
      // primary guard; statusRef is the fallback for callers with no server
      // response to check. Either way, the asset is already added to the
      // library above — it's paid for and shouldn't be lost — but the slide
      // itself must not be clobbered back onto this now-stale AI result.
      if (json.superseded === true || statusRef.current !== "generating") {
        return;
      }
      onSlidePatch({
        backgroundAssetId: json.slide?.backgroundAssetId ?? json.asset?.id ?? null,
        imageStatus: "ready",
        imageError: null,
        imagePrompt: json.slide?.imagePrompt ?? prompt,
      });
      setPrompt(json.slide?.imagePrompt ?? prompt);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Image generation failed.";
      // A slide the user already resolved manually must not get a failure
      // banner slapped back onto it — only surface the failure if this
      // request is still the thing the slide is waiting on.
      if (statusRef.current === "generating") {
        setError(message);
        onSlidePatch({ imageStatus: "failed", imageError: message });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 14,
        background: "var(--surface-1)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
          AI background
        </span>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>≈ €0.04 / image</span>
      </div>
      <Textarea
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the scene — leave as-is to reuse the last prompt"
        style={{ fontSize: 12 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Button type="button" size="sm" onClick={generate} disabled={busy || generating}>
          <Sparkles size={14} />
          {busy
            ? "Generating…"
            : slide.backgroundAssetId != null
              ? "Regenerate"
              : "Generate"}
        </Button>
        {generating && (
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Generating in the background…
          </span>
        )}
      </div>
      {(error || failed) && (
        <div style={{ fontSize: 12, color: "var(--danger, #dc2626)" }}>
          {error ?? slide.imageError ?? "Image generation failed."}{" "}
          <button
            type="button"
            onClick={generate}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "inherit",
              textDecoration: "underline",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function SlideThumb({
  slide,
  slideIdx,
  total,
  isActive,
  fontsReady,
  library,
  onSelect,
  defaultHeadingFontId,
  defaultBodyFontId,
  brand,
  logo = null,
}: {
  slide: CarouselSlide;
  slideIdx: number;
  total: number;
  isActive: boolean;
  fontsReady: boolean;
  library: ImageLibraryAsset[];
  onSelect: () => void;
  defaultHeadingFontId?: string;
  defaultBodyFontId?: string;
  brand?: BrandLabels;
  logo?: HTMLImageElement | null;
}) {
  const template = getTemplate(slide.templateId);
  const generating = slide.imageStatus === "generating";
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        position: "relative",
        padding: 6,
        borderRadius: "var(--radius)",
        background: isActive ? "var(--surface-2)" : "var(--bg)",
        border: isActive
          ? "2px solid var(--text-primary)"
          : "1px solid var(--hairline)",
        cursor: "pointer",
        display: "grid",
        gap: 4,
        fontFamily: "inherit",
        textAlign: "left",
      }}
      aria-label={
        generating
          ? `Slide ${slideIdx + 1} — generating image`
          : `Edit slide ${slideIdx + 1}`
      }
      aria-pressed={isActive}
      aria-busy={generating}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 10,
          fontWeight: 600,
          color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          padding: "0 2px",
        }}
      >
        <span>Slide {padNumber(slideIdx + 1, 2)}</span>
        <span style={{ color: "var(--text-tertiary)" }}>
          {template?.aspectRatio ?? ""}
        </span>
      </div>
      <div style={{ position: "relative" }}>
        <SlideCanvas
          slide={slide}
          slideIdx={slideIdx}
          total={total}
          library={library}
          fontsReady={fontsReady}
          defaultHeadingFontId={defaultHeadingFontId}
          defaultBodyFontId={defaultBodyFontId}
          brand={brand}
          logo={logo}
        />
        {generating && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              borderRadius: "var(--radius)",
              background: "rgba(10,10,10,0.6)",
              color: "#fff",
            }}
          >
            <Loader2 size={18} className="spin" />
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              Generating…
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function renderSlideToBlob(
  slide: CarouselSlide,
  slideIdx: number,
  total: number,
  library: ImageLibraryAsset[],
  fontFamilies: { heading: string; body: string },
  brand?: BrandLabels,
  logo: HTMLImageElement | null = null,
): Promise<Blob | null> {
  const template = getTemplate(slide.templateId);
  if (!template) return null;

  let bg: HTMLImageElement | null = null;
  if (slide.backgroundAssetId != null) {
    const asset = library.find((a) => a.id === slide.backgroundAssetId);
    if (asset) {
      bg = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = libraryFileUrl(asset.filename);
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
      });
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = template.width;
  canvas.height = template.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paintSlide(ctx, canvas.width, canvas.height, slide, slideIdx, total, brand, fontFamilies, bg, logo);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
}
