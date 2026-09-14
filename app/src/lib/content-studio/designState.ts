/**
 * The design-under-edit state machine.
 *
 * Lifted out of `components/content-studio/ImageDesigner.tsx`, which had grown
 * past 3,500 lines with every one of these decisions buried in a `useState`
 * setter inside a 1,000-line component body. Nothing here could be exercised
 * without mounting the whole editor, so none of it ever was.
 *
 * What lives here is the DECISIONS -- what happens to the design when a
 * response arrives, when the detached generation poll ticks, when an undo is
 * pressed, when a photo swap starts and finishes. The hooks, the fetches and
 * the JSX stay in the component; this module is a reducer plus a handful of
 * pure planners, so it is plain TypeScript that the repo's test runner picks
 * up as-is.
 *
 * IMPORTANT: this is a BEHAVIOUR-PRESERVING lift. Where the editor has a race
 * today it still has it (see `planManualBackground` -- a redesign is not
 * blocked by a photo swap in flight, and both end at the same `updateSlide`),
 * because a refactor that also changes behaviour has no safe rollback. The
 * races are pinned by tests named as defects, and get fixed separately.
 */

import {
  DEFAULT_SLOT,
  applySlotOrder,
  keepCaptionOnFirstSlide,
} from "@/lib/image/slots";

/**
 * The shape of a slide this machine needs. Deliberately structural rather than
 * `CarouselSlide`: the component instantiates it with the real drizzle row,
 * and a test can build one out of six fields instead of thirty.
 */
export interface DesignSlideLike {
  id: number;
  slotKey: string;
  caption: string;
  /** AI background generation state: null = never generated. */
  imageStatus: "generating" | "ready" | "failed" | null;
  imageError: string | null;
  imagePrompt: string | null;
  backgroundAssetId: number | null;
}

export interface DesignState<S extends DesignSlideLike> {
  slides: S[];
  activeIdx: number;
  activeSlot: string;
  /**
   * Undo for STRUCTURAL slide changes -- switching template, and redesigning.
   * A STACK per slide, not a single step: the way templates are actually used
   * is to click through several to see what they look like, and a one-deep
   * undo cannot get back to what you started from. Each press walks back one
   * change, so N clicks then N undos returns the original AI design.
   *
   * Deliberately not an undo of every keystroke: the autosave effect fires on
   * each character, so snapshotting there would make "undo" mean "delete one
   * letter". What gets lost by accident is the whole slide -- someone tries a
   * template and the AI design appears to be gone. It is not: designHtml and
   * renderFilename stay on the row through a switch, so restoring is just
   * putting templateId back, with no model call.
   */
  undoStacks: Record<number, S[]>;
  /**
   * The photo swap in flight on a designed slide: which slide, and which
   * photo. Held so the strip can show the work AND refuse a second pick --
   * two re-renders racing for one slide let the slower one win, which reads
   * as the second pick having done nothing.
   */
  rephotographing: { slideId: number; assetId: number } | null;
  /**
   * Whether a DETACHED generation is running on this design ("writing"), gave
   * up ("failed"), or neither (null). The run outlives the request that
   * started it, so this is how the editor learns there is work in flight.
   */
  generationStatus: string | null;
  generationError: string | null;
  generationStage: string | null;
}

export const UNDO_LIMIT = 25;

/**
 * Fields the debounced autosave OWNS. They are the body of its PATCH and the
 * string it diffs against to decide whether there is anything to save, so the
 * ORDER matters: it is what `JSON.stringify` writes, and a reordering would
 * make every slide look dirty once on the next edit.
 *
 * `backgroundAssetId`'s inclusion here is load-bearing for the
 * manual-pick-wins convergence -- see `planManualBackground`.
 */
export const AUTOSAVE_FIELDS = [
  "templateId",
  "aspectRatio",
  "headingText",
  "headingScale",
  "bodyText",
  "tagline",
  "headingFont",
  "bodyFont",
  "accentColor",
  "backgroundColor",
  "backgroundAssetId",
  "backgroundFit",
  "backgroundOffsetX",
  "backgroundOffsetY",
  "backgroundZoom",
] as const;

/**
 * Fields the generation POLL owns, and the only ones it merges unconditionally
 * onto a slide the operator may be typing into. Kept disjoint from
 * AUTOSAVE_FIELDS so a poll tick can never fight the save debounce -- with the
 * one deliberate exception of `backgroundAssetId`, which the poll writes ONLY
 * while the local slide is still 'generating' (see the reducer's "pollMerge").
 */
export const POLL_MERGE_FIELDS = [
  "imageStatus",
  "imageError",
  "imagePrompt",
] as const;

/** Build the autosave snapshot: the PATCH body AND the dirty-check string. */
export function autosaveSnapshot(
  slide: Record<(typeof AUTOSAVE_FIELDS)[number], unknown>,
): string {
  const body: Record<string, unknown> = {};
  for (const field of AUTOSAVE_FIELDS) body[field] = slide[field];
  return JSON.stringify(body);
}

/**
 * Where the editor opens. A design that holds a carousel opens on it rather
 * than on whatever happens to be first, because the carousel is the thing the
 * operator came back for; "default" is only the fallback.
 */
export function initialSlotFor(slides: { slotKey: string }[]): string {
  return (
    slides.find((s) => s.slotKey !== DEFAULT_SLOT)?.slotKey ??
    slides[0]?.slotKey ??
    DEFAULT_SLOT
  );
}

export function initialDesignState<S extends DesignSlideLike>(
  initialSlides: S[],
  generation: {
    status?: string | null;
    error?: string | null;
    stage?: string | null;
  } = {},
): DesignState<S> {
  return {
    slides: initialSlides,
    activeIdx: 0,
    activeSlot: initialSlotFor(initialSlides),
    undoStacks: {},
    rephotographing: null,
    generationStatus: generation.status ?? null,
    generationError: generation.error ?? null,
    generationStage: generation.stage ?? null,
  };
}

// ---------------------------------------------------------------------------
//  Selectors
// ---------------------------------------------------------------------------

/** Slides in the slot on screen. Every other slot stays exactly where it was. */
export function selectSlidesInSlot<S extends DesignSlideLike>(
  state: DesignState<S>,
): S[] {
  return state.slides.filter((s) => s.slotKey === state.activeSlot);
}

export function selectActiveSlide<S extends DesignSlideLike>(
  state: DesignState<S>,
): S | null {
  return selectSlidesInSlot(state)[state.activeIdx] ?? null;
}

export function selectUndoDepth<S extends DesignSlideLike>(
  state: DesignState<S>,
): number {
  const slide = selectActiveSlide(state);
  return slide ? (state.undoStacks[slide.id]?.length ?? 0) : 0;
}

/** True while the whole-design run is writing this design's slides. */
export function selectWriting<S extends DesignSlideLike>(
  state: DesignState<S>,
): boolean {
  return state.generationStatus === "writing";
}

// ---------------------------------------------------------------------------
//  Actions
// ---------------------------------------------------------------------------

export type DesignAction<S extends DesignSlideLike> =
  | { type: "setActiveIndex"; index: number }
  /** Re-clamp after the slot or the slide count changed under the cursor. */
  | { type: "clampActiveIndex" }
  | { type: "selectSlot"; slotKey: string }
  /** A detached whole-design run was just kicked off, into `slotKey`. */
  | { type: "generationStarted"; slotKey: string }
  | { type: "patchSlide"; slideId: number; patch: Partial<S> }
  /** A server response carrying one whole slide row back. */
  | { type: "slideUpdated"; slide: S }
  | { type: "slidesReplaced"; slides: S[]; activeIdx?: number }
  | { type: "slideAdded"; slide: S }
  | { type: "slideDeleted"; slideId: number }
  | { type: "reorderRolledBack"; previousOrder: number[]; previousIdx: number }
  | { type: "snapshotForUndo"; slide: S }
  | { type: "undoSlide"; slideId: number }
  | { type: "photoSwapStarted"; slideId: number; assetId: number }
  | { type: "photoSwapFinished"; slideId: number }
  | {
      type: "pollStatus";
      status: string | null;
      error: string | null;
      stage: string | null;
      serverSlides: S[];
    }
  | { type: "pollMerge"; serverSlides: S[] };

export function designReducer<S extends DesignSlideLike>(
  state: DesignState<S>,
  action: DesignAction<S>,
): DesignState<S> {
  switch (action.type) {
    case "setActiveIndex":
      return state.activeIdx === action.index
        ? state
        : { ...state, activeIdx: action.index };

    case "clampActiveIndex": {
      const count = selectSlidesInSlot(state).length;
      if (state.activeIdx < count) return state;
      const next = Math.max(0, count - 1);
      return next === state.activeIdx ? state : { ...state, activeIdx: next };
    }

    case "selectSlot":
      return { ...state, activeSlot: action.slotKey, activeIdx: 0 };

    case "generationStarted":
      // Turns the poll on immediately, so the banner shows without waiting for
      // the first tick to confirm what we already know.
      return {
        ...state,
        activeSlot: action.slotKey,
        activeIdx: 0,
        generationStatus: "writing",
        generationError: null,
        generationStage: null,
      };

    case "patchSlide":
      return {
        ...state,
        slides: state.slides.map((s) =>
          s.id === action.slideId ? { ...s, ...action.patch } : s,
        ),
      };

    case "slideUpdated":
      return {
        ...state,
        slides: state.slides.map((s) =>
          s.id === action.slide.id ? action.slide : s,
        ),
      };

    case "slidesReplaced":
      return {
        ...state,
        slides: action.slides,
        activeIdx:
          action.activeIdx === undefined ? state.activeIdx : action.activeIdx,
      };

    case "slideAdded": {
      // The new slide lands last in its slot, so the index to land on is the
      // count BEFORE the append.
      const idx = selectSlidesInSlot(state).length;
      return { ...state, slides: [...state.slides, action.slide], activeIdx: idx };
    }

    case "slideDeleted":
      return {
        ...state,
        slides: state.slides.filter((s) => s.id !== action.slideId),
      };

    case "reorderRolledBack": {
      // Revert by ORDER, not by snapshot: restoring a whole copy of `slides`
      // would also throw away anything typed while the request was in flight.
      // Read from the CURRENT slides for the same reason.
      const back = applySlotOrder(
        state.slides,
        state.activeSlot,
        action.previousOrder,
      );
      return {
        ...state,
        slides: back ? keepCaptionOnFirstSlide(back, state.activeSlot) : state.slides,
        activeIdx: action.previousIdx,
      };
    }

    case "snapshotForUndo": {
      const stack = [...(state.undoStacks[action.slide.id] ?? []), action.slide];
      return {
        ...state,
        undoStacks: {
          ...state.undoStacks,
          // Oldest first, so the cap drops the most distant history rather
          // than the step about to be undone.
          [action.slide.id]: stack.slice(-UNDO_LIMIT),
        },
      };
    }

    case "undoSlide": {
      const stack = state.undoStacks[action.slideId] ?? [];
      const previous = stack[stack.length - 1];
      if (!previous) return state;
      // The slide restore and the stack pop happen in ONE transition. As two
      // separate setState calls one of them had to run inside the other's
      // updater, which React may run twice in development -- and that would
      // pop two steps for one press.
      const rest = stack.slice(0, -1);
      const undoStacks = { ...state.undoStacks };
      if (rest.length) undoStacks[action.slideId] = rest;
      else delete undoStacks[action.slideId];
      return {
        ...state,
        slides: state.slides.map((s) => (s.id === action.slideId ? previous : s)),
        undoStacks,
      };
    }

    case "photoSwapStarted":
      return {
        ...state,
        rephotographing: { slideId: action.slideId, assetId: action.assetId },
      };

    case "photoSwapFinished":
      // Only the swap that is actually in flight may clear the flag: a late
      // finisher for a slide the operator has since moved off must not unlock
      // a swap that started after it.
      return state.rephotographing?.slideId === action.slideId
        ? { ...state, rephotographing: null }
        : state;

    case "pollStatus": {
      const wasWriting = selectWriting(state);
      const next: DesignState<S> = {
        ...state,
        generationStatus: action.status,
        generationError: action.error,
        generationStage: action.stage,
      };
      // A finished generation REPLACED the slot: the rows are new, with new
      // ids, so the patch-by-id path ("pollMerge") would match none of them
      // and the editor would sit on the seed slide forever. Take the server's
      // set whole, ONCE, at the moment the run stops -- the edge is read off
      // the status this tick is replacing, so a second tick cannot take it
      // again.
      if (wasWriting && action.status !== "writing") {
        next.slides = action.serverSlides;
        next.activeIdx = 0;
      }
      return next;
    }

    case "pollMerge": {
      const byId = new Map(action.serverSlides.map((s) => [s.id, s]));
      return {
        ...state,
        slides: state.slides.map((s) => {
          const sv = byId.get(s.id);
          if (!sv) return s;
          // Generation-owned fields only. Everything else on the row belongs
          // to the autosave snapshot, and merging it here would overwrite
          // what the operator is typing with what the server last stored.
          const patch: Record<string, unknown> = {
            imageStatus: sv.imageStatus,
            imageError: sv.imageError,
            imagePrompt: sv.imagePrompt,
          };
          // backgroundAssetId only while the LOCAL slide is still generating:
          // a manual pick mid-flight has already cleared imageStatus, and it
          // wins.
          if (s.imageStatus === "generating" && sv.backgroundAssetId != null) {
            patch.backgroundAssetId = sv.backgroundAssetId;
          }
          return { ...s, ...patch };
        }),
      };
    }

    default: {
      const never: never = action;
      return never;
    }
  }
}

// ---------------------------------------------------------------------------
//  Planners -- decisions the component has to make BEFORE it fetches
// ---------------------------------------------------------------------------

/**
 * What a manual background pick does to the active slide.
 *
 * A MANUAL background change resolves any pending AI generation for that
 * slide: clearing image_status locally kills the poll's merge guard and the
 * chip, and persisting that resolution immediately matters because the
 * detached queue checks it before writing -- so the user's pick wins over a
 * late AI result.
 *
 * A DESIGNED slide has no background to set: its photograph is embedded in the
 * markup and baked into a stored PNG, so the picture only changes when the
 * slide is re-rendered. Same strip, same click, different mechanism -- which
 * is why this branches here rather than offering the operator a second,
 * differently-worded photo control.
 */
export type ManualBackgroundPlan =
  | { kind: "none" }
  | { kind: "rephotograph"; slideId: number; assetId: number }
  | {
      kind: "patch";
      slideId: number;
      patch: {
        backgroundAssetId: number | null;
        imageStatus?: null;
        imageError?: null;
      };
      /** Whether the cleared generation has to be PATCHed straight away. */
      persistClearedGeneration: boolean;
    };

export function planManualBackground<S extends DesignSlideLike>(
  state: DesignState<S>,
  backgroundAssetId: number | null,
  opts: { designed: boolean },
): ManualBackgroundPlan {
  const slide = selectActiveSlide(state);
  if (!slide) return { kind: "none" };

  if (opts.designed) {
    // A designed slide's photograph is embedded in its markup, so there is
    // nothing to clear -- only something to swap.
    if (backgroundAssetId == null) return { kind: "none" };
    // One at a time. The guard is here rather than on the strip alone so a
    // keyboard or a double click cannot get past it either.
    //
    // KNOWN GAP, preserved: this only knows about another PHOTO SWAP. A
    // redesign of the same slide is tracked by a `busy` flag inside the
    // redesign button and is invisible here, so the two can overlap and the
    // slower response wins. See designState.test.ts.
    if (state.rephotographing) return { kind: "none" };
    return { kind: "rephotograph", slideId: slide.id, assetId: backgroundAssetId };
  }

  const wasGenerating = slide.imageStatus === "generating";
  return {
    kind: "patch",
    slideId: slide.id,
    patch: wasGenerating
      ? { backgroundAssetId, imageStatus: null, imageError: null }
      : { backgroundAssetId },
    persistClearedGeneration: wasGenerating,
  };
}

/**
 * A drag inside the active slot. Returns null for a stale drag -- the list is
 * then left alone, and no request goes out.
 *
 * slide_order is per-slot, so only this slot's ids go to the server; the flat
 * `slides` array keeps every other slot exactly where it was.
 */
export interface ReorderPlan<S extends DesignSlideLike> {
  slides: S[];
  activeIdx: number;
  /** For the rollback, if the PATCH fails and nothing newer has superseded it. */
  previousOrder: number[];
  previousIdx: number;
}

export function planReorder<S extends DesignSlideLike>(
  state: DesignState<S>,
  orderedIds: number[],
): ReorderPlan<S> | null {
  const reordered = applySlotOrder(state.slides, state.activeSlot, orderedIds);
  if (!reordered) return null; // stale drag -- leave the list alone

  // The caption is stored on the slot's first slide, so it has to travel with
  // that position or it's stranded where nothing can read it. The server does
  // the same inside the reorder; this keeps the panel from blanking in the
  // meantime.
  const slides = keepCaptionOnFirstSlide(reordered, state.activeSlot);

  const previousOrder = selectSlidesInSlot(state).map((s) => s.id);
  const previousIdx = state.activeIdx;
  const activeId = selectActiveSlide(state)?.id ?? null;
  let activeIdx = state.activeIdx;
  // Follow the slide you were editing rather than the position it vacated.
  if (activeId != null) {
    const movedTo = orderedIds.indexOf(activeId);
    if (movedTo !== -1) activeIdx = movedTo;
  }

  return { slides, activeIdx, previousOrder, previousIdx };
}

/**
 * Assets the server's slides reference that the local library has never seen.
 * Newly-generated backgrounds arrive this way: the poll learns the id, and the
 * asset itself has to be fetched before anything can be drawn with it.
 */
export function missingAssetIds(
  serverSlides: { backgroundAssetId: number | null }[],
  known: Set<number>,
): number[] {
  return Array.from(
    new Set(
      serverSlides
        .map((s) => s.backgroundAssetId)
        .filter((id): id is number => id != null && !known.has(id)),
    ),
  );
}
