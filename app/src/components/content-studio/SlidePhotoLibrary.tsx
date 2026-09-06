"use client";

import { useRef } from "react";
import { Image as ImageIcon, Trash2, Upload } from "lucide-react";

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
}: {
  assets: ImageLibraryAsset[];
  activeAssetId: number | null;
  /** null clears the slide's background photo. */
  onPick: (assetId: number | null) => void;
  onUpload: (files: File[]) => void;
  onDelete: (assetId: number) => void;
  uploading: boolean;
}) {
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
          {activeAssetId != null && (
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
                onClick={() => onPick(asset.id)}
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
