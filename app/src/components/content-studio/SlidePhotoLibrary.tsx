"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Trash2,
  Upload,
} from "lucide-react";


import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import type { ImageLibraryAsset } from "@/lib/db/schema";
import { libraryFileUrl } from "@/lib/image/paintSlide";

/**
 * What to call a slot in front of an operator. Position, not slot number: the
 * markup's "{{PHOTO:2}}" is an implementation detail, and what the operator
 * sees is a first and a second picture. Numbered past the cap
 * (MAX_PHOTO_SLOTS is 2) only so a slide that somehow carries more still
 * labels every button distinctly.
 */
function ordinalName(index: number): string {
  return index === 0 ? "First" : index === 1 ? "Second" : `Photo ${index + 1}`;
}

/**
 * The photo library, as a strip under the preview.
 *
 * It used to sit at the bottom of the "Layout & photo" section, so choosing a
 * background meant scrolling right away from the preview it was for — you
 * picked a photo, then scrolled back up to see what it did. Here the picture
 * and the result are on screen together.
 */
export function SlidePhotoLibrary({
  assets,
  activeAssetId,
  onPick,
  onUpload,
  onDelete,
  uploading,
  uploadProgress = null,
  applyingAssetId = null,
  canClear = true,
  slots = [],
  activeSlot = 1,
  onSlotChange,
  tall = false,
  onToggleTall,
}: {
  assets: ImageLibraryAsset[];
  activeAssetId: number | null;
  /** null clears the slide's background photo. */
  onPick: (assetId: number | null) => void;
  onUpload: (files: File[]) => void;
  onDelete: (assetId: number) => void;
  /** Whether the phone's panel is currently grown. Only for the control's label. */
  tall?: boolean;
  /** Grows the strip into a browsable grid. Its control is hidden by CSS
   *  where there is no strip to grow. */
  onToggleTall?: () => void;
  uploading: boolean;
  /**
   * How far through a multi-file upload we are, or null when none is running.
   * Files go up ONE PER REQUEST, so this is a real count rather than a
   * spinner: a batch of twenty used to be a single request that reported
   * nothing until it finished (or timed out), which is indistinguishable
   * from stuck.
   */
  uploadProgress?: { done: number; total: number } | null;
  /**
   * The photo currently being put on the slide, when that takes real work --
   * an AI-designed slide is RE-RENDERED server-side, which is a second or two
   * of nothing if the strip says nothing. It also locks the strip, because two
   * picks in flight race for the same slide and the slower one wins, which an
   * operator reads as the second pick doing nothing at all.
   */
  applyingAssetId?: number | null;
  /** False where the slide's photograph cannot be removed, only swapped. */
  canClear?: boolean;
  /**
   * Slot numbers this slide has, ascending. One entry (or none) hides the
   * chooser entirely: a slide with one photograph has no choice to make, and
   * a control that offers none is just a row in the way.
   */
  slots?: number[];
  /** Which slot a pick will replace. */
  activeSlot?: number;
  onSlotChange?: (slot: number) => void;
}) {
  const applying = applyingAssetId != null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      // The tab is this sheet's HEADER, not a separate card: the two share an
      // outline, so whichever edge they meet along carries no border and no
      // corner radius on either side. See .cs-photo-sheet in globals.css --
      // the overrides need !important because these are inline styles.
      className="cs-photo-sheet"
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 12,
        background: "var(--surface-1)",
        display: "grid",
        // Header, then the sheet taking whatever is left. The panel fills the
        // height the preview sets and scrolls inside itself -- it must never
        // be what makes the row taller, because everything below (Add slide,
        // Undo, Delete slide) gets pushed down the sticky column with it.
        gridTemplateRows: "auto 1fr",
        height: "100%",
        minHeight: 0,
        gap: 10,
      }}
    >
      {/* Header and progress are ONE grid cell, so the sheet below always
          gets the 1fr row whether or not an upload is running. */}
      <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            // 252px is narrow: let the actions drop to their own line rather
            // than push the Upload button out past the panel's edge.
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
            }}
          >
            Photos
            <span style={{ fontWeight: 400 }}>
              {assets.length > 0 ? ` · ${assets.length}` : ""}
            </span>
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Phone only. The strip is deliberately one row -- every row the
                panel takes is a row the slide loses -- so this is how you buy
                more of it when you are actually picking rather than glancing. */}
            {onToggleTall && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="cs-photo-expand"
                onClick={onToggleTall}
                aria-expanded={tall}
                title={tall ? "Back to one row" : "Show more photos at once"}
              >
                {tall ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                {tall ? "Collapse" : "Expand"}
              </Button>
            )}
            {applying && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11.5,
                  fontWeight: 400,
                  color: "var(--text-secondary)",
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                <Loader2 size={13} className="spin" />
                Putting it on the slide…
              </span>
            )}
            {canClear && activeAssetId != null && !applying && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onPick(null)}
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
              {uploading ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Upload size={14} />
              )}
              Upload
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (list.length > 0) onUpload(list);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {/* Only a slide with two slots gets a target to choose. It sits on its
            own line rather than in the row above: the header already wraps at
            252px, and a chooser that jumps between lines as the Clear button
            comes and goes is harder to hit than one that stays put. */}
        {slots.length > 1 && (
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>Replacing</span>
            {slots.map((s, i) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={s === activeSlot ? "secondary" : "ghost"}
                onClick={() => onSlotChange?.(s)}
                title={`Replace the ${ordinalName(i).toLowerCase()} photograph`}
              >
                {ordinalName(i)}
              </Button>
            ))}
          </div>
        )}
        {uploadProgress && uploadProgress.total > 1 && (
          <div style={{ display: "grid", gap: 5 }}>
            <div
              aria-live="polite"
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11.5,
                color: "var(--text-secondary)",
              }}
            >
              <span>Uploading photos</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {uploadProgress.done} of {uploadProgress.total}
              </span>
            </div>
            <div
              aria-hidden="true"
              style={{
                height: 3,
                borderRadius: 2,
                background: "var(--surface-3)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.round((uploadProgress.done / uploadProgress.total) * 100)}%`,
                  background: "var(--text-primary)",
                  transition: "width 160ms linear",
                }}
              />
            </div>
          </div>
        )}
      </div>
      {assets.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--hairline)",
            borderRadius: "var(--radius)",
            padding: 20,
            alignSelf: "start",
            textAlign: "center",
            color: "var(--text-tertiary)",
            fontSize: 13,
          }}
        >
          <ImageIcon
            size={22}
            strokeWidth={1.5}
            style={{ marginBottom: 6, opacity: 0.5 }}
          />
          <div>Upload photos to use as backgrounds.</div>
        </div>
      ) : (
        <div
          // A single row scrolled sideways on a phone, a three-across contact
          // sheet beside the preview. CSS, not a prop: see .cs-photo-tab.
          className="cs-photo-tiles"
        >
          {assets.map((asset) => {
            const active = asset.id === activeAssetId;
            const thisOne = asset.id === applyingAssetId;
            return (
              <div
                key={asset.id}
                className="photo-tile"
                style={{
                  position: "relative",
                  width: "100%",
                  // Squared by CSS: the strip's columns are a fixed width so
                  // its tiles take a fixed height, while the contact sheet's
                  // are fluid and use the padding trick. Both live in
                  // .cs-photo-tiles.
                  borderRadius: "var(--radius)",
                  overflow: "hidden",
                  border:
                    active || thisOne
                      ? "2px solid var(--text-primary)"
                      : "1px solid var(--hairline)",
                  cursor: applying ? "default" : "pointer",
                  background: "var(--surface-2)",
                  opacity: applying && !thisOne ? 0.4 : 1,
                  transition: "opacity 120ms ease",
                }}
                onClick={() => {
                  if (applying) return;
                  onPick(asset.id);
                }}
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
                {thisOne && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(0,0,0,0.45)",
                      color: "#fff",
                    }}
                  >
                    <Loader2 size={18} className="spin" />
                  </div>
                )}
                {/* Hidden until the tile is hovered or holds focus (rules in
                    globals.css -- inline style cannot express :hover). The
                    pick target is the whole tile; the destructive one is a
                    small corner that only exists once you are already on
                    the tile, so a stray click on a photograph cannot land on
                    Remove (Fitts's law: make the dangerous target the small,
                    deliberate one). */}
                <Tooltip label="Remove from library">
                  <button
                    type="button"
                    className="photo-tile-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (applying) return;
                      onDelete(asset.id);
                    }}
                    aria-label="Remove from library"
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
  );
}

const OPEN_KEY = "cs.photoLibraryOpen";

/**
 * The panel's width, and the space the preview column has to gain for it.
 *
 * Exported because the two have to agree: the panel takes this in the flow
 * beside the preview, and ImageDesigner widens the column by exactly this
 * much (plus the gap) so the slide keeps its size instead of being squeezed
 * or covered. Sized to three tiles: 12px padding either side, two 7px gaps,
 * and three ~71px squares.
 */
/**
 * How much room the open panel takes beside the preview, and how much
 * ImageDesigner widens the preview column by so it comes out of the page's
 * margin rather than off the slide.
 *
 * The SAME number is in globals.css (.cs-photo-panel.is-open), which is what
 * actually sizes the panel — the sizing moved to CSS so the layout is right
 * before any JavaScript runs. This copy exists because the column's width is
 * arithmetic, not a class. Change one and change the other; both say so.
 */
export const PHOTO_PANEL_WIDTH = 252;


/**
 * The photo library as a panel that expands out BESIDE the preview.
 *
 * Three attempts got here. A strip under the slide cost a scroll every time
 * you wanted a different picture; a pill on the slide read as part of the
 * design; an absolutely-positioned popout opened over the preview, so
 * choosing a photograph hid the thing the photograph was for.
 *
 * This one is laid out in the flow: the panel takes real width next to the
 * tab, and ImageDesigner widens the preview column by exactly PHOTO_PANEL_WIDTH
 * while it is open, so the room comes out of the page's margin rather than off
 * the slide. Nothing overlaps, nothing is clipped, and the slide never changes
 * size as you browse.
 *
 * Open/closed persists per browser: an operator who works with it open should
 * not have to open it on every slide, and one who never uses it should not keep
 * dismissing it. Storage can throw (private windows, blocked site data), so
 * every access is guarded and the default simply wins.
 *
 * ON A PHONE THE SAME REASONING INVERTS THE LAYOUT. There is no margin to take
 * width out of -- the slide is already the whole screen -- so a panel beside
 * the preview can only come off the slide. It moves ABOVE it instead and takes
 * HEIGHT: a full-width tab, and under it a single row of tiles that scrolls
 * sideways. One row costs ~108px and leaves the slide the size it was.
 * "Expand" trades more of the screen for a browsable grid when picking is the
 * job rather than glancing.
 */
export function SlidePhotoLibraryPopout(
  props: Parameters<typeof SlidePhotoLibrary>[0] & {
    photoCount: number;
    /** Told to the parent so the column can make room. Fires on mount with
     *  the persisted value, which is why the parent starts closed too. */
    onOpenChange?: (open: boolean) => void;
  },
) {
  const [open, setOpen] = useState(false);
  /** The strip grown into a grid. Not persisted -- it is a this-moment
   *  choice ("let me actually look"), unlike open/closed. Only reachable on a
   *  phone, where the control that sets it is the only one rendered. */
  const [tall, setTall] = useState(false);
  const { photoCount, onOpenChange, ...libraryProps } = props;

  useEffect(() => {
    let restored = false;
    try {
      restored = window.localStorage.getItem(OPEN_KEY) === "1";
    } catch {
      // Closed is the safe default: it never takes the room unasked.
    }
    setOpen(restored);
    onOpenChange?.(restored);
    // Mount only: this restores a preference, it does not track the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    setOpen((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
      } catch {
        // The preference is a convenience, not state the editor depends on.
      }
      onOpenChange?.(next);
      return next;
    });
  }

  // Escape closes it, the way every other transient panel in the app behaves.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="cs-photo-popout">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? "Hide photos" : "Show photos"}
        title={open ? "Hide photos" : "Show photos"}
        // A tab down the LEFT EDGE beside the preview, and a bar across the
        // TOP above it on a phone. Both shapes are CSS (.cs-photo-tab), not a
        // branch on a measured viewport: the server cannot measure one, so a
        // JS branch renders the desktop rail into the HTML of every phone and
        // only corrects it once the editor has hydrated. On a component this
        // size that is seconds of a 34px rail in the corner that does not
        // answer a tap -- which is exactly what it looked like.
        className={`cs-photo-tab${open ? " is-open" : ""}`}
      >
        <ImageIcon size={14} />
        <span className="cs-photo-tab-label">PHOTOS</span>
        {photoCount > 0 && <span className="cs-photo-tab-count">{photoCount}</span>}
        <ChevronDown size={12} className="cs-photo-tab-chevron" />
      </button>

      {/* Sized and animated by CSS, for the same reason as the tab: the
          open/closed size differs by AXIS between the two layouts (width
          beside the preview, height above it) and a stylesheet knows which
          one applies before any JavaScript runs. `hidden` while closed keeps
          it out of the tab order and off a screen reader. */}
      <div
        className={`cs-photo-panel${open ? " is-open" : ""}${tall ? " is-tall" : ""}`}
        hidden={!open}
      >
        <div className="cs-photo-panel-inner">
          <SlidePhotoLibrary
            {...libraryProps}
            onToggleTall={() => setTall((t) => !t)}
            tall={tall}
          />
        </div>
      </div>
    </div>
  );
}
