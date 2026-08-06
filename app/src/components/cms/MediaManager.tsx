"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { updateAltAction, deleteMediaAction } from "@/app/cms/[siteSlug]/media/actions";

export type MediaItem = {
  id: number;
  url: string;
  originalName: string;
  alt: string;
  mimeType: string;
};

export function MediaManager({
  siteSlug,
  items,
}: {
  siteSlug: string;
  items: MediaItem[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("file", f));
    const res = await fetch(`/api/cms/${siteSlug}/media`, { method: "POST", body: fd });
    setUploading(false);
    if (res.ok) {
      toast.success("Uploaded");
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Upload failed");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div>
      <Card style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 14 }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => onUpload(e.target.files)}
        />
        <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload size={15} />
          {uploading ? "Uploading…" : "Upload images"}
        </Button>
        <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
          JPEG, PNG, WebP, SVG, GIF
        </span>
      </Card>

      {items.length === 0 ? (
        <p style={{ color: "var(--text-tertiary)" }}>No media yet.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 16,
          }}
        >
          {items.map((m) => (
            <Card key={m.id} style={{ display: "grid", gap: 10 }}>
              <div
                style={{
                  aspectRatio: "4/3",
                  background: "var(--surface-2)",
                  borderRadius: 8,
                  overflow: "hidden",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.url}
                  alt={m.alt}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                ID {m.id} · {m.originalName}
              </div>
              <form
                action={async (fd) => {
                  await updateAltAction(siteSlug, m.id, String(fd.get("alt") ?? ""));
                  toast.success("Alt saved");
                  router.refresh();
                }}
                style={{ display: "flex", gap: 6 }}
              >
                <Input name="alt" defaultValue={m.alt} placeholder="Alt text" />
                <Button type="submit" variant="ghost" size="sm">
                  Save
                </Button>
              </form>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  startTransition(async () => {
                    if (await confirm({ title: "Delete this image?", destructive: true })) {
                      await deleteMediaAction(siteSlug, m.id);
                      router.refresh();
                    }
                  })
                }
              >
                <Trash2 size={14} /> Delete
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
