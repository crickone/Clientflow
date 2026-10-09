"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Sparkles, Upload } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { libraryFileUrl } from "@/lib/image/paintSlide";
import { AD_SIZES, AD_SIZE_LABEL } from "@/lib/ads/adCopy";
import type { AdVersion } from "@/lib/ads/creatives";

interface LibraryPhoto {
  id: number;
  filename: string;
  kind?: string | null;
  label?: string | null;
}

/**
 * Change the photograph on one version of an ad, in all three sizes at once:
 * a feed, a square and a Stories image that showed three different pictures
 * would not be one ad. Pick from the library, upload one, or have Adonis make
 * one (metered). Applying re-renders each size through the same route the
 * post editor uses, so the words and layout stay exactly as they are.
 */
export function AdPhotoDialog({
  open,
  onOpenChange,
  version,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: AdVersion;
  onApplied: () => void;
}) {
  const current = version.images["4:5"]?.photoAssetId ?? null;
  const [photos, setPhotos] = useState<LibraryPhoto[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(current);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "upload" | "make" | "apply">(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setChosen(current);
    setError(null);
    fetch("/api/content-studio/image-library")
      .then((r) => r.json())
      .then((d) => setPhotos(((d.assets ?? []) as LibraryPhoto[]).filter((a) => a.kind !== "video" && a.kind !== "file")))
      .catch(() => setError("Couldn't load your photos. Try again."));
  }, [open, current]);

  const feedSlide = version.images["4:5"]?.slideId ?? null;
  const photoUrl = `/api/content-studio/carousels/${version.designId}/slides`;

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy("upload");
    setError(null);
    try {
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 0, h: 0 });
        img.src = URL.createObjectURL(file);
      });
      const fd = new FormData();
      fd.append("file", file);
      fd.append("width", String(dims.w));
      fd.append("height", String(dims.h));
      const res = await fetch("/api/content-studio/image-library", { method: "POST", body: fd });
      const d = await res.json().catch(() => null);
      const created = (d?.assets ?? []) as LibraryPhoto[];
      if (!res.ok || !d?.ok || created.length === 0) throw new Error(d?.error ?? "The upload failed.");
      setPhotos((p) => [...created, ...(p ?? [])]);
      setChosen(created[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload failed.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function make() {
    if (!feedSlide) return;
    setBusy("make");
    setError(null);
    try {
      const res = await fetch(`${photoUrl}/${feedSlide}/photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generate: true, onlyGenerate: true, slot: 1, ...(note.trim() ? { note: note.trim() } : {}) }),
        signal: AbortSignal.timeout(180_000),
      });
      const d = await res.json().catch(() => null);
      if (!d?.ok || !d.asset) throw new Error(d?.error ?? `Couldn't make the photo (HTTP ${res.status}).`);
      const asset = d.asset as LibraryPhoto;
      setPhotos((p) => [asset, ...(p ?? [])]);
      setChosen(asset.id);
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "TimeoutError"
          ? "That took too long and was stopped. Try again in a moment."
          : err instanceof Error
            ? err.message
            : "Couldn't make the photo.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (chosen == null) return;
    setBusy("apply");
    setError(null);
    const failed: string[] = [];
    for (const size of AD_SIZES) {
      const img = version.images[size];
      if (!img) continue;
      setApplying(AD_SIZE_LABEL[size]);
      try {
        const res = await fetch(`${photoUrl}/${img.slideId}/photo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId: chosen, slot: 1 }),
          signal: AbortSignal.timeout(180_000),
        });
        const d = await res.json().catch(() => null);
        if (!d?.ok) failed.push(AD_SIZE_LABEL[size]);
      } catch {
        failed.push(AD_SIZE_LABEL[size]);
      }
    }
    setApplying(null);
    setBusy(null);
    onApplied();
    if (failed.length) setError(`The photo didn't go onto: ${failed.join(", ")}. Try again.`);
    else onOpenChange(false);
  }

  const working = busy !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => !working && onOpenChange(o)}>
      <DialogContent title={`Change the photo, version ${version.variant}`} description="The new photo goes on all three sizes. The words and layout stay as they are." width={760}>
        <div className="adp">
          <div className="adp-tools">
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files)} />
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={working}>
              {busy === "upload" ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} Upload a photo
            </Button>
            <div className="adp-make">
              <input
                className="adp-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                placeholder="Or describe a new photo (optional)"
                aria-label="Describe the new photo"
                disabled={working}
              />
              <Button variant="outline" onClick={() => void make()} disabled={working || !feedSlide}>
                {busy === "make" ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {busy === "make" ? "Making it" : "Make a new photo"}
              </Button>
            </div>
          </div>

          {photos === null ? (
            <div className="adp-grid">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="skeleton adp-thumb" />
              ))}
            </div>
          ) : photos.length === 0 ? (
            <div className="adp-empty">
              <ImagePlus size={20} />
              No photos in your library yet. Upload one, or have Adonis make one.
            </div>
          ) : (
            <div className="adp-grid" role="radiogroup" aria-label="Your photos">
              {photos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen === p.id}
                  className="adp-thumb"
                  onClick={() => setChosen(p.id)}
                  disabled={working}
                  title={p.label ?? undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- our own library route */}
                  <img src={libraryFileUrl(p.filename)} alt={p.label ?? ""} loading="lazy" />
                  {chosen === p.id && (
                    <span className="adp-check">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  )}
                  {current === p.id && <span className="adp-now">On the ad now</span>}
                </button>
              ))}
            </div>
          )}

          {error && <p className="adp-error" role="alert">{error}</p>}

          <div className="adp-foot">
            <span className="adp-status">{applying ? `Updating ${applying}` : busy === "make" ? "Adonis is making the photo, about 20 seconds" : ""}</span>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={working}>
              Cancel
            </Button>
            <Button onClick={() => void apply()} disabled={working || chosen == null || chosen === current} loading={busy === "apply"}>
              Use this photo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
