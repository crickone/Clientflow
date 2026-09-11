"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";

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
        gap: 10,
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
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
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
            <Button type="button" size="sm" variant="ghost" onClick={() => onPick(null)}>
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
            {uploading ? "Uploading…" : "Upload"}
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
      {assets.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--hairline)",
            borderRadius: "var(--radius)",
            padding: 20,
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
            gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))",
            gap: 7,
            // Sits under the preview now, so it stays a strip rather than
            // pushing the slide actions off the screen.
            maxHeight: 188,
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
 * The photo library as a panel that pops out of the preview's top-left corner.
 *
 * It was a strip under the slide, which cost the operator a scroll every time
 * they wanted a different picture and pushed the slide actions down the page.
 * As a popout it sits ON the preview, next to the thing it changes, and folds
 * away when it is not wanted -- which is most of the time, because a slide's
 * photograph is chosen once.
 *
 * Open/closed persists per browser: an operator who works with it open should
 * not have to open it on every slide, and one who never uses it should not keep
 * dismissing it. Storage can throw (private windows, blocked site data), so
 * every access is guarded and the default simply wins.
 */
export function SlidePhotoLibraryPopout(
  props: Parameters<typeof SlidePhotoLibrary>[0] & { photoCount: number },
) {
  const [open, setOpen] = useState(false);
  const { photoCount, ...libraryProps } = props;

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(OPEN_KEY) === "1");
    } catch {
      // Closed is the safe default: it never covers the slide unasked.
    }
  }, []);

  function toggle() {
    setOpen((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
      } catch {
        // The preference is a convenience, not state the editor depends on.
      }
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
    // OUTSIDE the slide, hung off its left edge: the pill used to sit on the
    // picture, which an operator read as part of the design rather than a
    // control of it. translateX(-100%) puts the tab in the preview card's own
    // padding, and the panel opens further left again, so nothing this owns
    // ever covers the slide.
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        transform: "translateX(-100%)",
        paddingRight: 8,
        zIndex: 6,
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? "Hide photos" : "Show photos"}
        title={open ? "Hide photos" : "Show photos"}
        style={{
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 5,
          padding: "10px 6px",
          borderRadius: "var(--radius) 0 0 var(--radius)",
          border: "1px solid var(--hairline)",
          borderRight: "none",
          background: "var(--surface-2)",
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
        }}
      >
        <ImageIcon size={13} />
        <span style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}>
          PHOTOS
        </span>
        {photoCount > 0 && (
          <span style={{ fontWeight: 400, opacity: 0.7 }}>{photoCount}</span>
        )}
        <ChevronDown
          size={12}
          style={{
            transform: open ? "rotate(90deg)" : "rotate(-90deg)",
            transition: `transform ${DUR.base}s`,
          }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: DUR.base, ease: EASE }}
            style={{
              position: "absolute",
              top: 0,
              right: "100%",
              marginRight: 8,
              // Narrow viewports have less room to the left of the preview, so
              // the panel gives way rather than running off the screen.
              width: "min(292px, 30vw)",
              boxShadow: "var(--shadow-2, 0 18px 40px rgba(0,0,0,0.45))",
              borderRadius: "var(--radius)",
              background: "var(--bg)",
            }}
          >
            <SlidePhotoLibrary {...libraryProps} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
