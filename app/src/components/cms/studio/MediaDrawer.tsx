"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";

export interface MediaRow {
  id: number;
  url: string;
  originalName: string;
  alt: string | null;
}

/**
 * The shared media library, as a drawer INSIDE the inspector column — opened by
 * Replace, or by dragging a thumbnail onto any image on the page. It used to be
 * a third editor column, which resized the whole canvas every time it opened.
 */
export function MediaDrawer({
  open,
  onClose,
  onPick,
  onDragStart,
  onDragEnd,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (m: MediaRow) => void;
  onDragStart: (m: MediaRow) => void;
  onDragEnd: () => void;
}) {
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/cms/library").then((r) => r.json());
      setRows(
        (res.assets || []).map((a: { id: number; originalName: string; alt: string | null }) => ({
          id: a.id,
          originalName: a.originalName,
          alt: a.alt,
          url: `/library-media/${a.id}`,
        })),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load media library");
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    const abortController = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/cms/library", { signal: abortController.signal }).then((r) => r.json());
        if (!abortController.signal.aborted) {
          setRows(
            (res.assets || []).map((a: { id: number; originalName: string; alt: string | null }) => ({
              id: a.id,
              originalName: a.originalName,
              alt: a.alt,
              url: `/library-media/${a.id}`,
            })),
          );
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          toast.error(err instanceof Error ? err.message : "Failed to load media library");
        }
      }
    })();

    return () => abortController.abort();
  }, [open]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("file", f));
    setUploading(true);
    try {
      const res = await fetch("/api/cms/library", { method: "POST", body: fd }).then((r) => r.json());
      if (!res.ok) toast.error(res.error ?? "Upload failed");
      else {
        toast.success(`Uploaded ${res.assets.length} image(s)`);
        await refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        borderTop: "1px solid var(--hairline)",
        display: "grid",
        gridTemplateRows: "auto auto 1fr",
        minHeight: 0,
        background: "var(--surface-1)",
      }}
    >
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          Media library
        </span>
        <button
          onClick={onClose}
          aria-label="Close media library"
          style={{ border: "none", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", padding: 2 }}
        >
          <X size={14} />
        </button>
      </div>
      <div style={{ padding: "0 12px 10px" }}>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
        <Button onClick={() => fileInput.current?.click()} disabled={uploading} size="sm" variant="outline" style={{ width: "100%" }}>
          {uploading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
          {uploading ? "Uploading…" : "Upload images"}
        </Button>
        <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: "8px 2px 0", lineHeight: 1.5 }}>
          Click one to use it, or drag it onto any image on the page.
        </p>
      </div>
      <div style={{ overflowY: "auto", padding: "0 12px 12px" }}>
        {rows.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", fontSize: 12, padding: "8px 2px" }}>
            No images yet — upload some to get started.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {rows.map((m) => (
              <button
                key={m.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData("text/plain", m.url);
                  onDragStart(m);
                }}
                onDragEnd={onDragEnd}
                onClick={() => onPick(m)}
                title={m.alt || m.originalName}
                aria-label={m.alt || m.originalName}
                style={{
                  border: "1px solid var(--hairline)",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "var(--surface-2)",
                  cursor: "grab",
                  padding: 0,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.url}
                  alt={m.alt || m.originalName}
                  draggable={false}
                  style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block", pointerEvents: "none" }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
