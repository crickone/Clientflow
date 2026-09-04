"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Label, Textarea } from "@/components/ui/Input";

interface LibraryPhoto {
  id: number;
  filename: string;
  originalName: string;
  kind?: string | null;
}

const COST_PER_5S_CENTS = 35;
const MAX_PICKS = 6;

function fileUrl(filename: string) {
  return `/api/content-studio/image-library/file/${encodeURIComponent(filename)}`;
}

/**
 * Turn the client's own gym photos into short b-roll clips (image-to-video), so
 * cutaways are their real space with motion added rather than stock or invented
 * footage. Each clip is a real charge, so the picker always shows the running
 * cost before you commit.
 */
export function GenerateBrollDialog({
  projectId,
  onQueued,
}: {
  projectId: number;
  onQueued: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<LibraryPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [duration, setDuration] = useState<5 | 10>(5);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/content-studio/image-library")
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          setPhotos(
            (d.assets as LibraryPhoto[]).filter((a) => (a.kind ?? "image") !== "video"),
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const toggle = (id: number) =>
    setPicked((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_PICKS
          ? prev
          : [...prev, id],
    );

  const costCents = picked.length * COST_PER_5S_CENTS * (duration === 10 ? 2 : 1);

  async function submit() {
    if (picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const d = await fetch(`/api/content-studio/projects/${projectId}/broll/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          libraryAssetIds: picked,
          durationSec: duration,
          prompt: prompt.trim() || undefined,
        }),
      }).then((r) => r.json());
      if (!d.ok) {
        setError(d.error ?? "Couldn't start generation.");
        return;
      }
      setPicked([]);
      setPrompt("");
      setOpen(false);
      onQueued();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            background: "var(--surface-2)",
            border: "1px dashed var(--hairline-strong)",
            borderRadius: 4,
            padding: "4px 9px",
            fontSize: 10,
            color: "var(--text-secondary)",
            cursor: "pointer",
          }}
        >
          <Sparkles size={11} />
          Generate from photos
        </button>
      </DialogTrigger>
      <DialogContent style={{ maxWidth: 620 }}>
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>
              Generate b-roll from your photos
            </h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
              Each photo becomes a short clip with natural camera motion — your real
              space, not stock footage. Clips land in the b-roll tray when they&rsquo;re ready
              (about a minute each).
            </p>
          </div>

          <div>
            <Label>Photos {picked.length > 0 && `· ${picked.length} selected`}</Label>
            {loading ? (
              <div style={{ fontSize: 13, color: "var(--text-tertiary)", padding: 12 }}>
                Loading your photos…
              </div>
            ) : photos.length === 0 ? (
              <div
                style={{
                  border: "1px dashed var(--hairline)",
                  borderRadius: "var(--radius)",
                  padding: 20,
                  textAlign: "center",
                  fontSize: 13,
                  color: "var(--text-tertiary)",
                }}
              >
                No photos in your library yet — upload some in Content Studio first.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                  gap: 8,
                  maxHeight: 260,
                  overflowY: "auto",
                }}
              >
                {photos.map((p) => {
                  const on = picked.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggle(p.id)}
                      aria-pressed={on}
                      title={p.originalName}
                      style={{
                        position: "relative",
                        paddingBottom: "100%",
                        borderRadius: "var(--radius)",
                        overflow: "hidden",
                        border: on
                          ? "2px solid var(--text-primary)"
                          : "1px solid var(--hairline)",
                        background: "var(--surface-2)",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={fileUrl(p.filename)}
                        alt=""
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          opacity: on ? 1 : 0.75,
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 6 }}>
              Up to {MAX_PICKS} at a time.
            </div>
          </div>

          <div>
            <Label>Clip length</Label>
            <div style={{ display: "flex", gap: 8 }}>
              {([5, 10] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: "var(--radius)",
                    border:
                      duration === d
                        ? "1px solid var(--text-primary)"
                        : "1px solid var(--hairline)",
                    background: duration === d ? "var(--surface-2)" : "var(--bg)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                >
                  {d} seconds
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="broll-prompt" srOnly>Motion (optional)</Label>
            <Textarea
              id="broll-prompt"
              value={prompt}
              placeholder="Motion (optional)"
              onChange={(e) => setPrompt(e.target.value)}
              style={{ minHeight: 56 }}
            />
          </div>

          {error && (
            <div style={{ fontSize: 13, color: "var(--danger)" }}>{error}</div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {picked.length === 0
                ? "Pick a photo to start"
                : `${picked.length} clip${picked.length === 1 ? "" : "s"} · about €${(costCents / 100).toFixed(2)}`}
            </span>
            <Button onClick={submit} disabled={busy || picked.length === 0}>
              {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
              {busy ? "Starting…" : "Generate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
