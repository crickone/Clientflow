"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";

import { DUR, EASE } from "@/lib/motion";

import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import type { ImageLibraryAsset } from "@/lib/db/schema";
import { libraryFileUrl } from "@/lib/image/paintSlide";

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
}: {
  assets: ImageLibraryAsset[];
  activeAssetId: number | null;
  /** null clears the slide's background photo. */
  onPick: (assetId: number | null) => void;
  onUpload: (files: File[]) => void;
  onDelete: (assetId: number) => void;
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
}) {
  const applying = applyingAssetId != null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
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
          <div style={{ display: "flex", gap: 8 }}>
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
          style={{
            display: "grid",
            // Exactly three across, at whatever size that makes them. A
            // photograph is recognisable small, and three columns is what
            // turns a panel this narrow into a contact sheet you can scan
            // rather than a one-file-wide list you scroll.
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 7,
            alignContent: "start",
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          {assets.map((asset) => {
            const active = asset.id === activeAssetId;
            const thisOne = asset.id === applyingAssetId;
            return (
              <div
                key={asset.id}
                style={{
                  position: "relative",
                  width: "100%",
                  paddingBottom: "100%",
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
                <Tooltip label="Remove from library">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (applying) return;
                      onDelete(asset.id);
                    }}
                    aria-label="Remove from library"
                    style={{
                      position: "absolute",
                      top: 3,
                      right: 3,
                      background: "rgba(0,0,0,0.6)",
                      color: "#fff",
                      borderRadius: "var(--radius)",
                      border: "none",
                      width: 20,
                      height: 20,
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
    <div style={{ display: "flex", alignItems: "stretch", minWidth: 0 }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? "Hide photos" : "Show photos"}
        title={open ? "Hide photos" : "Show photos"}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          width: 34,
          flexShrink: 0,
          padding: "14px 0",
          borderRadius: "var(--radius) 0 0 var(--radius)",
          border: "1px solid var(--hairline)",
          borderRight: "none",
          background: open ? "var(--surface-2)" : "var(--bg)",
          color: open ? "var(--text-primary)" : "var(--text-secondary)",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: "0.1em",
          transition: `background ${DUR.base}s, color ${DUR.base}s`,
        }}
      >
        <ImageIcon size={14} />
        <span style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}>
          PHOTOS
        </span>
        {photoCount > 0 && (
          <span style={{ fontWeight: 400, opacity: 0.65, letterSpacing: 0 }}>
            {photoCount}
          </span>
        )}
        <ChevronDown
          size={12}
          style={{
            transform: open ? "rotate(90deg)" : "rotate(-90deg)",
            transition: `transform ${DUR.base}s`,
          }}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          // Width is what animates, because width is what the panel is taking:
          // it grows into the room the column just made rather than appearing
          // on top of something. overflow:hidden keeps the contents from
          // spilling while that width is still opening.
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: PHOTO_PANEL_WIDTH, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: DUR.base, ease: EASE }}
            // position:relative + an absolutely-positioned child is what keeps
            // the panel from DRIVING the row's height: with no in-flow content
            // this box contributes no height of its own, so the row stays as
            // tall as the preview and align-items:stretch hands that height
            // back to the panel. Without it, a full library made the column
            // taller and pushed the slide actions (Add slide, Undo, Delete)
            // down out of the sticky column.
            style={{ overflow: "hidden", flexShrink: 0, position: "relative" }}
          >
            {/* Fixed width inside the animating box, so the tiles are laid out
                at their final size throughout rather than reflowing 3-across
                on every frame. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: PHOTO_PANEL_WIDTH,
              }}
            >
              <SlidePhotoLibrary {...libraryProps} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
