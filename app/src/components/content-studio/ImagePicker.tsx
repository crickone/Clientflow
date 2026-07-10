"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface LibAsset {
  id: number;
  url: string;
  originalName: string;
  alt: string | null;
}

export interface PickedImage {
  url: string;
  alt: string;
}

/**
 * Modal to choose an image for a blog: upload a new one or pick from the shared
 * CMS media library. Selecting resolves with a public `/library-media/…` URL
 * (works on the published site) plus alt text (auto-generated on upload).
 */
export function ImagePicker({
  title = "Choose an image",
  onSelect,
  onClose,
}: {
  title?: string;
  onSelect: (image: PickedImage) => void;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<LibAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/cms/library", { cache: "no-store" });
      const json = await res.json();
      if (res.ok && json.ok) setAssets(json.assets as LibAsset[]);
      else setError(json.error || "Couldn't load the media library.");
    } catch {
      setError("Couldn't load the media library.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("file", f));
      const res = await fetch("/api/cms/library", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Upload failed.");
      const created = json.assets?.[0] as LibAsset | undefined;
      if (created) {
        onSelect({ url: created.url, alt: created.alt ?? created.originalName ?? "" });
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(760px, 100%)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 18px",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 15 }}>{title}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => upload(e.target.files)}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              <Upload size={14} />
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="md-toolbar-btn"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div style={{ padding: 16, overflowY: "auto" }}>
          {error && (
            <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}
          {loading ? (
            <p style={{ color: "var(--text-tertiary)", fontSize: 14 }}>Loading…</p>
          ) : assets.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                padding: "40px 0",
                color: "var(--text-tertiary)",
              }}
            >
              <ImagePlus size={28} />
              <p style={{ fontSize: 14 }}>
                No images yet — upload one to get started.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 12,
              }}
            >
              {assets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() =>
                    onSelect({ url: a.url, alt: a.alt ?? a.originalName ?? "" })
                  }
                  title={a.originalName}
                  style={{
                    display: "block",
                    padding: 0,
                    border: "1px solid var(--hairline)",
                    borderRadius: "var(--radius)",
                    overflow: "hidden",
                    background: "var(--bg)",
                    cursor: "pointer",
                    aspectRatio: "4 / 3",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.url}
                    alt={a.alt ?? a.originalName}
                    loading="lazy"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
