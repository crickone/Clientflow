"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Loader2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { saveProgramAction } from "@/app/workout/actions";
import type { ProgramInput } from "@/lib/workoutModel";

export function UploadProgramForm({ initial }: { initial: ProgramInput }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initial.title === "New Program" ? "" : initial.title);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [filename, setFilename] = useState<string | null>(initial.uploadFilename);
  const [originalName, setOriginalName] = useState<string | null>(initial.uploadOriginalName);
  const [uploading, setUploading] = useState(false);
  const [saving, start] = useTransition();

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/workout/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Upload failed.");
      setFilename(data.filename);
      setOriginalName(data.originalName);
      if (!title.trim()) setTitle(data.originalName.replace(/\.[^.]+$/, ""));
      toast.success("Document uploaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const save = () => {
    if (!title.trim()) return toast.error("Enter a program title.");
    if (!filename) return toast.error("Upload a document first.");
    start(async () => {
      const res = await saveProgramAction({
        ...initial,
        title,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        uploadFilename: filename,
        uploadOriginalName: originalName,
      });
      if (res.ok) {
        toast.success("Program saved.");
        router.push("/workout");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" size="icon" onClick={() => router.push("/workout")} aria-label="Back">
          <ArrowLeft size={16} />
        </Button>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 24, textTransform: "uppercase" }}>
          {initial.id ? "Edit" : "Create a"} Program
        </h1>
      </div>

      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <Label htmlFor="up-title">Program title *</Label>
            <Input id="up-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter program title" autoFocus />
          </div>
          <div>
            <Label htmlFor="up-tags">Tags</Label>
            <Input id="up-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="Add tags (comma separated)" />
          </div>
        </div>

        <div>
          <Label>Upload document *</Label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xls,.xlsx"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          {filename ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
              <FileText size={22} style={{ color: "var(--accent-ink)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {originalName ?? filename}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Uploaded</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                Replace
              </Button>
              <button
                onClick={() => {
                  setFilename(null);
                  setOriginalName(null);
                }}
                aria-label="Remove file"
                style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{
                width: "100%",
                border: "1.5px dashed var(--hairline-strong)",
                borderRadius: "var(--radius)",
                background: "transparent",
                padding: "44px 20px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                color: "var(--text-secondary)",
              }}
            >
              {uploading ? <Loader2 size={26} className="spin" /> : <UploadCloud size={26} style={{ color: "var(--accent-ink)" }} />}
              <div style={{ fontSize: 13.5, color: "var(--accent-ink)" }}>{uploading ? "Uploading…" : "Drop file here or click to upload."}</div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Supported formats: pdf, xlsx, xls</div>
            </button>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={() => router.push("/workout")} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || uploading}>
            {saving ? "Saving…" : "Save & Close"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  background: "var(--surface-1)",
  padding: 24,
};
