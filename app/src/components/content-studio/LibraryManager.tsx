"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Film, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Tooltip } from "@/components/ui/Tooltip";

type Asset = {
  id: number;
  filename: string;
  originalName: string;
  mimeType: string;
  kind: string;
  label: string | null;
};

type Filter = "all" | "image" | "video" | "file";

function fileUrl(filename: string) {
  return `/api/content-studio/image-library/file/${encodeURIComponent(filename)}`;
}

function readImageDimensions(
  file: File,
): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve({ width: null, height: null });
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: null, height: null });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function LibraryManager({ initialAssets }: { initialAssets: Asset[] }) {
  const confirm = useConfirm();
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [filter, setFilter] = useState<Filter>("all");
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // "image" is everything that is not a video and not a document, rather
  // than kind === "image": rows uploaded before the kind column existed have
  // no kind at all, and they are pictures.
  const kindOf = (a: Asset): Exclude<Filter, "all"> =>
    a.kind === "video" ? "video" : a.kind === "file" ? "file" : "image";

  const counts = useMemo(
    () => ({
      all: assets.length,
      image: assets.filter((a) => kindOf(a) === "image").length,
      video: assets.filter((a) => kindOf(a) === "video").length,
      file: assets.filter((a) => kindOf(a) === "file").length,
    }),
    [assets],
  );
  const shown = useMemo(
    () => (filter === "all" ? assets : assets.filter((a) => kindOf(a) === filter)),
    [assets, filter],
  );

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    for (const f of Array.from(files)) {
      const { width, height } = await readImageDimensions(f);
      fd.append("file", f);
      fd.append("width", width == null ? "" : String(width));
      fd.append("height", height == null ? "" : String(height));
    }
    setUploading(true);
    try {
      const res = await fetch("/api/content-studio/image-library", {
        method: "POST",
        body: fd,
      }).then((r) => r.json());
      if (!res.ok) {
        toast.error(res.error ?? "Upload failed");
      } else {
        setAssets((prev) => [...res.assets, ...prev]);
        toast.success(`Uploaded ${res.assets.length} file(s)`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(id: number) {
    if (!(await confirm({ title: "Delete this file from your library?", body: "This can't be undone.", destructive: true }))) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/content-studio/image-library/${id}`, {
        method: "DELETE",
      }).then((r) => r.json());
      if (res.ok) setAssets((prev) => prev.filter((a) => a.id !== id));
      else toast.error(res.error ?? "Delete failed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  const tab = (key: Filter, label: string) => (
    <button
      onClick={() => setFilter(key)}
      style={{
        padding: "6px 12px",
        borderRadius: 8,
        border: "1px solid var(--hairline)",
        background: filter === key ? "var(--surface-2)" : "transparent",
        color: filter === key ? "var(--text-primary)" : "var(--text-secondary)",
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {label} {counts[key] > 0 && <span style={{ color: "var(--text-tertiary)" }}>({counts[key]})</span>}
    </button>
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        {tab("all", "All")}
        {tab("image", "Images")}
        {tab("video", "Videos")}
        {tab("file", "Files")}
        <div style={{ marginLeft: "auto" }}>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,application/pdf,text/plain,text/csv,text/markdown,application/json,.docx,.xlsx,.pptx"
            multiple
            hidden
            onChange={(e) => upload(e.target.files)}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--hairline)",
            borderRadius: 12,
            padding: "56px 24px",
            textAlign: "center",
            color: "var(--text-tertiary)",
          }}
        >
          <Upload size={28} strokeWidth={1.4} style={{ marginBottom: 12, opacity: 0.6 }} />
          <div style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
            Nothing here yet
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            Upload images (JPEG, PNG, WebP), video (MP4, MOV, WebM) or documents
            (PDF, CSV, TXT, MD, JSON, DOCX, XLSX, PPTX).
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 14,
          }}
        >
          {shown.map((a) => {
            const kind = kindOf(a);
            const isVideo = kind === "video";
            const isFile = kind === "file";
            return (
              <div
                key={a.id}
                style={{
                  border: "1px solid var(--hairline)",
                  borderRadius: 10,
                  overflow: "hidden",
                  background: "var(--surface-1)",
                }}
              >
                <div style={{ position: "relative", aspectRatio: "4 / 3", background: "var(--surface-2)" }}>
                  {isFile ? (
                    // A document has no thumbnail to show, so the tile is the
                    // link: its extension, large enough to recognise at a
                    // glance, and clicking it downloads the file.
                    <a
                      href={fileUrl(a.filename)}
                      download
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        width: "100%",
                        height: "100%",
                        color: "var(--text-secondary)",
                        textDecoration: "none",
                      }}
                    >
                      <FileText size={26} strokeWidth={1.5} />
                      <span
                        style={{
                          fontFamily: "var(--font-mono), ui-monospace, monospace",
                          fontSize: 12,
                          letterSpacing: ".06em",
                          textTransform: "uppercase",
                        }}
                      >
                        {(a.originalName.split(".").pop() || "file").slice(0, 5)}
                      </span>
                    </a>
                  ) : isVideo ? (
                    <video
                      src={fileUrl(a.filename)}
                      controls
                      preload="metadata"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fileUrl(a.filename)}
                      alt={a.label || a.originalName}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  )}
                  <span
                    style={{
                      position: "absolute",
                      top: 8,
                      left: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 7px",
                      borderRadius: 6,
                      background: "rgba(0,0,0,.6)",
                      color: "#fff",
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                    }}
                  >
                    {isFile ? <FileText size={11} /> : isVideo ? <Film size={11} /> : <ImageIcon size={11} />}
                    {isFile ? "File" : isVideo ? "Video" : "Image"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={a.originalName}
                  >
                    {a.label || a.originalName}
                  </div>
                  <Tooltip label="Delete">
                    <button
                      onClick={() => remove(a.id)}
                      disabled={busyId === a.id}
                      aria-label="Delete"
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "var(--text-tertiary)",
                        cursor: "pointer",
                        padding: 4,
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      {busyId === a.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
