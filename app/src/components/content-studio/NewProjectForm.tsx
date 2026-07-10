"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Upload, Library } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";

interface LibraryClip {
  filename: string;
  label: string;
  sizeBytes: number;
  durationSeconds: number | null;
}

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "1:1">("9:16");
  const [targetSeconds, setTargetSeconds] = useState(45);
  const [toneNotes, setToneNotes] = useState("");
  const [main, setMain] = useState<File | null>(null);
  const [broll, setBroll] = useState<File[]>([]);
  const [library, setLibrary] = useState<LibraryClip[]>([]);
  const [pickedLibrary, setPickedLibrary] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/content-studio/library/broll")
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) setLibrary(data.clips ?? []);
      })
      .catch(() => {});
  }, []);

  const totalSize =
    (main?.size ?? 0) + broll.reduce((sum, f) => sum + f.size, 0);

  function toggleLibrary(filename: string) {
    setPickedLibrary((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!main) {
      setError("Main video is required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("name", name);
      fd.set("aspectRatio", aspectRatio);
      fd.set("targetSeconds", String(targetSeconds));
      fd.set("toneNotes", toneNotes);
      fd.set("main", main);
      for (const f of broll) fd.append("broll", f);
      for (const filename of pickedLibrary) fd.append("libraryBroll", filename);
      const res = await fetch("/api/content-studio/projects", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Upload failed.");
      }
      router.push(`/content-studio/videos/${json.projectId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: "grid",
        gap: 24,
        maxWidth: 720,
      }}
    >
      <div>
        <Label htmlFor="name">Project name</Label>
        <Input
          id="name"
          required
          value={name}
          placeholder="e.g. Member testimonial — Maria"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <Label>Aspect ratio</Label>
          <div style={{ display: "flex", gap: 8 }}>
            {(["9:16", "1:1"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setAspectRatio(r)}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: "var(--radius)",
                  border:
                    aspectRatio === r
                      ? "1px solid var(--text-primary)"
                      : "1px solid var(--hairline)",
                  background:
                    aspectRatio === r ? "var(--surface-2)" : "var(--bg)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: 14,
                  fontFamily: "inherit",
                }}
              >
                {r === "9:16" ? "9:16  ·  Reel" : "1:1  ·  Square"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="target">Target length (seconds)</Label>
          <Input
            id="target"
            type="number"
            min={10}
            max={120}
            value={targetSeconds}
            onChange={(e) => setTargetSeconds(Number(e.target.value))}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="tone">Tone / hook notes (optional)</Label>
        <Textarea
          id="tone"
          value={toneNotes}
          placeholder="e.g. testimonial-style, calm and grounded, lead with the result not the therapy name"
          onChange={(e) => setToneNotes(e.target.value)}
        />
      </div>

      <FilePicker
        label="Main video"
        helper="Your talking-head shot. We transcribe this."
        accept="video/*"
        multiple={false}
        files={main ? [main] : []}
        onChange={(files) => setMain(files[0] ?? null)}
      />

      <FilePicker
        label="B-roll (optional)"
        helper="Cutaways we can drop in over your audio. Add as many as you like."
        accept="video/*"
        multiple
        files={broll}
        onChange={(files) => setBroll(files)}
      />

      {library.length > 0 && (
        <div>
          <Label>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Library size={13} />
              B-roll library
            </span>
          </Label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 8,
              padding: 14,
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              background: "var(--surface-1)",
            }}
          >
            {library.map((clip) => {
              const checked = pickedLibrary.has(clip.filename);
              return (
                <label
                  key={clip.filename}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: "var(--radius)",
                    border: checked
                      ? "1px solid var(--text-primary)"
                      : "1px solid var(--hairline)",
                    background: checked ? "var(--surface-2)" : "var(--bg)",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLibrary(clip.filename)}
                  />
                  <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                    <span
                      style={{
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {clip.label}
                    </span>
                    <span
                      style={{
                        color: "var(--text-tertiary)",
                        fontSize: 11,
                      }}
                    >
                      {clip.durationSeconds
                        ? `${clip.durationSeconds.toFixed(1)}s · `
                        : ""}
                      {(clip.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-tertiary)",
              marginTop: 6,
              letterSpacing: "0.04em",
            }}
          >
            Reusable clips from your shared media Library (and the built-in
            b-roll set) — copied into the new project so future edits stay
            isolated.
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          paddingTop: 8,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          Total upload: {(totalSize / (1024 * 1024)).toFixed(1)} MB
          {pickedLibrary.size > 0 && (
            <> · {pickedLibrary.size} library clip{pickedLibrary.size === 1 ? "" : "s"}</>
          )}
        </div>
        <Button type="submit" disabled={submitting || !main || !name}>
          <Upload size={15} />
          {submitting ? "Uploading…" : "Create + transcribe"}
        </Button>
      </div>
    </form>
  );
}

function FilePicker({
  label,
  helper,
  accept,
  multiple,
  files,
  onChange,
}: {
  label: string;
  helper: string;
  accept: string;
  multiple: boolean;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <label
        style={{
          display: "block",
          border: "1px dashed var(--hairline-strong)",
          borderRadius: "var(--radius)",
          padding: 18,
          background: "var(--surface-1)",
          cursor: "pointer",
        }}
      >
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          style={{ display: "none" }}
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            onChange(list);
          }}
        />
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {files.length === 0
            ? `Click to choose ${multiple ? "files" : "a file"}`
            : files.map((f) => (
                <div key={f.name} style={{ color: "var(--text-primary)" }}>
                  {f.name}{" "}
                  <span style={{ color: "var(--text-tertiary)" }}>
                    · {(f.size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                </div>
              ))}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            marginTop: 6,
            letterSpacing: "0.04em",
          }}
        >
          {helper}
        </div>
      </label>
    </div>
  );
}
