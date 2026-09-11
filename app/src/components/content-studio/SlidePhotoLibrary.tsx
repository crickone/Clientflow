"use client";

import { useRef } from "react";
import { Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";

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
