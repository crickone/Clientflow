"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";

import { renderFileUrl } from "@/lib/image/renderStore.client";
import { hitIndexAt } from "@/lib/design/hitMap";
import { DUR, EASE } from "@/lib/motion";

/**
 * Click a word on a designed slide, edit it, see it re-render.
 *
 * HOW A CLICK FINDS A WORD. The slide is a PNG — flat pixels, no text layer —
 * so the click has to be resolved some other way. The server renders a HIT MAP:
 * the same design, with every editable text element filled with a colour that
 * encodes its index (see lib/design/hitMap). This component draws that map to
 * an offscreen canvas and reads the pixel under the cursor. The click regions
 * are therefore the boxes SATORI laid out, not boxes computed a second time
 * here — which is the failure this design exists to avoid: any independent
 * overlay eventually disagrees with the render, and then clicking a word edits
 * a different one.
 *
 * The hit map is never shown. It is decoded, and thrown away on unmount.
 *
 * WHAT YOU SEE IS WHAT EXPORTS. The edit is applied server-side and the slide
 * re-rendered through the same path that produced it, so the picture after an
 * edit is the export, exactly as it was before one.
 */

export interface TextRunSummary {
  index: number;
  text: string;
}

interface HitMapState {
  band: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export function SlideTextEditor({
  carouselId,
  slideId,
  renderFilename,
  aspectRatio,
  onEdited,
}: {
  carouselId: number;
  slideId: number;
  renderFilename: string;
  aspectRatio: string;
  /** The slide re-rendered — the parent swaps in the new file. */
  onEdited: (renderFilename: string) => void;
}) {
  const [runs, setRuns] = useState<TextRunSummary[]>([]);
  const [hit, setHit] = useState<HitMapState | null>(null);
  const [editing, setEditing] = useState<TextRunSummary | null>(null);
  const [draft, setDraft] = useState("");
  const [hovered, setHovered] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const reduce = useReducedMotion();
  const dur = reduce ? 0 : DUR.base;

  // Load the runs + hit map for this slide. Re-runs when the render changes,
  // because a regenerated slide has entirely different text in entirely
  // different places, and a stale hit map would point at the old words.
  useEffect(() => {
    let cancelled = false;
    setHit(null);
    setRuns([]);
    setEditing(null);

    (async () => {
      try {
        const d = await fetch(
          `/api/content-studio/carousels/${carouselId}/slide-text?slideId=${slideId}`,
        ).then((r) => r.json());
        if (cancelled || !d.ok || !d.hitMap) return;
        setRuns(d.runs as TextRunSummary[]);

        const img = new Image();
        img.src = d.hitMap as string;
        await img.decode();
        if (cancelled) return;
        const canvas = document.createElement("canvas");
        canvas.width = d.width;
        canvas.height = d.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        setHit({
          band: d.band as number,
          width: d.width as number,
          height: d.height as number,
          pixels: ctx.getImageData(0, 0, d.width, d.height).data,
        });
      } catch {
        // No click-to-edit for this slide. Regenerate and nudge still work.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [carouselId, slideId, renderFilename]);

  /** Which run is under this pointer event, if any. */
  const runAtEvent = useCallback(
    (e: React.MouseEvent<HTMLImageElement>): TextRunSummary | null => {
      if (!hit || !imgRef.current) return null;
      const rect = imgRef.current.getBoundingClientRect();
      if (rect.width === 0) return null;
      // The image is displayed at some CSS size; the hit map is at native
      // resolution. Scale the click into map space.
      const x = Math.round(((e.clientX - rect.left) / rect.width) * hit.width);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * hit.height);
      const index = hitIndexAt(hit.pixels, hit.width, hit.height, x, y, hit.band);
      if (index === null) return null;
      return runs.find((r) => r.index === index) ?? null;
    },
    [hit, runs],
  );

  function open(run: TextRunSummary) {
    setEditing(run);
    setDraft(run.text);
  }

  async function save() {
    if (!editing) return;
    const text = draft;
    if (text === editing.text) {
      setEditing(null);
      return;
    }
    setSaving(true);
    try {
      const d = await fetch(`/api/content-studio/carousels/${carouselId}/slide-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideId, index: editing.index, text }),
      }).then((r) => r.json());
      if (!d.ok) {
        toast.error(d.error ?? "Couldn't save that change.");
        return;
      }
      setRuns(d.runs as TextRunSummary[]);
      setEditing(null);
      onEdited(d.renderFilename as string);
    } catch {
      toast.error("Couldn't save that change.");
    } finally {
      setSaving(false);
    }
  }

  const clickable = hit !== null && runs.length > 0;

  return (
    <div style={{ position: "relative" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={renderFileUrl(renderFilename)}
        alt=""
        onMouseMove={(e) => setHovered(runAtEvent(e)?.index ?? null)}
        onMouseLeave={() => setHovered(null)}
        onClick={(e) => {
          const run = runAtEvent(e);
          if (run) open(run);
        }}
        style={{
          width: "100%",
          height: "auto",
          aspectRatio: aspectRatio.replace(":", " / "),
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-1)",
          background: "#0a0a0a",
          display: "block",
          cursor: hovered !== null ? "text" : "default",
        }}
      />

      {clickable && (
        <div
          style={{
            // Bottom-left: the top-left corner now carries the photo library's
            // popout, and two pills stacked in one corner read as clutter.
            position: "absolute",
            bottom: 10,
            left: 10,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
            padding: "5px 9px",
            borderRadius: 999,
            background: "rgba(10,10,10,0.66)",
            color: "#fff",
            pointerEvents: "none",
            opacity: hovered !== null ? 1 : 0.72,
            transition: `opacity ${DUR.fast}s`,
          }}
        >
          <Pencil size={11} />
          {hovered !== null ? "Click to edit this text" : "Click any text to edit it"}
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0, y: reduce ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : 6 }}
            transition={{ duration: dur, ease: EASE }}
            style={{
              position: "absolute",
              left: 12,
              right: 12,
              bottom: 12,
              background: "var(--surface-1)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-2)",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter saves, shift+enter is a line break — the design writes
                // those as <br/>, so a multi-line edit is a normal thing to want.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void save();
                }
                if (e.key === "Escape") setEditing(null);
              }}
              rows={Math.min(6, draft.split("\n").length + 1)}
              style={{
                width: "100%",
                resize: "vertical",
                background: "var(--bg)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius-sm)",
                padding: "10px 12px",
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "inherit",
                lineHeight: 1.4,
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="btn btn--primary btn--sm" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                {saving ? "Rendering…" : "Save"}
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setEditing(null)} disabled={saving}>
                <X size={13} />
                Cancel
              </button>
              <span style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginLeft: "auto" }}>
                Enter to save · Shift+Enter for a new line
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
