"use client";

import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { Loader2, Plus } from "lucide-react";

import type { CarouselSlide, ImageLibraryAsset } from "@/lib/db/schema";
import { getTemplate } from "@/lib/image/templates";
import { padNumber, type BrandLabels } from "@/lib/image/paintSlide";
import { SlideCanvas } from "./SlideCanvas";

/**
 * The strip of slides under the preview.
 *
 * A carousel used to be shown as a two-column grid of thumbnails with no
 * preview at all — so the one thing a carousel IS, an ordered run of slides
 * you swipe through, was the one thing you couldn't see. A filmstrip shows the
 * order, lets you drag to change it, and keeps the big preview on the slide
 * you're editing.
 *
 * Drag and click share the same target: the pointer sensor only starts a drag
 * past 6px of movement, so a plain click still selects.
 */

const THUMB_WIDTH = 104;

export function SlideFilmstrip({
  slides,
  activeIdx,
  onSelect,
  onReorder,
  onAdd,
  fontsReady,
  library,
  defaultHeadingFontId,
  defaultBodyFontId,
  brand,
  logo = null,
}: {
  slides: CarouselSlide[];
  activeIdx: number;
  onSelect: (idx: number) => void;
  /** Called with the slide IDs in their new order. */
  onReorder: (orderedIds: number[]) => void;
  onAdd: () => void;
  fontsReady: boolean;
  library: ImageLibraryAsset[];
  defaultHeadingFontId?: string;
  defaultBodyFontId?: string;
  brand?: BrandLabels;
  logo?: HTMLImageElement | null;
}) {
  // Mouse and touch are split deliberately. One pointer sensor would need
  // touch-action: none on every slide, and since the strip scrolls sideways
  // that would leave a phone unable to reach slide 8 — the touch that would
  // scroll starts on a slide. Touch therefore presses and holds to drag, so a
  // swipe still scrolls.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = slides.findIndex((s) => s.id === active.id);
    const newIndex = slides.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(slides, oldIndex, newIndex).map((s) => s.id));
  }

  return (
    <div style={{ display: "grid", gap: 7 }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={slides.map((s) => s.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              padding: "2px 2px 8px",
              alignItems: "flex-start",
            }}
          >
            {slides.map((slide, idx) => (
              <FilmstripSlide
                key={slide.id}
                slide={slide}
                slideIdx={idx}
                total={slides.length}
                isActive={idx === activeIdx}
                onSelect={() => onSelect(idx)}
                fontsReady={fontsReady}
                library={library}
                defaultHeadingFontId={defaultHeadingFontId}
                defaultBodyFontId={defaultBodyFontId}
                brand={brand}
                logo={logo}
              />
            ))}
            <button
              type="button"
              onClick={onAdd}
              aria-label="Add a slide"
              style={{
                flex: "0 0 auto",
                width: THUMB_WIDTH,
                minHeight: 96,
                alignSelf: "stretch",
                borderRadius: "var(--radius)",
                border: "1px dashed var(--hairline-strong)",
                background: "transparent",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
              }}
            >
              <Plus size={16} strokeWidth={1.6} />
              Add slide
            </button>
          </div>
        </SortableContext>
      </DndContext>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-tertiary)",
          letterSpacing: "0.02em",
          textAlign: "center",
        }}
      >
        Drag a slide to reorder the series
      </div>
    </div>
  );
}

function FilmstripSlide({
  slide,
  slideIdx,
  total,
  isActive,
  onSelect,
  fontsReady,
  library,
  defaultHeadingFontId,
  defaultBodyFontId,
  brand,
  logo,
}: {
  slide: CarouselSlide;
  slideIdx: number;
  total: number;
  isActive: boolean;
  onSelect: () => void;
  fontsReady: boolean;
  library: ImageLibraryAsset[];
  defaultHeadingFontId?: string;
  defaultBodyFontId?: string;
  brand?: BrandLabels;
  logo?: HTMLImageElement | null;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slide.id });
  const template = getTemplate(slide.templateId);
  const generating = slide.imageStatus === "generating";

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      {...attributes}
      {...listeners}
      aria-label={
        generating
          ? `Slide ${slideIdx + 1} — generating image`
          : `Edit slide ${slideIdx + 1}`
      }
      aria-pressed={isActive}
      aria-busy={generating}
      title={template?.name ?? undefined}
      style={{
        // Built by hand rather than pulled from @dnd-kit/utilities, which is
        // only a transitive dep here — same as the pipeline stage list does.
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        transition,
        // Lift the dragged slide over its neighbours instead of sliding under.
        zIndex: isDragging ? 2 : 1,
        opacity: isDragging ? 0.85 : 1,
        flex: "0 0 auto",
        width: THUMB_WIDTH,
        padding: 5,
        borderRadius: "var(--radius)",
        background: isActive ? "var(--surface-2)" : "var(--bg)",
        border: isActive
          ? "2px solid var(--text-primary)"
          : "1px solid var(--hairline)",
        cursor: isDragging ? "grabbing" : "pointer",
        display: "grid",
        gap: 4,
        fontFamily: "inherit",
        textAlign: "left",
        // Not "none": the strip has to stay swipe-scrollable on touch. The
        // press-and-hold sensor is what separates a drag from a scroll.
        touchAction: "manipulation",
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          fontWeight: 600,
          color: isActive ? "var(--text-primary)" : "var(--text-tertiary)",
          letterSpacing: "0.08em",
          padding: "0 1px",
        }}
      >
        {padNumber(slideIdx + 1, 2)}
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
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--radius)",
              background: "rgba(10,10,10,0.6)",
              color: "#fff",
            }}
          >
            <Loader2 size={15} className="spin" />
          </div>
        )}
      </div>
    </button>
  );
}
