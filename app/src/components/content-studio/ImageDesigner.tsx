"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import JSZip from "jszip";
import {
  AlertTriangle,
  Copy,
  Loader2,
  Download,
  Image as ImageIcon,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Undo2,
  Trash2,
  Wand2,
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
import type {
  CarouselSlide,
  ImageLibraryAsset,
} from "@/lib/db/schema";
import {
  HEADING_SCALE_MAX,
  HEADING_SCALE_MIN,
  carouselTemplateGroups,
  clampHeadingScale,
  getTemplate,
  singleTemplateGroups,
  type Template,
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
import {
  DEFAULT_CAROUSEL_SLOT,
  DEFAULT_SINGLE_TEMPLATE,
  DEFAULT_SLOT,
  isCarouselSlot,
  templateForNewSlide,
  type DesignKind,
} from "@/lib/image/slots";
import { SlideCanvas, useCanvasFonts, useLogoImage } from "./SlideCanvas";
import type { DesignSystem } from "@/lib/design/parse";
import { photoSlotsUsed, usesPhoto } from "@/lib/design/photoSlots";
import { parsePhotoAssetIds } from "@/lib/image/photoAssetIds";
import { sceneForSlot } from "@/lib/image/photoScenes";
import { DESIGNED_TEMPLATE_ID, slideDimensions, slideSurface } from "@/lib/image/paintSlide";
import { renderFileUrl } from "@/lib/image/renderStore.client";
import { SlideFilmstrip } from "./SlideFilmstrip";
import { SlideColorPicker } from "./SlideColorPicker";
import { PHOTO_PANEL_WIDTH, SlidePhotoLibraryPopout } from "./SlidePhotoLibrary";
import { isMacPlatform, resolveShortcut, shortcutLabel } from "@/lib/content-studio/shortcuts";
import {
  autosaveSnapshot,
  designReducer,
  initialDesignState,
  missingAssetIds,
  planManualBackground,
  planReorder,
  selectActiveSlide,
  selectSlidesInSlot,
  selectUndoDepth,
  selectWriting,
  type DesignAction,
  type DesignState,
} from "@/lib/content-studio/designState";
import { progressLabel, type DialogPhase } from "@/lib/content-studio/progressLabel";
import {
  guessIntent,
  intentDescription,
  type SlideIntent,
} from "@/lib/content-studio/slideIntent";
import { watchGeneration } from "./GenerationWatcher";
import { EditorSection } from "./EditorSection";
import { PostIdeas } from "./PostIdeas";

/**
 * The design-under-edit state machine, typed to the real row. Everything it
 * decides lives in lib/content-studio/designState.ts, where it can be tested
 * without mounting this editor.
 */
function slideReducer(
  state: DesignState<CarouselSlide>,
  action: DesignAction<CarouselSlide>,
): DesignState<CarouselSlide> {
  return designReducer(state, action);
}

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
  photoEditEnabled?: boolean;
  /** Same-origin URL of the tenant's uploaded logo (`getChromeLogoSrc()`), or null when none is uploaded. */
  logoUrl?: string | null;
  /** Whether this design currently draws the logo on its slides (persisted per-design). */
  initialShowLogo?: boolean;
  /**
   * The tenant's design system, or null when they have none — which is every
   * tenant until one is authored. It is what draws an AI-composed slide, and
   * what its layout is re-checked against on every render, so an operator edit
   * that breaks a brand rule is caught as well as a badly-composed layout.
   */
  designSystem?: DesignSystem | null;
  /**
   * Whether a DETACHED generation is running on this design ("writing"), gave
   * up ("failed"), or neither (null). The run outlives the request that started
   * it, so this is how the editor learns there is work in flight -- including
   * on a page load that happens long after the operator navigated away from the
   * screen that kicked it off.
   */
  initialGenerationStatus?: string | null;
  initialGenerationError?: string | null;
  initialGenerationStage?: string | null;
}

/**
 * Draggable focal point overlaid on the slide preview. Replaces the two
 * abstract 0–1 "horizontal/vertical position" sliders: the point sits at
 * (x, y) over the canvas and drag anywhere on the preview repositions the
 * background photo. x/y are the slide's backgroundOffsetX/Y (0–1) unchanged.
 */
/**
 * Heading size, as a nudge either side of whatever the template does.
 *
 * Templates auto-fit a heading DOWNWARDS from a fixed start size, so a short
 * heading — which is exactly what a carousel cover has — renders at that start
 * size even when there's room for something much bigger. This raises or lowers
 * that ceiling. It reads as a percentage because "the template's size, plus a
 * bit" is the actual mental model; there's no absolute point size to show.
 */
function HeadingSizeControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (scale: number) => void;
}) {
  const STEP = 0.1;
  const atMin = value <= HEADING_SCALE_MIN + 0.001;
  const atMax = value >= HEADING_SCALE_MAX - 0.001;
  const nudge = (delta: number) =>
    onChange(clampHeadingScale(Math.round((value + delta) * 10) / 10));

  const btn = (disabled: boolean): React.CSSProperties => ({
    width: 24,
    height: 24,
    display: "grid",
    placeItems: "center",
    padding: 0,
    border: "none",
    borderRadius: "calc(var(--radius) - 2px)",
    background: "transparent",
    color: disabled ? "var(--text-tertiary)" : "var(--text-secondary)",
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        padding: 2,
        borderRadius: "var(--radius)",
        background: "var(--surface-2)",
      }}
    >
      <button
        type="button"
        onClick={() => nudge(-STEP)}
        disabled={atMin}
        aria-label="Smaller heading"
        title="Smaller heading"
        style={btn(atMin)}
      >
        <Minus size={13} />
      </button>
      <button
        type="button"
        onClick={() => onChange(1)}
        disabled={value === 1}
        title="Back to the template's own size"
        style={{
          minWidth: 42,
          padding: "0 4px",
          border: "none",
          background: "transparent",
          color: value === 1 ? "var(--text-tertiary)" : "var(--text-primary)",
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          cursor: value === 1 ? "default" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {Math.round(value * 100)}%
      </button>
      <button
        type="button"
        onClick={() => nudge(STEP)}
        disabled={atMax}
        aria-label="Bigger heading"
        title="Bigger heading"
        style={btn(atMax)}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

function FocalOverlay({
  x,
  y,
  onChange,
}: {
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const apply = useCallback(
    (clientX: number, clientY: number) => {
      const el = layerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const nx = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const ny = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
      onChange(Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000);
    },
    [onChange],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      e.preventDefault();
      apply(e.clientX, e.clientY);
    };
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, apply]);

  return (
    <div
      ref={layerRef}
      onPointerDown={(e) => {
        e.preventDefault();
        setDragging(true);
        apply(e.clientX, e.clientY);
      }}
      style={{
        position: "absolute",
        inset: 0,
        cursor: dragging ? "grabbing" : "crosshair",
        touchAction: "none",
      }}
      aria-label="Background focal point — drag to reposition the photo"
    >
      <div
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          width: 26,
          height: 26,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          border: "2px solid #fff",
          boxShadow: "0 0 0 2px rgba(0,0,0,0.45), 0 2px 10px rgba(0,0,0,0.6)",
          background: "rgba(255,255,255,0.12)",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 8,
            borderRadius: "50%",
            background: "#fff",
          }}
        />
      </div>
    </div>
  );
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
  photoEditEnabled = false,
  logoUrl = null,
  initialShowLogo = true,
  designSystem = null,
  initialGenerationStatus = null,
  initialGenerationError = null,
  initialGenerationStage = null,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [name, setName] = useState(initialName);
  // The slide set, the cursor, the active slot, the per-slide undo stacks, the
  // photo swap in flight and the detached run's status are ONE machine -- they
  // are read and written together, and as eight separate useStates the rules
  // that hold between them had nowhere to live and no way to be tested.
  const [design, dispatch] = useReducer(slideReducer, undefined, () =>
    initialDesignState<CarouselSlide>(initialSlides, {
      status: initialGenerationStatus,
      error: initialGenerationError,
      stage: initialGenerationStage,
    }),
  );
  const { slides, activeIdx, activeSlot, rephotographing } = design;
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
  const { generationError, generationStage } = design;
  const writing = selectWriting(design);

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

  // Slides in the current slot only. A "slot" lets a single design hold
  // multiple independent carousels — each keyed by a carousel template
  // (cover / content / cta / tip / quote / question-hook). Switching slots
  // preserves whatever's in the other slots.
  const slidesInSlot = useMemo(() => selectSlidesInSlot(design), [design]);
  const total = slidesInSlot.length;
  const isCarousel = total > 1;
  const activeSlide = slidesInSlot[activeIdx] ?? null;

  // Which of the slide's photographs a pick replaces. A designed slide can
  // carry two, and picking a library photo had nowhere to say WHICH -- it
  // always meant the first.
  // Markup alone does not mean the slide still renders from it: applyTemplate
  // deliberately KEEPS designHtml so undo needs no model call, so a
  // template-restyled slide still carries two {{PHOTO}} slots while the
  // painter it now uses reads background_asset_id and nothing else. Gate on
  // the surface, so a restyled slide offers no target to choose between --
  // the control did nothing there.
  const photoSlots = useMemo(
    () =>
      activeSlide && slideSurface(activeSlide, designSystem)?.designed
        ? photoSlotsUsed(activeSlide.designHtml ?? "")
        : [],
    [activeSlide, designSystem],
  );
  const [photoSlot, setPhotoSlot] = useState(1);
  useEffect(() => {
    // A slot number means nothing on a different slide: slide 3's second
    // picture is not slide 4's, and a slide with one photograph has no second
    // at all. Back to the first on every move.
    setPhotoSlot(1);
  }, [activeSlide?.id]);
  // The slot every request actually carries. The held one is only ever a
  // preference: a redesign replaces designHtml under the SAME slide id -- so
  // the reset effect above never fires -- and a two-photograph slide that
  // comes back with one leaves the panel holding a slot the slide no longer
  // has. Every pick then POSTed slot 2 and was refused, with no tile
  // highlighted and no way back but selecting another slide. Clamping at the
  // point of use cannot race the render the way a corrective effect can.
  // Falling back to the constant 1 assumed every slide has a slot 1, which a
  // {{PHOTO:2}}-only slide does not: the fallback itself was then refused,
  // and with the chooser hidden (one slot means no UI to pick another) the
  // operator had no way to point at the slot the slide actually has. Fall
  // back to the slide's first ACTUAL slot instead.
  const effectivePhotoSlot = photoSlots.includes(photoSlot) ? photoSlot : (photoSlots[0] ?? 1);
  // The photograph the chosen slot currently holds, so the strip highlights
  // the picture the operator is about to replace rather than always slot 1's.
  // A slide with no slots is painted from background_asset_id, so that column
  // -- not the list -- is the picture on screen there.
  const activeSlotAssetId = !activeSlide
    ? null
    : photoSlots.length === 0
      ? activeSlide.backgroundAssetId
      : (parsePhotoAssetIds(activeSlide.photoAssetIds, activeSlide.backgroundAssetId)[
          effectivePhotoSlot - 1
        ] ?? null);

  /**
   * A designed slide whose markup the renderer rejected has no PNG, so there is
   * nothing to show and nothing to export. That is the one problem an operator
   * can still be looking at after generation, so it is the one the editor
   * surfaces; everything else is reported when the design is made.
   */
  const designViolations = useMemo<string[]>(() => {
    if (!activeSlide) return [];
    if (!slideSurface(activeSlide, designSystem)?.designed) return [];
    if (activeSlide.renderFilename) return [];
    return [
      "This design could not be rendered, so there is nothing to show or export. Try a different one.",
    ];
  }, [designSystem, activeSlide]);

  // Clamp activeIdx when the slot or slide count changes.
  useEffect(() => {
    dispatch({ type: "clampActiveIndex" });
  }, [activeSlot, slidesInSlot.length, activeIdx]);

  // Undo for STRUCTURAL slide changes -- a STACK per slide. The rules, and
  // why it is not an undo of every keystroke, live with the stacks in
  // lib/content-studio/designState.ts.
  const snapshotForUndo = useCallback((slide: CarouselSlide) => {
    dispatch({ type: "snapshotForUndo", slide });
  }, []);

  const undoSlide = useCallback(() => {
    if (!activeSlide) return;
    dispatch({ type: "undoSlide", slideId: activeSlide.id });
  }, [activeSlide]);

  const undoDepth = selectUndoDepth(design);

  /**
   * The designer's keyboard. One listener on the window, resolved through the
   * pure keymap, so what a key means is tested and what it does is here.
   *
   * Arrows are clamped, not wrapped: reaching the last slide and pressing
   * right doing nothing is what every filmstrip does. Undo only fires when
   * there is something to undo, so the browser keeps Cmd+Z everywhere else.
   * Nothing fires while a whole-design run is writing -- the slides are about
   * to be replaced and stepping through them would be stepping through ghosts.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (writing) return;
      // A modal (the carousel/redesign dialogs) can be open with focus on a
      // non-field control inside it -- a pill, a stepper, a button. Radix
      // traps Tab but lets other keys bubble to window, so without this the
      // design behind the modal would silently step or undo while the
      // operator's attention is on the dialog. Checked live, not captured at
      // effect-registration time, since dialogs mount and unmount on top of
      // this listener's lifetime.
      //
      // `:not([data-state="closed"])`, not `[data-state="open"]`: the
      // hand-rolled panels in this subtree (SlideColorPicker, ImagePicker)
      // are `role="dialog"` with no `data-state` attribute at all, so a
      // check for the literal value "open" never matches them -- only the
      // Radix dialogs set that attribute. The negated form matches both:
      // Radix while open, and a hand-rolled panel that has no such
      // attribute to be "closed" with.
      if (document.querySelector('[role="dialog"]:not([data-state="closed"])')) return;
      const action = resolveShortcut({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        target: e.target instanceof HTMLElement
          ? { tagName: e.target.tagName, isContentEditable: e.target.isContentEditable }
          : null,
      });
      if (action === "undo") {
        if (undoDepth === 0) return;
        e.preventDefault();
        undoSlide();
      } else if (action === "nextSlide") {
        if (activeIdx >= slidesInSlot.length - 1) return;
        e.preventDefault();
        dispatch({ type: "setActiveIndex", index: activeIdx + 1 });
      } else if (action === "prevSlide") {
        if (activeIdx <= 0) return;
        e.preventDefault();
        dispatch({ type: "setActiveIndex", index: activeIdx - 1 });
      }
      // "submit" is handled by the dialogs themselves: it means nothing at
      // the window level, where there is no form to submit.
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [writing, undoDepth, undoSlide, activeIdx, slidesInSlot.length]);

  const shortcutPlatform = isMacPlatform(typeof navigator === "undefined" ? undefined : navigator)
    ? "mac"
    : "other";

  const updateActiveSlide = useCallback(
    (patch: Partial<CarouselSlide>) => {
      if (!activeSlide) return;
      dispatch({ type: "patchSlide", slideId: activeSlide.id, patch });
    },
    [activeSlide],
  );

  // What a manual background pick DOES -- the designed/template branch, the
  // one-swap-at-a-time guard and the resolution of a pending AI generation --
  // is decided by planManualBackground; this runs the plan.
  const setSlideBackgroundManually = useCallback(
    (backgroundAssetId: number | null) => {
      const plan = planManualBackground(design, backgroundAssetId, {
        designed: selectActiveSlide(design)?.templateId === DESIGNED_TEMPLATE_ID,
      });
      if (plan.kind === "none") return;
      if (plan.kind === "rephotograph") {
        const { slideId, assetId } = plan;
        dispatch({ type: "photoSwapStarted", slideId, assetId });
        setActionError(null);
        void (async () => {
          try {
            const res = await fetch(
              `/api/content-studio/carousels/${designId}/slides/${slideId}/photo`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                // The slot the panel is pointing at. The route reads an absent
                // one as slot 1, so a one-photograph slide is unaffected.
                body: JSON.stringify({ assetId, slot: effectivePhotoSlot }),
              },
            );
            // A gateway status is the app restarting under you, not a refusal
            // the operator can do anything about -- and the two used to arrive
            // as the same sentence, which sent someone looking for a fault in
            // their own photo.
            if (res.status === 502 || res.status === 503 || res.status === 504) {
              throw new Error(
                "The app was restarting. Give it a few seconds and pick the photo again.",
              );
            }
            const json = await res.json().catch(() => null);
            if (!json) {
              throw new Error(
                `The server answered with something unexpected (HTTP ${res.status}). Try again in a moment.`,
              );
            }
            if (!res.ok || !json.ok) {
              throw new Error(
                json.error || `Couldn't put that photo on the slide (HTTP ${res.status}).`,
              );
            }
            if (json.slide) {
              dispatch({ type: "slideUpdated", slide: json.slide as CarouselSlide });
            }
          } catch (err) {
            setActionError(
              err instanceof Error ? err.message : "Couldn't change the photo.",
            );
          } finally {
            dispatch({ type: "photoSwapFinished", slideId });
          }
        })();
        return;
      }
      dispatch({ type: "patchSlide", slideId: plan.slideId, patch: plan.patch });
      if (plan.persistClearedGeneration) {
        void fetch(
          `/api/content-studio/carousels/${designId}/slides/${plan.slideId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageStatus: null }),
          },
        ).catch(() => {});
      }
    },
    [design, designId, effectivePhotoSlot],
  );

  // Auto-save active slide (debounced)
  const lastSavedRef = useRef<Record<number, string>>({});
  // Drags can outpace their own PATCHes; only the newest one may roll back.
  const reorderSeqRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeSlide) return;
    // A run in flight is about to delete and replace this slot. Saving the
    // slide it is replacing writes nothing worth keeping, and a PATCH racing
    // the delete is noise in the log for no gain.
    if (writing) return;
    // The snapshot IS the PATCH body, and the string the dirty-check diffs
    // against. Which fields it carries (and why backgroundAssetId is one of
    // them) is AUTOSAVE_FIELDS in designState.ts.
    const snapshot = autosaveSnapshot(activeSlide);
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
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          throw new Error("The app was restarting — your change hasn't saved yet.");
        }
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `Save failed (HTTP ${res.status}).`);
        }
        lastSavedRef.current[activeSlide.id] = snapshot;
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 1500);
      } catch (err) {
        setSaveStatus("error");
        setActionError(err instanceof Error ? err.message : "Save failed.");
      }
    }, 600);
  }, [activeSlide, designId, writing]);

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
  // queue flips image_status/backgroundAssetId as each image completes. Which
  // fields a tick is allowed to merge, and why backgroundAssetId is the one
  // deliberate overlap with the auto-save snapshot, is stated once on
  // POLL_MERGE_FIELDS in designState.ts.
  const libraryRef = useRef(library);
  useEffect(() => {
    libraryRef.current = library;
  }, [library]);
  const anyGenerating = slides.some((s) => s.imageStatus === "generating");
  // `writing` is the whole-design run; `anyGenerating` is per-slide background
  // imagery. Both are resolved by the same poll, because both are written by a
  // detached continuation and the editor has no other way to hear about them.
  const pollWanted = anyGenerating || writing;
  // Whether a whole-design run was in flight is read when a tick GOES OUT, not
  // when its answer comes back: the handover at the writing -> null edge
  // belongs to the run that tick observed. A response whose DB snapshot
  // predates a run started since would otherwise read as that run finishing,
  // and take its stale slide set over the top of live edits.
  const writingRef = useRef(writing);
  writingRef.current = writing;
  useEffect(() => {
    if (!pollWanted) return;
    let stopped = false;
    const tick = async () => {
      const wasWriting = writingRef.current;
      try {
        const res = await fetch(`/api/content-studio/carousels/${designId}`);
        const json = await res.json();
        if (stopped || !res.ok || !json.ok) return;
        const status: string | null = json.carousel?.generationStatus ?? null;
        const server: CarouselSlide[] = json.carousel?.slides ?? [];
        // Status first, and with it the handover of the server's slide set at
        // the writing -> null edge this tick watched (see designState.ts).
        dispatch({
          type: "pollStatus",
          status,
          error: json.carousel?.generationError ?? null,
          stage: json.carousel?.generationStage ?? null,
          serverSlides: server,
          wasWriting,
        });
        // Hydrate newly-generated assets we don't have locally yet.
        const missing = missingAssetIds(
          server,
          new Set(libraryRef.current.map((a) => a.id)),
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
        dispatch({ type: "pollMerge", serverSlides: server });
      } catch {}
    };
    const iv = setInterval(tick, 2500);
    tick();
    return () => {
      stopped = true;
      clearInterval(iv);
    };
    // `writing` reaches the tick through a ref rather than this closure, so
    // that a tick fired between a run starting and this effect restarting
    // still reports what was true when it went out. It stays a dependency so
    // the poll is torn down and restarted when a run stops while per-slide
    // backgrounds are still generating, exactly as before.
  }, [pollWanted, writing, designId]);

  // `template` is only passed when the user picked one from the picker on an
  // empty slot. NOTE the callers: `onClick={addSlide}` would hand the click
  // event in as the template.
  async function addSlide(template?: Template) {
    setActionError(null);
    try {
      const lastInSlot = slidesInSlot[slidesInSlot.length - 1];
      // Pick a sensible template default. Within carousel slots, prefer the
      // matching content template; outside, mirror the slot's last slide — and
      // when the slot is empty there's nothing to mirror, so fall back by KIND.
      // A carousel default here would paint "SWIPE ->" onto a single post.
      const fallback =
        lastInSlot?.templateId ??
        (isCarouselSlot(activeSlot)
          ? DEFAULT_CAROUSEL_SLOT
          : DEFAULT_SINGLE_TEMPLATE);
      const templateId =
        template?.id ??
        templateForNewSlide(activeSlot, slidesInSlot.length, fallback);
      const res = await fetch(
        `/api/content-studio/carousels/${designId}/slides`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slotKey: activeSlot,
            templateId,
            // A picked template brings its own shape; otherwise follow the
            // slot so a slide doesn't change aspect mid-carousel.
            aspectRatio:
              surface?.aspectRatio ?? lastInSlot?.aspectRatio ?? "1:1",
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok)
        throw new Error(json.error || "Couldn't add slide.");
      dispatch({ type: "slideAdded", slide: json.slide as CarouselSlide });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't add slide.");
    }
  }

  // Reorder within the active slot. slide_order is per-slot, so only this
  // slot's IDs go to the server; the flat `slides` array keeps every other
  // slot exactly where it was.
  async function reorderSlidesInSlot(orderedIds: number[]) {
    const plan = planReorder(design, orderedIds);
    if (!plan) return; // stale drag — leave the list alone

    const seq = ++reorderSeqRef.current;
    dispatch({
      type: "slidesReplaced",
      slides: plan.slides,
      activeIdx: plan.activeIdx,
    });

    try {
      const res = await fetch(`/api/content-studio/carousels/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideOrder: orderedIds }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok)
        throw new Error(json.error || "Couldn't reorder the slides.");
    } catch (err) {
      // A later drag has already superseded this one — rolling back now would
      // undo an order the user has since changed again.
      if (seq !== reorderSeqRef.current) return;
      dispatch({
        type: "reorderRolledBack",
        // The slot the drag happened in, not whichever is on screen now: the
        // PATCH can outlive the operator's stay in it.
        slotKey: plan.slotKey,
        previousOrder: plan.previousOrder,
        previousIdx: plan.previousIdx,
      });
      setActionError(
        err instanceof Error ? err.message : "Couldn't reorder the slides.",
      );
    }
  }

  // Clicking a template restyles the slide in front of you. On an empty slot
  // there's nothing to restyle, so the click starts the slot with that
  // template — otherwise the whole picker would sit there looking inert.
  function applyTemplate(t: Template) {
    if (activeSlide) {
      // Snapshot first: trying a template on an AI-designed slide is the
      // change most likely to be regretted, and it looks destructive even
      // though it is not.
      snapshotForUndo(activeSlide);
      // Dropping layoutJson matters: paintSlide forks on templateId, so a
      // stale spec left behind a real template id would be invisible until
      // someone switched back and got a layout they thought they had replaced.
      // designHtml and renderFilename are deliberately KEPT, so undo can put
      // the design back without asking the model for it again.
      updateActiveSlide({
        templateId: t.id,
        aspectRatio: t.aspectRatio,
        layoutJson: null,
      });
    } else {
      void addSlide(t);
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
      dispatch({ type: "slideDeleted", slideId: activeSlide.id });
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
    dispatch({
      type: "patchSlide",
      slideId: captionSlide.id,
      patch: { caption: next },
    });
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
        dispatch({ type: "slidesReplaced", slides: newSlides as CarouselSlide[] });
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
      dispatch({ type: "slidesReplaced", slides: newSlides as CarouselSlide[] });
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
      router.push("/content-studio");
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't delete.");
    }
  }

  /**
   * Upload photographs ONE PER REQUEST, reporting how far through it is.
   *
   * Every file used to go up in a single multipart request: nothing could be
   * reported until the whole batch landed, the server resized all of them
   * inside one 60-second route, and a single unsupported file failed the lot.
   * Twenty photographs off a phone was indistinguishable from stuck, which is
   * exactly what it was.
   *
   * One file per request means the count is real, each request is small
   * enough to finish, a bad file fails alone, and the photographs appear in
   * the panel as they arrive rather than all at the end.
   */
  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setActionError(null);
    setUploadProgress({ done: 0, total: files.length });
    const failed: string[] = [];
    let firstUploadedId: number | null = null;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const fd = new FormData();
          fd.append("file", file);
          const dims = await readImageDimensions(file);
          fd.append("width", String(dims?.width ?? 0));
          fd.append("height", String(dims?.height ?? 0));
          const res = await fetch("/api/content-studio/image-library", {
            method: "POST",
            body: fd,
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || "Upload failed.");
          const created = (json.assets as ImageLibraryAsset[]) ?? [];
          if (created.length > 0) {
            setLibrary((prev) => [...created, ...prev]);
            if (firstUploadedId == null) firstUploadedId = created[0].id;
          }
        } catch (err) {
          failed.push(
            `${file.name}${err instanceof Error && err.message ? ` (${err.message})` : ""}`,
          );
        } finally {
          setUploadProgress({ done: i + 1, total: files.length });
        }
      }
      if (failed.length > 0) {
        setActionError(
          failed.length === files.length
            ? `Upload failed: ${failed[0]}`
            : `${failed.length} of ${files.length} didn't upload: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`,
        );
      }
      // Only a SINGLE upload puts the photograph on the slide. Dropping a
      // folder of the client's photography into the library is stocking it,
      // not choosing a background — and on a designed slide each apply costs
      // a server-side re-render, so doing it mid-batch fought the upload.
      if (files.length === 1 && firstUploadedId != null) {
        setSlideBackgroundManually(firstUploadedId);
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
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
    const blob = await slideToBlob(
      activeSlide,
      activeIdx,
      total,
      library,
      slideFonts(activeSlide),
      brand,
      showLogo ? logoImg : null,
      designSystem,
    );
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug =
      (name || `renova-${surface?.id ?? "design"}`)
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
        const blob = await slideToBlob(
          slidesInSlot[i],
          i,
          slidesInSlot.length,
          library,
          slideFonts(slidesInSlot[i]),
          brand,
          showLogo ? logoImg : null,
          designSystem,
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

  /**
   * What the inspector reads. A composed slide has no Template — its id is the
   * sentinel — so asking getTemplate and treating null as "empty" reported
   * five real slides as an empty slot. Everything the editor DISPLAYS comes
   * from here; `template` above is kept only for the places that need a real
   * Template object.
   */
  const surface = useMemo(
    () => (activeSlide ? slideSurface(activeSlide, designSystem) : null),
    [activeSlide, designSystem],
  );

  // What you're making isn't stored anywhere — it IS which slot you're in.
  // Deriving it means the switch can't drift out of step with the slides on
  // screen, which is the whole class of bug that made a carousel look lost.
  const isCarouselKind = isCarouselSlot(activeSlot);
  const designKind: DesignKind = isCarouselKind ? "carousel" : "single";

  // The first existing carousel slot, or the canonical one for a new carousel.
  const carouselSlotFor = useCallback(
    () =>
      slides.find((s) => isCarouselSlot(s.slotKey))?.slotKey ??
      DEFAULT_CAROUSEL_SLOT,
    [slides],
  );

  // Switching kind maps to a slot: single images all live in the "default"
  // slot, a carousel in a carousel slot. This keeps a generated carousel where
  // the carousel view can see it and stops a single-image format being applied
  // to — and getting stuck on — the carousel.
  const selectKind = useCallback(
    (kind: DesignKind) => {
      dispatch({
        type: "selectSlot",
        slotKey: kind === "carousel" ? carouselSlotFor() : DEFAULT_SLOT,
      });
    },
    [carouselSlotFor],
  );

  const templateGroups = useMemo(
    () => (isCarouselKind ? carouselTemplateGroups() : singleTemplateGroups()),
    [isCarouselKind],
  );

  // Slots other than the one on screen. Only legacy designs have any: the old
  // picker made a parallel carousel every time you clicked a carousel card.
  const otherSlots = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of slides) {
      if (s.slotKey === activeSlot) continue;
      counts.set(s.slotKey, (counts.get(s.slotKey) ?? 0) + 1);
    }
    return [...counts.entries()].map(([key, count]) => ({
      key,
      count,
      label:
        getTemplate(key)?.name ??
        (key === DEFAULT_SLOT ? "Single post" : key),
    }));
  }, [slides, activeSlot]);


  // We DON'T early-return when activeSlide is null — the slot may simply be
  // empty (e.g. the user clicked a Carousels template card for the first
  // time). The toolbar + template picker stay visible so the user can switch
  // slots or hit Generate.
  const previewMaxWidth = surface?.aspectRatio === "9:16" ? 320 : 460;
  /**
   * The photo library takes its width in the flow beside the preview, so the
   * column has to grow by the same amount while it is open -- otherwise the
   * panel would come out of the slide, which is the thing it used to cover.
   * The room comes from the controls column, which has it to give.
   */
  const [photosOpen, setPhotosOpen] = useState(false);
  /** How far through a multi-file upload we are; null when none is running. */
  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const previewColMax = 480 + (photosOpen ? PHOTO_PANEL_WIDTH + 8 : 0);
  const isEmptySlot = !activeSlide || !surface;

  return (
    // Named so the mobile rules can reach it. A grid with no explicit columns
    // gets ONE implicit `auto` track, and an auto track is sized by its
    // content rather than by its box -- so on a phone this stack sized itself
    // to the filmstrip's 680px min-content and its children were clipped by
    // .app-main's overflow-x:hidden. See globals.css.
    <div className="cs-editor-stack" style={{ display: "grid", gap: 18 }}>
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
          <Label htmlFor="design-name" srOnly>Design name</Label>
          <Input
            id="design-name"
            value={name}
            placeholder="Design name"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingTop: 22,
            // The row above wraps; this group did not, so on a phone its four
            // buttons ran past the edge and "Export all (.zip)" was sliced in
            // half by .app-main's overflow-x:hidden.
            flexWrap: "wrap",
          }}
        >
          <SaveStatus status={saveStatus} />
          {slidesInSlot.length > 0 && !writing && (
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
              // A toggle's ON state must not look like the page's primary
              // action -- it sat in the top bar at the same weight as the one
              // button that should own it. Secondary reads as "on" without
              // competing (Von Restorff: emphasis works only when scarce).
              variant={showLogo ? "secondary" : "outline"}
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

      {writing && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            padding: "10px 12px",
            border: "1px solid var(--hairline)",
            background: "var(--surface-2)",
            borderRadius: "var(--radius)",
          }}
        >
          <Loader2 size={15} className="spin" />
          <span>
            Adonis is writing this design. It keeps going if you leave this page
            — come back any time and the slides will be here.
          </span>
        </div>
      )}

      {generationError && !writing && (
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
          Writing the slides failed: {generationError}
        </div>
      )}

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
      {/* A design being WRITTEN has nothing to edit yet. The editor used to show
          the SEED slide underneath -- a blank template with placeholder copy --
          which reads as "it opened a different design" at precisely the moment
          the real one is being written. Show the work instead. */}



      <div
        className="cms-editor-grid"
        style={{
          display: "grid",
          // The second track keeps a floor so a narrow laptop doesn't crush the
          // controls to make room: past that, grid gives the preview column
          // less than its max and the panel takes its width off the slide
          // instead -- smaller, but never covered, which was the point.
          gridTemplateColumns: photosOpen
            ? `minmax(320px, ${previewColMax}px) minmax(360px, 1fr)`
            : `minmax(320px, ${previewColMax}px) 1fr`,
          gap: 28,
          alignItems: "start",
          // The column resizes rather than jumping, in step with the panel
          // opening inside it. Below 860px the stylesheet collapses this to a
          // single column with !important, so none of this applies there.
          transition: "grid-template-columns 0.2s var(--ease)",
        }}
      >
        {/* Preview */}
        <div className="cms-preview-col" style={{ display: "grid", gap: 14, position: "sticky", top: 24 }}>
          {/* While a design is being WRITTEN there is no slide to show -- the
              seed slide underneath is a blank template, and showing it reads as
              "it opened a different design". Only THIS column is replaced: the
              template panel beside it is how an operator starts and steers a
              design, and hiding the whole editor took that with it. */}
          {writing ? (
            <WritingDesign stage={generationStage} />
          ) : (
          <>
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
                Nothing here yet
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  maxWidth: 320,
                  margin: "0 auto",
                }}
              >
                {isCarouselKind ? (
                  <>
                    Hit <strong>Generate carousel</strong> to have Adonis write
                    the series, or pick a template to start the first slide
                    yourself.
                  </>
                ) : (
                  <>Pick a template to start this post.</>
                )}
              </div>
            </div>
          ) : (
            activeSlide && (
              /* The photo library is a tab on the OUTSIDE of the preview card,
                 laid out beside it. It was a strip under the slide (a scroll
                 away from what it changed) and then a pill on the slide itself
                 (read as part of the design). Here it is neither. */
              <div style={{ display: "flex", alignItems: "stretch" }}>
                <SlidePhotoLibraryPopout
                  onOpenChange={setPhotosOpen}
                  photoCount={imageLibrary.length}
                  assets={imageLibrary}
                  activeAssetId={activeSlotAssetId}
                  slots={photoSlots}
                  activeSlot={effectivePhotoSlot}
                  onSlotChange={setPhotoSlot}
                  onPick={setSlideBackgroundManually}
                  onUpload={uploadFiles}
                  onDelete={deleteAsset}
                  uploading={uploading}
                  uploadProgress={uploadProgress}
                  applyingAssetId={
                    rephotographing?.slideId === activeSlide.id
                      ? rephotographing.assetId
                      : null
                  }
                  canClear={activeSlide.templateId !== DESIGNED_TEMPLATE_ID}
                />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "var(--surface-1)",
                  border: "1px solid var(--hairline)",
                  // Flush against the tab when the panel is folded away; its
                  // own card, with a gap, once the panel sits between them.
                  borderRadius: photosOpen
                    ? "var(--radius)"
                    : "0 var(--radius) var(--radius) 0",
                  marginLeft: photosOpen ? 8 : 0,
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
                    system={designSystem}
                    textEdit={{
                      carouselId: designId,
                      // The server has already written the new markup and
                      // render; this just points the row at the new file so the
                      // preview and the filmstrip both pick it up.
                      onEdited: (renderFilename) => updateActiveSlide({ renderFilename }),
                    }}
                  />
                  {/* Only where it does something. A DESIGNED slide records
                      which photograph it used, but that photograph is embedded
                      in its markup and cropped at render time -- dragging a
                      focal point over it would move nothing and save a value
                      no renderer reads. */}
                  {activeSlide.backgroundAssetId != null && !surface?.designed && (
                    <FocalOverlay
                      x={activeSlide.backgroundOffsetX}
                      y={activeSlide.backgroundOffsetY}
                      onChange={(backgroundOffsetX, backgroundOffsetY) =>
                        updateActiveSlide({ backgroundOffsetX, backgroundOffsetY })
                      }
                    />
                  )}

                  {/* The slide is being drawn again on the server. Over the
                      picture, because that is where the operator is looking --
                      a spinner in the strip below answers "did my click land",
                      this answers "is this still the old one". */}
                  {rephotographing?.slideId === activeSlide.id && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 9,
                        borderRadius: "var(--radius)",
                        background: "rgba(0,0,0,0.55)",
                        color: "#fff",
                        fontSize: 13,
                      }}
                    >
                      <Loader2 size={16} className="spin" />
                      Redrawing this slide…
                    </div>
                  )}
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
              </div>
            )
          )}

          <DesignNotice violations={designViolations} />

          {/* The strip is what makes a carousel look like a carousel: the big
              preview shows the slide you're editing, this shows the series it
              sits in. It replaces a two-column thumbnail grid that had no
              preview at all — so the ORDER, the one thing a carousel is, was
              the one thing you couldn't see or change. */}
          {!isEmptySlot && (isCarouselKind || isCarousel) && (
            <SlideFilmstrip
              slides={slidesInSlot}
              activeIdx={activeIdx}
              onSelect={(index) => dispatch({ type: "setActiveIndex", index })}
              onReorder={reorderSlidesInSlot}
              onAdd={() => addSlide()}
              fontsReady={fontsReady}
              library={library}
              defaultHeadingFontId={defaultHeadingFontId}
              defaultBodyFontId={defaultBodyFontId}
              brand={brand}
              logo={showLogo ? logoImg : null}
              system={designSystem}
            />
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
              ? "Nothing in this design yet"
              : isCarousel
                ? `Editing slide ${padNumber(activeIdx + 1, 2)} of ${padNumber(total, 2)}`
                : isCarouselKind
                  ? // A carousel that's one slide in — don't call it a single
                    // image when the switch above says Carousel.
                    "Editing slide 01 — add more to build the series"
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
                onClick={() => addSlide()}
                title="Add another slide to make this a carousel"
              >
                <Plus size={14} />
                Add slide
              </Button>
              {undoDepth > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={undoSlide}
                  title={
                    undoDepth === 1
                      ? `Put this slide back the way it was (${shortcutLabel("Z", { platform: shortcutPlatform })})`
                      : `Step back through ${undoDepth} changes to this slide (${shortcutLabel("Z", { platform: shortcutPlatform })})`
                  }
                >
                  <Undo2 size={14} />
                  {undoDepth > 1 ? `Undo (${undoDepth})` : "Undo"}
                </Button>
              )}
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
            {/* Both slide colours, next to the thing they change. They used to
                sit in the Style section down the controls column, so picking
                one meant scrolling away from the preview you were picking it
                for. */}
            {activeSlide && (
              <SlideColorPicker
                accent={activeSlide.accentColor}
                background={activeSlide.backgroundColor}
                onAccent={(accentColor) => updateActiveSlide({ accentColor })}
                onBackground={(backgroundColor) =>
                  updateActiveSlide({ backgroundColor })
                }
                accentSwatches={ACCENT_SWATCHES}
                backgroundSwatches={BACKGROUND_SWATCHES}
              />
            )}
            {!isEmptySlot && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {activeSlide && surface?.designed && (
                  <RedesignSlideButton
                    designId={designId}
                    slide={activeSlide}
                    imageGenEnabled={imageGenEnabled}
                    photoEditEnabled={photoEditEnabled}
                    // "Make a new photo" replaces the picture the photo panel
                    // is pointing at, not always the first one.
                    photoSlot={effectivePhotoSlot}
                    onBeforeRedesign={() => snapshotForUndo(activeSlide)}
                    onUpdated={(next) => dispatch({ type: "slideUpdated", slide: next })}
                  />
                )}
                {!surface?.designed && (
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
                )}
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

          {surface && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text-tertiary)",
                textAlign: "center",
                letterSpacing: "0.04em",
              }}
            >
              {surface.aspectRatio} · {surface.width}×{surface.height} ·{" "}
              {surface.name}
            </div>
          )}

          </>
          )}
        </div>

        {/* Controls column — grouped into collapsible Template / Content / Style / Layout sections */}
        <div style={{ display: "grid", gap: 12 }}>
          <EditorSection title="Template" defaultOpen>
          <div>
            {/* The six-tab row that used to sit here asked the wrong question.
                Social vs Stories vs Promos was never a mode to BE in — just a
                way to find a card — while the one real decision (a series of
                slides, or one image?) was buried as the third tab along, under
                a name that collided with the Generate button. Now the kind is
                the switch, and the categories are labels you scroll past. */}
            <Label>What you&rsquo;re making</Label>
            <div
              role="group"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 2,
                padding: 2,
                background: "var(--surface-2)",
                borderRadius: "var(--radius)",
                marginBottom: 10,
              }}
            >
              {(
                [
                  { kind: "single" as const, label: "Single post" },
                  { kind: "carousel" as const, label: "Carousel" },
                ]
              ).map((o) => {
                const active = designKind === o.kind;
                return (
                  <button
                    key={o.kind}
                    type="button"
                    onClick={() => selectKind(o.kind)}
                    aria-pressed={active}
                    style={{
                      padding: "9px 12px",
                      borderRadius: "calc(var(--radius) - 2px)",
                      border: "none",
                      background: active ? "var(--bg)" : "transparent",
                      color: active
                        ? "var(--text-primary)"
                        : "var(--text-secondary)",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {o.label}
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
              {isCarouselKind
                ? "Square slides designed to be posted as a 3-7 slide series."
                : "One image. Pick the look that fits what you're saying."}
            </div>
            {/* Generation belongs WITH the carousels. In the toolbar it showed on
                every category, sitting above the template grid as "Generate
                carousel" while a "Carousels" tab meant something else entirely —
                two different jobs under near-identical names. */}
            {isCarouselKind && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <GenerateCarouselButton
              designId={designId}
              designName={name}
              slotKey={isCarouselSlot(activeSlot) ? activeSlot : carouselSlotFor()}
              defaultTopic={
                slidesInSlot[0]?.headingText?.trim() ||
                slides[0]?.headingText?.trim() ||
                name.trim() ||
                ""
              }
              onStarted={(startedSlot) => {
                lastSavedRef.current = {};
                // Switch to the slot the run writes into, so the slides land in
                // front of the operator rather than in a tab they have to find.
                // The kind follows the slot on its own.
                // Turns the poll on immediately too, so the banner shows
                // without waiting for the first tick to confirm what we
                // already know.
                dispatch({
                  type: "generationStarted",
                  slotKey: isCarouselSlot(startedSlot)
                    ? startedSlot
                    : DEFAULT_CAROUSEL_SLOT,
                });
              }}
            />
                <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
                  Writes a whole slide series on a topic
                </span>
              </div>
            )}
            {/* The brand's OWN slide types, when the account has a design
                direction and this slide was designed by Adonis. They are not
                painters like the cards below -- there is no canvas code behind
                a "Dossier page" -- they are the structures the direction is
                built from, which the designer already has in its prompt. So
                picking one asks for this slide again AS that type, which is the
                closest thing to a template a composed slide can have. */}
            {activeSlide && (designSystem?.templates?.length ?? 0) > 0 && (
              <DirectionTemplates
                designId={designId}
                slideId={activeSlide.id}
                designed={!!surface?.designed}
                templates={designSystem!.templates}
                onBeforeRedesign={() => snapshotForUndo(activeSlide)}
                onUpdated={(next) => dispatch({ type: "slideUpdated", slide: next })}
              />
            )}

            {/* One scroll, labelled. A carousel template card used to switch
                you to a different, parallel carousel rather than restyle the
                slide in front of you — the templates read as slide ROLES
                ("Series opener", "Closing slide"), so that was backwards.
                Cards now restyle the current slide in both kinds. */}
            {templateGroups.map((group) => (
              <div key={group.label} style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text-tertiary)",
                    marginBottom: 7,
                  }}
                >
                  {group.label}
                </div>
                {/* NAME ONLY, packed tight. Every card used to carry its
                    blurb and its aspect ratio, which made a list of ~14
                    choices into a wall of prose four screens long -- and the
                    blurb is the one thing you do not need while SCANNING for
                    a name you already recognise. It moves to the tooltip, so
                    it is there when you want it and silent when you don't.
                    auto-fill rather than a fixed count: the panel is 320-480px
                    on desktop and 358px on a phone, and this packs as many
                    chips as fit either way. */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))",
                    gap: 6,
                  }}
                >
                  {group.templates.map((t) => {
                    const active = activeSlide?.templateId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => applyTemplate(t)}
                        aria-pressed={active}
                        title={`${t.name} — ${t.blurb} (${t.aspectRatio})`}
                        style={{
                          textAlign: "left",
                          padding: "8px 10px",
                          borderRadius: "var(--radius-sm)",
                          border: active
                            ? "1px solid var(--text-primary)"
                            : "1px solid var(--hairline)",
                          background: active ? "var(--surface-2)" : "var(--bg)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: 12,
                          fontWeight: active ? 600 : 500,
                          lineHeight: 1.25,
                          color: "var(--text-primary)",
                          // A name too long for its chip is clipped with an
                          // ellipsis rather than wrapping: equal-height chips
                          // are what make a dense grid scannable.
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          minWidth: 0,
                        }}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {/* Designs made before the kind was a single choice could hold
                several parallel carousels. Nothing creates them any more, so
                this only appears for the handful that already exist. */}
            {otherSlots.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text-tertiary)",
                    marginBottom: 7,
                  }}
                >
                  Also in this design
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {otherSlots.map((slot) => (
                    <button
                      key={slot.key}
                      type="button"
                      onClick={() => {
                        dispatch({ type: "selectSlot", slotKey: slot.key });
                      }}
                      style={{
                        padding: "7px 11px",
                        borderRadius: "var(--radius)",
                        border: "1px solid var(--hairline)",
                        background: "var(--bg)",
                        color: "var(--text-secondary)",
                        fontSize: 12,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {slot.label}
                      <span style={{ color: "var(--text-tertiary)" }}>
                        {" "}
                        · {slot.count} slide{slot.count === 1 ? "" : "s"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          </EditorSection>

          {/* Everything below acts on a SLIDE, and while a design is being
              written the slide on screen is the seed one about to be deleted.
              The Template section above stays: it is how the design was started
              and how it is steered. */}
          {!writing && (
          <>

          {/* The caption belongs to the POST, not to a slide -- it is stored
              on slide[0] and goes out with the whole carousel. It used to sit
              inside the Content section, which meant AI-designed slides lost
              it entirely when that section became template-only: the caption
              was being written and saved, and simply had nowhere to appear. */}
          <EditorSection
            title="Caption"
            hint={isCarousel ? "The whole carousel" : "Goes out with the post"}
            defaultOpen
          >
          {captionSlide && (
            <div
              style={{
                borderTop: "1px solid var(--hairline)",
                paddingTop: 14,
                display: "grid",
                gap: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    Post caption
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-tertiary)",
                      marginLeft: 8,
                    }}
                  >
                    {isCarousel
                      ? "the whole carousel, not this slide"
                      : "goes out with the post"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    type="button"
                    variant="ghost"
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
                    {refreshing === "caption" ? "Refreshing…" : "Refresh"}
                  </Button>
                </div>
              </div>
              <Textarea
                value={caption}
                onChange={(e) => updateCaption(e.target.value)}
                placeholder={
                  "Write the caption here, or click Refresh to generate one with Claude."
                }
                spellCheck
                style={{
                  minHeight: 160,
                  fontSize: 13,
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
                  ? `${caption.split(/\s+/).filter(Boolean).length} words · ${caption.length} chars · auto-saves as you type`
                  : "Empty — click Refresh to generate one."}
              </div>
            </div>
          )}
          </EditorSection>

          {activeSlide && surface && !surface.designed && (
          <>
          <EditorSection
            title="Content"
            hint={total > 1 ? `Slide ${activeIdx + 1} of ${total}` : "This post"}
            defaultOpen
          >
          {surface.usesTagline && (
            <div>
              <Label htmlFor="tagline">
                {surface.category === "carousels"
                  ? "Slide indicator (auto-numbered if blank)"
                  : "Tagline"}
              </Label>
              <Input
                id="tagline"
                value={activeSlide.tagline ?? ""}
                placeholder={
                  surface.taglineHint ?? autoTagline(activeIdx, total) ?? ""
                }
                onChange={(e) =>
                  updateActiveSlide({ tagline: e.target.value || null })
                }
              />
            </div>
          )}

          <div>
            {/* The field itself keeps its name in the placeholder (house
                style), but a stepper can't — so this one is labelled. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  letterSpacing: "0.04em",
                }}
              >
                Heading size
              </span>
              <HeadingSizeControl
                value={activeSlide.headingScale ?? 1}
                onChange={(headingScale) => updateActiveSlide({ headingScale })}
              />
            </div>
            <Label htmlFor="heading" srOnly>
              Heading
            </Label>
            <Textarea
              id="heading"
              value={activeSlide.headingText}
              placeholder="Heading"
              onChange={(e) =>
                updateActiveSlide({ headingText: e.target.value })
              }
              style={{ minHeight: 70 }}
            />
          </div>

          <div>
            <Label htmlFor="body" srOnly>Body text</Label>
            <Textarea
              id="body"
              value={activeSlide.bodyText}
              placeholder="Body text"
              onChange={(e) =>
                updateActiveSlide({ bodyText: e.target.value })
              }
            />
          </div>

          {/* The caption belongs with the words, not under the whole editor —
              it used to be a full-width block below the grid, so the copy that
              actually ships with the post was the one thing you had to scroll
              past every control to reach. It is per-POST, not per-slide, hence
              the rule above it and the note. */}
          </EditorSection>

          <EditorSection
            title="Style"
            hint={total > 1 ? "This slide" : "This post"}
            defaultOpen
          >
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
          </EditorSection>

          <EditorSection
            title="Layout & photo"
            hint={total > 1 ? `Slide ${activeIdx + 1} of ${total}` : "This post"}
            defaultOpen
          >
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
              <div style={{ gridColumn: "1 / -1" }}>
                <Label>Photo position</Label>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12,
                    padding: "6px 0 2px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono), ui-monospace, monospace",
                      color: "var(--text-secondary)",
                    }}
                  >
                    x {Math.round(activeSlide.backgroundOffsetX * 100)}% · y{" "}
                    {Math.round(activeSlide.backgroundOffsetY * 100)}%
                  </span>
                  <span style={{ color: "var(--text-tertiary)" }}>
                    — drag the point on the preview
                  </span>
                </div>
              </div>
            </div>
          )}
          </EditorSection>
          </>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * What the editor shows while a detached generation is running.
 *
 * A slide-shaped frame with its lines filling in, on the square the real slides
 * will occupy -- so the page does not reflow when they arrive, and so nothing
 * on screen claims to be a design that is not one. The copy says the run
 * survives leaving, because that is the thing an operator cannot see and would
 * otherwise assume the opposite of.
 */
function WritingDesign({ stage }: { stage?: string | null }) {
  // Three blobs, each on its own path and its own clock, so the field never
  // repeats a frame an operator could catch. Sized well over the frame: a blob
  // whose edge is visible reads as a circle, and the point is a field of light.
  const blobs = [
    { anim: "designDriftA", dur: "13s", size: "88%", left: "-18%", top: "-14%", colour: "color-mix(in srgb, var(--accent) 70%, transparent)" },
    { anim: "designDriftB", dur: "17s", size: "76%", left: "26%", top: "8%", colour: "color-mix(in srgb, var(--accent) 38%, #4a9eff)" },
    { anim: "designDriftC", dur: "21s", size: "94%", left: "-6%", top: "22%", colour: "color-mix(in srgb, var(--accent) 22%, transparent)" },
  ];
  return (
    <div
      style={{
        display: "grid",
        gap: 14,
        justifyItems: "center",
        padding: "8px 0 24px",
      }}
    >
      <div
        className="design-writing"
        style={{
          width: "min(520px, 100%)",
          aspectRatio: "1 / 1",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
        }}
      >
        {blobs.map((b) => (
          <div
            key={b.anim}
            className="design-writing-blob"
            style={{
              width: b.size,
              height: b.size,
              left: b.left,
              top: b.top,
              background: b.colour,
              opacity: 0.5,
              animation: `${b.anim} ${b.dur} ease-in-out infinite`,
            }}
          />
        ))}
        <div className="design-writing-grid" />
        <div className="design-writing-sweep" />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          fontSize: 13,
          color: "var(--text-secondary)",
        }}
      >
        <Loader2 size={14} className="spin" />
        {stage?.trim() || "Writing the slides."}
      </div>
    </div>
  );
}

/**
 * The designer's autosave indicator — silent unless the save FAILED.
 *
 * Same rule as the settings forms' SaveStatus (components/settings/
 * SaveStatus.tsx): autosave that works needs no announcement, and a "Saved"
 * flashing on every edit reads as activity rather than reassurance. A failure
 * still shouts, because that is the case where the work exists only on screen.
 *
 * The empty spacer is kept so the toolbar doesn't shift when a failure appears
 * and clears.
 */
function SaveStatus({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error";
}) {
  const text = status === "error" ? "Save failed" : "";
  const color = "#dc2626";
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
  designName,
  slotKey,
  defaultTopic,
  onStarted,
}: {
  designId: number;
  /** Used only to name the design in the completion notification. */
  designName: string;
  slotKey: string;
  defaultTopic: string;
  /** The run is QUEUED, not finished -- the editor polls for the slides. */
  onStarted: (slotKey: string) => void;
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
    // requestSubmit() with no submitter ignores the button's disabled state
    // (per spec), and the textarea's Cmd+Enter handler calls it directly --
    // so a second press inside the request window has to be stopped here,
    // not by disabling a control the second press never looks at.
    if (submitting) return;
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
      // The response says the run STARTED. The slides are written by a detached
      // continuation and arrive through the editor's poll, which is what lets
      // the operator navigate away without killing the generation.
      //
      // Which is exactly why the watch is registered HERE: the editor's poll
      // dies with this page, so the shell's watcher is what tells them it
      // finished once they have gone elsewhere. This click is also the gesture
      // that makes the notification-permission prompt expected -- watchGeneration
      // asks for it, and only ever from here.
      watchGeneration(designId, designName);
      setOpen(false);
      onStarted(slotKey);
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
            <Label htmlFor="gen-topic" srOnly>Topic</Label>
            <Textarea
              id="gen-topic"
              required
              value={topic}
              placeholder="Topic"
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter submits from inside the box, where you are
                // when you have finished typing. Plain Enter stays a newline:
                // a topic is often more than one line.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              style={{ minHeight: 70 }}
            />
            <PostIdeas onPick={(topic) => setTopic(topic)} />
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
              <Label htmlFor="gen-tone" srOnly>Tone (optional)</Label>
              <Input
                id="gen-tone"
                value={tone}
                placeholder="Tone (optional)"
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

/**
 * The brand-rule notice for an AI-composed slide.
 *
 * It is EDITOR-ONLY: this is DOM, drawn beside the canvas and never into it,
 * so nothing here can reach an exported PNG. That is deliberate — a violation
 * is information for the operator, not a watermark on their work.
 *
 * It is also non-blocking. A slide that breaks a rule is still shown, still
 * editable and still exportable; what it is not is silently swapped for a
 * fixed template or quietly hidden. The text quotes the actual measurement
 * ("Body is deep-green on sage: 3.62:1, below the 4.5:1 this system requires
 * for body text") because a generic warning tells an operator nothing about
 * what to change.
 */
function DesignNotice({ violations }: { violations: string[] }) {
  if (violations.length === 0) return null;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "12px 14px",
        borderRadius: "var(--radius)",
        border: "1px solid var(--hairline)",
        background: "var(--surface-1)",
        color: "var(--text-secondary)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <AlertTriangle
        size={15}
        style={{ flexShrink: 0, marginTop: 2, color: "var(--accent)" }}
      />
      <div>
        <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
          {violations.length === 1
            ? "This slide breaks a brand rule"
            : `This slide breaks ${violations.length} brand rules`}
        </div>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {violations.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The design direction's own slide types, as cards.
 *
 * An operator asked for "those templates" in the template panel, and the honest
 * answer is that they are not templates in the sense the cards below are: a
 * direction's slide types are STRUCTURES described to the designer, with no
 * canvas painter behind them. What they can be is a steer. The full structure
 * text is already in the model's system prompt (describeSystemForDesign), so
 * naming the type is enough -- which also keeps the note well under the
 * redesign route's 400-character cap.
 */
function DirectionTemplates({
  designId,
  slideId,
  designed,
  templates,
  onUpdated,
  onBeforeRedesign,
}: {
  designId: number;
  slideId: number;
  /** Whether this slide is already an Adonis design, or a fixed template being converted. */
  designed: boolean;
  templates: { name: string; structure: string }[];
  onUpdated: (slide: CarouselSlide) => void;
  onBeforeRedesign: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(name: string) {
    onBeforeRedesign();
    setBusy(name);
    setError(null);
    try {
      const res = await fetch(`/api/content-studio/carousels/${designId}/redesign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slideId,
          note: `Redesign this slide as the "${name}" slide type from this brand's own set, following that structure exactly. Keep the words; change the composition.`,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        setError("The app was restarting. Give it a few seconds and try again.");
        return;
      }
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setError(json?.error ?? `Couldn't redesign that slide (HTTP ${res.status}).`);
        return;
      }
      const next = (json.carousel?.slides as CarouselSlide[] | undefined)?.find(
        (sl) => sl.id === slideId,
      );
      if (next) onUpdated(next);
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "TimeoutError"
          ? "That took too long and was stopped. Try again in a moment."
          : "Couldn't reach the server. Try again in a moment.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          marginBottom: 7,
        }}
      >
        {designed ? "This slide, as" : "Redesign this slide as"}
      </div>
      {!designed && (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--text-tertiary)",
            lineHeight: 1.5,
            marginBottom: 9,
          }}
        >
          Adonis will compose this slide from scratch in one of your brand&rsquo;s own
          structures, keeping the words. It stops being a fixed template.
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        {templates.map((t) => (
          <button
            key={t.name}
            type="button"
            onClick={() => pick(t.name)}
            disabled={busy !== null}
            title={t.structure}
            style={{
              textAlign: "left",
              padding: "12px 14px",
              borderRadius: "var(--radius)",
              border: "1px solid var(--hairline)",
              background: "var(--bg)",
              cursor: busy ? "default" : "pointer",
              fontFamily: "inherit",
              display: "grid",
              gap: 4,
              opacity: busy && busy !== t.name ? 0.5 : 1,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {busy === t.name && <Loader2 size={13} className="spin" />}
              {t.name}
            </span>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-tertiary)",
                letterSpacing: "0.02em",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {t.structure}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--danger)" }}>{error}</div>
      )}
    </div>
  );
}

/**
 * Redesigning an AI-designed slide: one button beside the picture, and a
 * dialog that asks what to change.
 *
 * It was a permanent inspector section -- a paragraph, a labelled field and two
 * buttons -- sitting far below the slide it acted on. An operator's verdict:
 * "there's no need for a big section like that". The action is occasional and
 * the question it asks is one line, so it belongs behind a button, next to the
 * thing it changes.
 *
 * There are still no heading, body or colour controls. The AI decided where the
 * heading goes, so there is no fixed slot for a control to point at; what an
 * operator can do is judge the result and ask for a different one.
 */
function RedesignSlideButton({
  designId,
  slide,
  onUpdated,
  onBeforeRedesign,
  imageGenEnabled = false,
  photoEditEnabled = false,
  photoSlot = 1,
}: {
  designId: number;
  slide: CarouselSlide;
  onUpdated: (slide: CarouselSlide) => void;
  onBeforeRedesign: () => void;
  imageGenEnabled?: boolean;
  /** Whether "Change this photo" can run — a different provider from
   *  generation, so a separate key and a separate flag. */
  photoEditEnabled?: boolean;
  /** Which photograph "Make a new photo" replaces, 1-based. */
  photoSlot?: number;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | DialogPhase>(null);
  const [error, setError] = useState<string | null>(null);
  /** What the last run turned out to be, so the dialog can say so and offer
   *  the routes it did NOT take. Null until something has run. */
  const [lastIntent, setLastIntent] = useState<SlideIntent | null>(null);
  // Seconds since the current action started, ticking once a second while
  // busy. Reset with busy so a second action never inherits the first's clock.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    // Reset unconditionally, before the interval starts: a phase change
    // still renders once with the OLD elapsed value, and without this reset
    // that stale number briefly shows against the new phase's label.
    setElapsed(0);
    if (busy === null) return;
    const started = Date.now();
    const id = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  // The scene the DESIGN asked for FOR THE TARGETED SLOT, recorded when the
  // slide was written. Per slot, and the same resolution the generate route
  // makes, because a comparison asks for two different pictures -- infrared
  // above, HBOT below -- and showing slot 1's scene whichever slot the
  // operator had selected described a photograph they were not about to get.
  // A slide with none either predates the field or was composed without a
  // photograph, and there is nothing to generate against in either case.
  const scene = sceneForSlot(slide.photoScenes, slide.imagePrompt, photoSlot);
  // A slide designed on a flat ground has nowhere to put a picture, so making
  // one redesigns the slide around it — slower, and worth saying so.
  // Asks the module that owns the placeholder rather than matching a literal:
  // a slide using only the indexed form has a photo slot too, and a bare
  // `.includes("{{PHOTO}}")` would have said it did not and sent the operator
  // down the redesign-around-a-new-photo path for no reason.
  const hasPhotoSlot = usesPhoto(slide.designHtml ?? "");
  // A slot with a MARKUP place for a photograph may still be holding none.
  // Editing needs an actual picture to edit, so the button that offers it
  // waits until there is one rather than failing at the server.
  const hasPhotoInSlot =
    parsePhotoAssetIds(slide.photoAssetIds, slide.backgroundAssetId)[photoSlot - 1] != null;

  function reset() {
    setNote("");
    setError(null);
    setLastIntent(null);
  }

  async function post(url: string, body: unknown, pick: (json: any) => CarouselSlide | undefined) {
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        setError("The app was restarting. Give it a few seconds and try again.");
        return;
      }
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setError(json?.error ?? `That didn't work (HTTP ${res.status}).`);
        return;
      }
      const next = pick(json);
      if (next) onUpdated(next);
      setOpen(false);
      reset();
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "TimeoutError"
          ? "That took too long and was stopped. Try again in a moment."
          : "Couldn't reach the server. Try again in a moment.",
      );
    }
  }

  async function redesign() {
    onBeforeRedesign();
    setBusy("designing");
    await post(
      `/api/content-studio/carousels/${designId}/redesign`,
      { slideId: slide.id, note: note.trim() || null },
      (json) =>
        (json.carousel?.slides as CarouselSlide[] | undefined)?.find(
          (sl) => sl.id === slide.id,
        ),
    );
    setBusy(null);
  }

  /**
   * ONE button. The sentence picks the route.
   *
   * There used to be three -- redesign, make a new photo, change this photo --
   * which asked the operator to classify their own request into a taxonomy
   * they have no reason to know, on top of having already described it in
   * words. Getting it wrong was silent: "change the guy in the photo to a
   * woman" sent to the layout model came back as a re-laid-out slide with the
   * same man in it, reported as a success.
   *
   * The classification is a cheap Haiku call and is FAIL-SOFT (see the
   * interpret route), so the button always does something. What it did is
   * named afterwards, with the other routes one click away -- the route is
   * invisible until it is wrong, and then it has to be both obvious and
   * cheap to correct.
   */
  async function interpretAndRun() {
    const typed = note.trim();
    if (!typed) {
      await redesign();
      return;
    }
    setBusy("reading");
    setError(null);
    let intent: SlideIntent = guessIntent(typed, {
      hasPhotoSlot,
      hasPhotoInSlot,
      canGenerate: imageGenEnabled,
      canEdit: photoEditEnabled,
    });
    try {
      const res = await fetch(
        `/api/content-studio/carousels/${designId}/slides/${slide.id}/interpret`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: typed, slot: photoSlot }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const json = await res.json().catch(() => null);
      if (json?.ok && json.intent) intent = json.intent as SlideIntent;
    } catch {
      // The local guess already stands in. A router that can block the
      // operator is worse than the three buttons it replaced.
    }
    setLastIntent(intent);
    if (intent === "editPhoto") await newPhoto("edit");
    else if (intent === "newPhoto") await newPhoto("generate");
    else await redesign();
  }

  /**
   * Two requests, so the button can say which one is running. Step 1 makes
   * the photograph and returns it. Step 2 is whichever this slide needs: a
   * swap when its markup has a photo slot, a redesign around the picture
   * when it does not. Everything the server does in one call it can do in
   * two; what it cannot do in one is tell the operator it is halfway.
   */
  /**
   * Make the picture for this slot, then put it on the slide.
   *
   * `mode` is the only difference between the two buttons. "generate" makes a
   * NEW photograph from the design's scene, steered by whatever was typed;
   * "edit" changes the photograph the slot already has, and the typed
   * instruction IS the request -- which is why it refuses without one.
   *
   * The note used to be dropped here entirely: the body carried no `note`, so
   * typing "replace the guy with a woman" and pressing Make a new photo
   * regenerated the same empty room and reported success.
   */
  async function newPhoto(mode: "generate" | "edit" = "generate") {
    const instruction = note.trim();
    if (mode === "edit" && !instruction) {
      setError("Say what to change about the photo.");
      return;
    }
    setBusy(
      mode === "edit"
        ? hasPhotoSlot
          ? "editingPhoto"
          : "editingPhotoThenDesign"
        : hasPhotoSlot
          ? "photo"
          : "photoThenDesign",
    );
    setError(null);
    let asset: ImageLibraryAsset | null = null;
    try {
      const res = await fetch(
        `/api/content-studio/carousels/${designId}/slides/${slide.id}/photo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The slot goes on step 1 too, though it writes nothing: a slot this
          // slide does not have is then refused BEFORE the generation is paid
          // for, rather than after.
          body: JSON.stringify(
            mode === "edit"
              ? { edit: true, note: instruction, slot: photoSlot }
              : {
                  generate: true,
                  onlyGenerate: true,
                  slot: photoSlot,
                  ...(instruction ? { note: instruction } : {}),
                },
          ),
          // Above the route's own 120s maxDuration -- mirrors post() below, so
          // a slow generation can't abort client-side after the server has
          // already finished (and charged) but before the response lands.
          signal: AbortSignal.timeout(180_000),
        },
      );
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        setError("The app was restarting. Give it a few seconds and try again.");
        setBusy(null);
        return;
      }
      const json = await res.json().catch(() => null);
      if (!json?.ok || !json.asset) {
        setError(json?.error ?? `Couldn't make the photo (HTTP ${res.status}).`);
        setBusy(null);
        return;
      }
      asset = json.asset as ImageLibraryAsset;
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "TimeoutError"
          ? "That took too long and was stopped. Try again in a moment."
          : "Couldn't reach the server. Try again in a moment.",
      );
      setBusy(null);
      return;
    }

    // From here, the photograph is already made and saved -- it was paid
    // for in step 1. If step 2 fails, `applied` stays false and the
    // operator has to be told the picture still exists, or a retry (the
    // only visible way forward on a slot-less slide) pays for a second one.
    let applied = false;
    const notePhotoSaved = () =>
      setError((prev) =>
        prev
          ? `${prev} The photograph was saved to the library.`
          : "The photograph was saved to the library.",
      );

    // Step 2 mutates the slide on BOTH branches -- a swap here, a redesign
    // below -- so the undo snapshot is taken once, right before it, either
    // way. Not before step 1: a step-1 failure would otherwise leave an
    // undo step on the stack that undoes nothing.
    onBeforeRedesign();

    if (hasPhotoSlot) {
      // Named for what this step actually is -- the slide being re-rendered
      // with the new photograph -- not still "making" it, which was step 1.
      setBusy("applyingPhoto");
      await post(
        `/api/content-studio/carousels/${designId}/slides/${slide.id}/photo`,
        { assetId: asset.id, slot: photoSlot },
        (json) => {
          applied = true;
          return json.slide as CarouselSlide | undefined;
        },
      );
    } else {
      setBusy("designing");
      await post(
        `/api/content-studio/carousels/${designId}/redesign`,
        { slideId: slide.id, note: "Use the photograph on this slide.", photoAssetId: asset.id },
        (json) => {
          applied = true;
          return (json.carousel?.slides as CarouselSlide[] | undefined)?.find(
            (sl) => sl.id === slide.id,
          );
        },
      );
    }
    if (!applied) notePhotoSaved();
    setBusy(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Step 2 is already paid for and runs invisibly once step 1 lands --
        // closing mid-flight would strand its error and the "saved to the
        // library" note inside a dialog nobody can see again. Dismissible
        // again the moment busy clears.
        if (busy !== null) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          title="Ask Adonis for a different design for this slide"
        >
          <RefreshCw size={14} />
          Redesign slide
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Redesign this slide"
        description="Say what you'd change, or leave it blank for a different take on the same content."
        onEscapeKeyDown={(e) => {
          if (busy !== null) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy !== null) e.preventDefault();
        }}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <Label htmlFor="redesign-note" srOnly>
              What would you change?
            </Label>
            <Input
              id="redesign-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. make the headline bigger, try it on the dark ground"
              disabled={busy !== null}
              onKeyDown={(e) => {
                // A single-line field submits on Enter by convention; Cmd/Ctrl+Enter
                // is honoured too so the habit from the topic box carries over.
                if (e.key === "Enter" && busy === null) {
                  e.preventDefault();
                  void redesign();
                }
              }}
            />
          </div>

          {scene && (
            <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
              This slide asked for: {scene}
            </div>
          )}

          {error && (
            <div style={{ fontSize: 13, color: "var(--danger)" }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={() => void interpretAndRun()} disabled={busy !== null}>
              {busy !== null ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              {busy !== null
                ? progressLabel(busy, elapsed)
                : note.trim()
                  ? "Do that"
                  : "Try a different design"}
            </Button>
          </div>

          {/* The route is invisible until it is wrong. Naming what happened is
              what lets a mis-read be seen at once, and the other routes sit
              beside it so correcting one is a click rather than a retype.
              Shown only after a run, so the resting dialog is still one
              button and one box (Hick). */}
          {lastIntent && busy === null && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                fontSize: 12.5,
                color: "var(--text-tertiary)",
              }}
            >
              <span>{intentDescription(lastIntent)}</span>
              <span>Not what you meant?</span>
              {lastIntent !== "design" && (
                <button type="button" className="link-button" onClick={() => void redesign()}>
                  Redesign the slide
                </button>
              )}
              {lastIntent !== "newPhoto" && imageGenEnabled && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void newPhoto("generate")}
                >
                  Make a different photo
                </button>
              )}
              {lastIntent !== "editPhoto" && photoEditEnabled && hasPhotoInSlot && note.trim() !== "" && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void newPhoto("edit")}
                >
                  Change this photo
                </button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The PNG bytes for any slide.
 *
 * A DESIGNED slide is already a PNG: it was rendered server-side and stored,
 * and that file is the export. Fetching it is not a shortcut -- re-drawing it
 * here would mean a second renderer, and the whole point of storing the render
 * is that preview and export are the same bytes. Only a template slide is
 * painted on a canvas.
 */
async function slideToBlob(
  slide: CarouselSlide,
  slideIdx: number,
  total: number,
  library: ImageLibraryAsset[],
  fontFamilies: { heading: string; body: string },
  brand?: BrandLabels,
  logo: HTMLImageElement | null = null,
  system: DesignSystem | null = null,
): Promise<Blob | null> {
  // The SAME predicate SlideCanvas paints by (SlideCanvas.tsx: designed AND a
  // stored render). Guarding on renderFilename alone meant a designed slide
  // switched to a fixed template kept exporting its old designed PNG forever:
  // applyTemplate deliberately KEEPS designHtml/renderFilename so undo needs no
  // model call, so the stored render outlives the slide that earned it. The
  // preview repainted as the template; the export did not.
  if (slide.templateId === DESIGNED_TEMPLATE_ID && slide.renderFilename) {
    try {
      const res = await fetch(renderFileUrl(slide.renderFilename));
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }
  return renderSlideToBlob(
    slide,
    slideIdx,
    total,
    library,
    fontFamilies,
    brand,
    logo,
    system,
  );
}

async function renderSlideToBlob(
  slide: CarouselSlide,
  slideIdx: number,
  total: number,
  library: ImageLibraryAsset[],
  fontFamilies: { heading: string; body: string },
  brand?: BrandLabels,
  logo: HTMLImageElement | null = null,
  system: DesignSystem | null = null,
): Promise<Blob | null> {
  if (!getTemplate(slide.templateId)) return null;

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

  const dims = slideDimensions(slide);
  const canvas = document.createElement("canvas");
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paintSlide(ctx, canvas.width, canvas.height, slide, slideIdx, total, brand, fontFamilies, bg, logo, system);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
}
