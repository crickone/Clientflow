"use client";

import { useRef } from "react";
import { ImagePlus, Move } from "lucide-react";
import { Button } from "@/components/ui/Button";

export const DEFAULT_ASPECT = "16 / 9";
export const DEFAULT_POSITION = "50% 50%";

const ASPECTS: { key: string; label: string }[] = [
  { key: "21 / 9", label: "Wide" },
  { key: "16 / 9", label: "Landscape" },
  { key: "1 / 1", label: "Square" },
  { key: "4 / 5", label: "Portrait" },
  { key: "3 / 4", label: "Tall" },
];

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function parsePosition(p: string): { x: number; y: number } {
  const [x, y] = p.split(/\s+/).map((s) => parseFloat(s));
  return { x: Number.isFinite(x) ? x : 50, y: Number.isFinite(y) ? y : 50 };
}

export function CoverImageField({
  url,
  aspect,
  position,
  onAspect,
  onPosition,
  onChangeImage,
  onRemove,
}: {
  url: string;
  aspect: string;
  position: string;
  onAspect: (a: string) => void;
  onPosition: (p: string) => void;
  onChangeImage: () => void;
  onRemove: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    startX: number;
    startY: number;
    posX: number;
    posY: number;
  } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const { x, y } = parsePosition(position);
    drag.current = { startX: e.clientX, startY: e.clientY, posX: x, posY: y };
    frameRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const el = frameRef.current;
    if (!d || !el) return;
    const rect = el.getBoundingClientRect();
    // Drag the image right/down → reveal its left/top → object-position decreases.
    const dx = ((e.clientX - d.startX) / rect.width) * 100;
    const dy = ((e.clientY - d.startY) / rect.height) * 100;
    onPosition(`${Math.round(clamp(d.posX - dx))}% ${Math.round(clamp(d.posY - dy))}%`);
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = null;
    frameRef.current?.releasePointerCapture?.(e.pointerId);
  }

  // Size the frame by its aspect ratio, capped to a max height: width follows
  // the ratio (bounded to the column). Using width:100% + maxHeight together
  // would collapse every ratio to the same box, so compute the width instead.
  const FRAME_MAX_H = 420;
  const [rw, rh] = aspect.split("/").map((s) => parseFloat(s.trim()));
  const ratioNum = rw && rh ? rw / rh : 16 / 9;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {ASPECTS.map((a) => {
            const active = aspect === a.key;
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => onAspect(a.key)}
                aria-pressed={active}
                className="md-toolbar-btn"
                style={{
                  width: "auto",
                  padding: "0 12px",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {a.label}
              </button>
            );
          })}
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            color: "var(--text-tertiary)",
          }}
        >
          <Move size={12} /> Drag the image to reposition
        </span>
      </div>

      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: "relative",
          width: `min(100%, ${Math.round(FRAME_MAX_H * ratioNum)}px)`,
          maxWidth: "100%",
          aspectRatio: aspect,
          maxHeight: FRAME_MAX_H,
          overflow: "hidden",
          borderRadius: "var(--radius)",
          border: "1px solid var(--hairline)",
          background: "var(--bg)",
          cursor: "grab",
          touchAction: "none",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Cover"
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: position,
            display: "block",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" size="sm" variant="outline" onClick={onChangeImage}>
          <ImagePlus size={14} />
          Change cover
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}
