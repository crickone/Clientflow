"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Scissors, Trash2 } from "lucide-react";

import type { VideoAsset } from "@/lib/db/schema";
import type { Transcript } from "@/lib/ai/transcribe";
import type { TimelineDoc } from "@/lib/video/timeline";
import {
  layoutSegments,
  mapSourceToOutput,
  outputDuration,
  reorderSegment,
  trimSegment,
  updateBroll,
} from "@/lib/video/timeline";
import type { Selection } from "./types";

interface Props {
  timeline: TimelineDoc;
  transcript: Transcript;
  brollAssets: VideoAsset[];
  mainSourceDuration: number;
  playhead: number;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  onScrub: (outputSec: number) => void;
  onChange: (next: TimelineDoc) => void;
  onSplit: () => void;
  onDeleteSegment: (index: number) => void;
}

const LANE_H = 34;
const HANDLE = 8;
const MAIN_COLOUR = "#5a9bd4";
const BROLL_COLOUR = "#d2a24c";
const CAPTION_COLOUR = "#7bc47b";
const MUSIC_COLOUR = "#b38ad9";

function fmt(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

type Drag =
  | { kind: "scrub" }
  | { kind: "seg-move"; index: number; startX: number; dx: number }
  | { kind: "seg-trim-l" | "seg-trim-r"; index: number; startX: number; s0: number; e0: number }
  | {
      kind: "broll-move" | "broll-trim-l" | "broll-trim-r";
      index: number;
      startX: number;
      s0: number;
      e0: number;
    };

export function Timeline({
  timeline,
  transcript,
  brollAssets,
  mainSourceDuration,
  playhead,
  selection,
  onSelect,
  onScrub,
  onChange,
  onSplit,
  onDeleteSegment,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const segments = timeline.mainSegments;
  const laid = useMemo(() => layoutSegments(segments), [segments]);
  const total = useMemo(() => Math.max(outputDuration(segments), 0.1), [segments]);
  const brollById = useMemo(
    () => new Map(brollAssets.map((a) => [a.id, a])),
    [brollAssets],
  );

  const pct = (sec: number) => `${(sec / total) * 100}%`;

  const xToSec = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const ratio = (clientX - r.left) / Math.max(1, r.width);
      return Math.max(0, Math.min(1, ratio)) * total;
    },
    [total],
  );

  const pxToSec = useCallback(
    (px: number) => {
      const w = trackRef.current?.clientWidth ?? 1;
      return (px / w) * total;
    },
    [total],
  );

  // Global pointer handling for the active drag.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === "scrub") {
        onScrub(xToSec(e.clientX));
        return;
      }
      if (d.kind === "seg-move") {
        d.dx = e.clientX - d.startX;
        // live preview of where it would drop = scrub there
        onScrub(xToSec(e.clientX));
        // force a re-render via a no-op state? We rely on pointer styling only.
        return;
      }
      const dxSec = pxToSec(e.clientX - d.startX);
      if (d.kind === "seg-trim-l") {
        onChange(
          trimSegment(timeline, d.index, d.s0 + dxSec, d.e0, mainSourceDuration),
        );
      } else if (d.kind === "seg-trim-r") {
        onChange(
          trimSegment(timeline, d.index, d.s0, d.e0 + dxSec, mainSourceDuration),
        );
      } else if (d.kind === "broll-move") {
        const len = d.e0 - d.s0;
        const start = Math.max(0, Math.min(d.s0 + dxSec, total - len));
        onChange(updateBroll(timeline, d.index, { startSec: start, endSec: start + len }));
        onScrub(start);
      } else if (d.kind === "broll-trim-l") {
        const start = Math.max(0, Math.min(d.s0 + dxSec, d.e0 - 0.4));
        onChange(updateBroll(timeline, d.index, { startSec: start }));
        onScrub(start);
      } else if (d.kind === "broll-trim-r") {
        const end = Math.min(total, Math.max(d.e0 + dxSec, d.s0 + 0.4));
        onChange(updateBroll(timeline, d.index, { endSec: end }));
        onScrub(end);
      }
    }
    function onUp(e: PointerEvent) {
      const d = dragRef.current;
      if (d?.kind === "seg-move") {
        // Compute drop index from pointer position over the lane.
        const dropSec = xToSec(e.clientX);
        let target = laid.findIndex(
          (s) => dropSec < s.outputStart + s.length / 2,
        );
        if (target === -1) target = segments.length - 1;
        if (target !== d.index) {
          const adj = target > d.index ? target - 1 : target;
          onChange(reorderSegment(timeline, d.index, Math.max(0, adj)));
        }
      }
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [
    timeline,
    laid,
    segments.length,
    total,
    mainSourceDuration,
    onChange,
    onScrub,
    pxToSec,
    xToSec,
  ]);

  // caption chips: transcript segments remapped to output time (skip cut ones)
  const captionChips = useMemo(() => {
    const out: Array<{ id: number; start: number; end: number; text: string }> = [];
    for (const seg of transcript.segments) {
      const start = mapSourceToOutput(segments, seg.start);
      if (start == null) continue;
      const endMapped = mapSourceToOutput(segments, seg.end);
      const end = endMapped ?? Math.min(total, start + (seg.end - seg.start));
      if (end <= start) continue;
      out.push({ id: seg.id, start, end, text: seg.text.trim() });
    }
    return out;
  }, [transcript.segments, segments, total]);

  const ticks = useMemo(() => {
    const step = total > 120 ? 30 : total > 60 ? 10 : total > 20 ? 5 : 2;
    const arr: number[] = [];
    for (let t = 0; t <= total; t += step) arr.push(t);
    return arr;
  }, [total]);

  const selSegIdx = selection?.kind === "segment" ? selection.index : null;
  const selBrollIdx = selection?.kind === "broll" ? selection.index : null;
  const selCaptionId = selection?.kind === "caption" ? selection.segmentId : null;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {/* toolbar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
        <button type="button" onClick={onSplit} style={toolBtn} title="Split the segment under the playhead">
          <Scissors size={13} /> Split
        </button>
        {selSegIdx != null && segments.length > 1 && (
          <button
            type="button"
            onClick={() => onDeleteSegment(selSegIdx)}
            style={{ ...toolBtn, color: "#dc2626" }}
            title="Delete the selected segment"
          >
            <Trash2 size={13} /> Delete clip
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-tertiary)" }}>
          {fmt(playhead)} / {fmt(total)}
        </span>
      </div>

      {/* labels gutter + one shared scaled track column (so the ruler,
          playhead and all lane blocks live in the SAME x coordinate space) */}
      <div style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 8 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ height: 16 }} />
          {["Main", "B-roll", "Captions", "Music"].map((l) => (
            <div
              key={l}
              style={{
                height: LANE_H,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-tertiary)",
              }}
            >
              {l}
            </div>
          ))}
        </div>

        <div
          ref={trackRef}
          style={{ position: "relative", display: "grid", gap: 4, touchAction: "pan-y" }}
        >
          {/* ruler / scrub bar */}
          <div
            data-testid="timeline-ruler"
            onPointerDown={(e) => {
              dragRef.current = { kind: "scrub" };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              onScrub(xToSec(e.clientX));
            }}
            style={{
              position: "relative",
              height: 16,
              fontSize: 9,
              color: "var(--text-tertiary)",
              cursor: "ew-resize",
              borderBottom: "1px solid var(--hairline)",
            }}
          >
            {ticks.map((t) => (
              <div key={t} style={{ position: "absolute", left: pct(t), transform: "translateX(-50%)", pointerEvents: "none" }}>
                {fmt(t)}
              </div>
            ))}
          </div>

          {/* playhead spanning the lanes (below the ruler) */}
          <div
            style={{
              position: "absolute",
              left: pct(playhead),
              top: 16,
              bottom: 0,
              width: 2,
              transform: "translateX(-1px)",
              background: "var(--accent, #ef5a24)",
              zIndex: 6,
              pointerEvents: "none",
            }}
          />

          {/* MAIN */}
          <LaneBody>
            {laid.map((s, i) => {
            const sel = selSegIdx === i;
            return (
              <div
                key={i}
                data-testid={`seg-${i}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: "segment", index: i });
                  dragRef.current = { kind: "seg-move", index: i, startX: e.clientX, dx: 0 };
                }}
                style={{
                  position: "absolute",
                  left: pct(s.outputStart),
                  width: pct(s.length),
                  top: 3,
                  bottom: 3,
                  background: MAIN_COLOUR,
                  borderRadius: 4,
                  cursor: "grab",
                  outline: sel ? "2px solid var(--text-primary)" : "none",
                  outlineOffset: 1,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: HANDLE + 2,
                  color: "#06263f",
                  fontSize: 10,
                  fontWeight: 700,
                }}
                title={`Clip ${i + 1} · source ${s.sourceStart.toFixed(1)}–${s.sourceEnd.toFixed(1)}s`}
              >
                <Handle side="l" onDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = { kind: "seg-trim-l", index: i, startX: e.clientX, s0: s.sourceStart, e0: s.sourceEnd };
                }} />
                <span style={{ pointerEvents: "none" }}>{i + 1}</span>
                <Handle side="r" onDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = { kind: "seg-trim-r", index: i, startX: e.clientX, s0: s.sourceStart, e0: s.sourceEnd };
                }} />
              </div>
            );
          })}
        </LaneBody>

        {/* B-ROLL */}
        <LaneBody>
          {timeline.brollInserts.map((b, i) => {
            const sel = selBrollIdx === i;
            const asset = brollById.get(b.brollAssetId);
            return (
              <div
                key={i}
                data-testid={`broll-${i}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: "broll", index: i });
                  dragRef.current = { kind: "broll-move", index: i, startX: e.clientX, s0: b.startSec, e0: b.endSec };
                }}
                style={{
                  position: "absolute",
                  left: pct(b.startSec),
                  width: pct(Math.max(0.1, b.endSec - b.startSec)),
                  top: 3,
                  bottom: 3,
                  background: BROLL_COLOUR,
                  borderRadius: 4,
                  cursor: "grab",
                  outline: sel ? "2px solid var(--text-primary)" : "none",
                  outlineOffset: 1,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: HANDLE + 2,
                  color: "#3a2a06",
                  fontSize: 10,
                  fontWeight: 700,
                }}
                title={asset?.originalName ?? "(missing)"}
              >
                <Handle side="l" dark onDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = { kind: "broll-trim-l", index: i, startX: e.clientX, s0: b.startSec, e0: b.endSec };
                }} />
                <span style={{ pointerEvents: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {asset?.originalName ?? "?"}
                </span>
                <Handle side="r" dark onDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = { kind: "broll-trim-r", index: i, startX: e.clientX, s0: b.startSec, e0: b.endSec };
                }} />
              </div>
            );
          })}
        </LaneBody>

        {/* CAPTIONS */}
        <LaneBody>
          {captionChips.map((c) => {
            const sel = selCaptionId === c.id;
            return (
              <div
                key={c.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: "caption", segmentId: c.id });
                  onScrub(c.start);
                }}
                style={{
                  position: "absolute",
                  left: pct(c.start),
                  width: pct(Math.max(0.3, c.end - c.start)),
                  top: 5,
                  bottom: 5,
                  background: CAPTION_COLOUR,
                  opacity: sel ? 1 : 0.8,
                  borderRadius: 3,
                  cursor: "pointer",
                  outline: sel ? "2px solid var(--text-primary)" : "none",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  paddingInline: 4,
                  color: "#08331a",
                  fontSize: 9,
                  whiteSpace: "nowrap",
                }}
                title={c.text}
              >
                {c.text}
              </div>
            );
          })}
        </LaneBody>

        {/* MUSIC */}
        <LaneBody>
          <div
            style={{
              position: "absolute",
              inset: 3,
              borderRadius: 4,
              background: MUSIC_COLOUR,
              opacity: 0.85,
              display: "flex",
              alignItems: "center",
              paddingInline: 8,
              color: "#2a0e45",
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            Music bed
          </div>
          </LaneBody>
        </div>
      </div>
    </div>
  );
}

function LaneBody({ children }: { children: React.ReactNode }) {
  return (
      <div
        style={{
          position: "relative",
          height: LANE_H,
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: 5,
        }}
      >
        {children}
      </div>
  );
}

function Handle({
  side,
  onDown,
  dark,
}: {
  side: "l" | "r";
  onDown: (e: React.PointerEvent) => void;
  dark?: boolean;
}) {
  return (
    <div
      onPointerDown={onDown}
      style={{
        position: "absolute",
        [side === "l" ? "left" : "right"]: 0,
        top: 0,
        bottom: 0,
        width: HANDLE,
        cursor: "ew-resize",
        background: dark ? "rgba(0,0,0,0.28)" : "rgba(0,0,0,0.2)",
      }}
    />
  );
}

const toolBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "var(--bg)",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  padding: "5px 10px",
  fontSize: 12,
  color: "var(--text-primary)",
  cursor: "pointer",
  fontFamily: "inherit",
};
