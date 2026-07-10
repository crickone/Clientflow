"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import type { VideoAsset } from "@/lib/db/schema";

export interface PlanInsertDraft {
  brollAssetId: number;
  startSec: number;
  endSec: number;
  reason: string;
  brollStartSec?: number;
}

interface Props {
  projectId: number;
  /** The MAIN clip — used to power the preview player when no render exists. */
  mainAsset: VideoAsset | null;
  mainDurationSec: number;
  brollAssets: VideoAsset[];
  inserts: PlanInsertDraft[];
  onChange: (next: PlanInsertDraft[]) => void;
  selectedIdx: number | null;
  onSelectIdx: (idx: number | null) => void;
  /**
   * Filename of the latest rendered output, if any. When present we preview
   * the FINAL render (with intro / outro / captions / b-roll baked in) so
   * the operator can scrub through it and make precise adjustments before
   * re-rendering. When null we fall back to the original main + a live
   * b-roll overlay simulation.
   */
  renderedOutputFilename?: string | null;
  /** Aspect ratio of the rendered output (so the wrapper sizes correctly). */
  outputAspectRatio?: "9:16" | "1:1";
  /** Whether the render is bookended with intro / outro cards. */
  hasIntroOutro?: boolean;
  /** Length of the intro fade in seconds (when intro is enabled). */
  introDurationSec?: number;
  /** True if the plan has unsaved or unrendered changes (drives the banner). */
  hasUnrenderedEdits?: boolean;
}

const TRACK_HEIGHT = 56;
const HANDLE_WIDTH = 8;
const SNAP_SEC = 0.1;

function snap(sec: number): number {
  return Math.round(sec / SNAP_SEC) * SNAP_SEC;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function formatSec(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)}s`;
}

/**
 * Compute the CSS for a wrapper + a rotated <video> child so the visible
 * frame matches the asset's intended orientation after rotation. Takes the
 * measured wrapper size in pixels so the video's pre-rotation pixel
 * dimensions are exactly right after the CSS transform.
 */
function rotationStyle(
  rotation: number,
  natural: { w: number; h: number } | null,
  wrapperSize: { w: number; h: number } | null,
  fallbackAspect: string,
): { wrapper: React.CSSProperties; video: React.CSSProperties } {
  const r = ((rotation % 360) + 360) % 360;
  const isQuarter = r === 90 || r === 270;
  if (!natural) {
    return {
      wrapper: { aspectRatio: fallbackAspect },
      video: { width: "100%", height: "100%", objectFit: "contain" },
    };
  }
  if (!isQuarter) {
    return {
      wrapper: { aspectRatio: `${natural.w} / ${natural.h}` },
      video: {
        width: "100%",
        height: "100%",
        objectFit: "contain",
        transform: r === 180 ? "rotate(180deg)" : undefined,
      },
    };
  }
  // 90 or 270 — wrapper takes the SWAPPED aspect. The video is pre-sized
  // in PIXELS so its width = wrapper height and height = wrapper width;
  // after the CSS rotate it then fills the wrapper exactly.
  const w = wrapperSize?.w ?? 0;
  const h = wrapperSize?.h ?? 0;
  return {
    wrapper: { aspectRatio: `${natural.h} / ${natural.w}` },
    video:
      w > 0 && h > 0
        ? {
            position: "absolute",
            top: "50%",
            left: "50%",
            width: `${h}px`,
            height: `${w}px`,
            objectFit: "cover",
            transform: `translate(-50%, -50%) rotate(${r}deg)`,
            transformOrigin: "center center",
          }
        : // Wrapper not measured yet — hide video to avoid a flash of the
          // landscape source while it loads.
          {
            position: "absolute",
            inset: 0,
            visibility: "hidden",
          },
  };
}

const PALETTE = [
  "#2c6ce0",
  "#d2691e",
  "#8a3fd1",
  "#15803d",
  "#0a8b8b",
  "#b03060",
];

export function PlanTimelineEditor({
  projectId,
  mainAsset,
  mainDurationSec,
  brollAssets,
  inserts,
  onChange,
  selectedIdx,
  onSelectIdx,
  renderedOutputFilename,
  outputAspectRatio,
  hasIntroOutro,
  introDurationSec,
  hasUnrenderedEdits,
}: Props) {
  const mainAssetId = mainAsset?.id ?? null;
  // When previewing the RENDERED output, the file is already rotated +
  // scaled to the target aspect, so we don't need to apply CSS rotation.
  const usingRenderedPreview = !!renderedOutputFilename;
  const mainRotation = usingRenderedPreview
    ? 0
    : ((mainAsset?.rotation ?? 0) % 360 + 360) % 360;
  // Intro offset only matters when we're showing the rendered file and the
  // render included an intro card. Time-on-timeline 0 maps to file-time
  // introOffsetSec, so the playhead reflects "trimmed-main" time.
  const introOffsetSec =
    usingRenderedPreview && hasIntroOutro ? (introDurationSec ?? 1.6) : 0;
  const [mainNatural, setMainNatural] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [brollNatural, setBrollNatural] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const previewWrapperRef = useRef<HTMLDivElement | null>(null);
  const [previewSize, setPreviewSize] = useState<{
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    const el = previewWrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setPreviewSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mainAssetId, mainNatural?.w, mainNatural?.h, mainRotation]);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const dragRef = useRef<{
    idx: number;
    mode: "move" | "resize-start" | "resize-end";
    startX: number;
    originalStart: number;
    originalEnd: number;
    pointerId: number;
  } | null>(null);
  const scrubRef = useRef<boolean>(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const mainSrc = usingRenderedPreview
    ? `/api/content-studio/projects/${projectId}/output?v=${encodeURIComponent(
        renderedOutputFilename!,
      )}`
    : mainAssetId
      ? `/api/content-studio/projects/${projectId}/assets/${mainAssetId}/file`
      : null;

  /**
   * Which b-roll (if any) should be visible right now? An insert is "active"
   * when the playhead is inside its main-timeline window. We show the b-roll
   * video element overlaid on top of the main preview during that range so
   * the user can see exactly what their viewer will see.
   */
  const activeInsert = useMemo(() => {
    for (let i = 0; i < inserts.length; i++) {
      const ins = inserts[i];
      if (playheadSec >= ins.startSec && playheadSec < ins.endSec) {
        return { ins, idx: i };
      }
    }
    return null;
  }, [inserts, playheadSec]);

  // The b-roll overlay is only useful when we're previewing the ORIGINAL
  // main clip — the rendered file already has b-roll burned in.
  const activeBroll =
    !usingRenderedPreview && activeInsert
      ? brollAssets.find((a) => a.id === activeInsert.ins.brollAssetId) ?? null
      : null;
  const activeBrollSrc = activeBroll
    ? `/api/content-studio/projects/${projectId}/assets/${activeBroll.id}/file`
    : null;

  // Reset cached natural dimensions whenever the b-roll source changes so
  // the rotation styling recalculates against the new clip's aspect.
  useEffect(() => {
    setBrollNatural(null);
  }, [activeBroll?.id]);

  /**
   * Sync the b-roll preview's currentTime so the frame shown matches what
   * would appear at the playhead. Runs every time the playhead moves or the
   * active insert changes.
   */
  const brollVideoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = brollVideoRef.current;
    if (!el || !activeInsert) return;
    const into = playheadSec - activeInsert.ins.startSec;
    const target = (activeInsert.ins.brollStartSec ?? 0) + into;
    if (Math.abs(el.currentTime - target) > 0.06) {
      try {
        el.currentTime = target;
      } catch {}
    }
  }, [activeInsert, playheadSec]);

  // When playing the main video, also play the b-roll overlay so its frames
  // advance naturally instead of stepping via currentTime alone.
  useEffect(() => {
    const el = brollVideoRef.current;
    if (!el) return;
    if (!activeInsert) {
      if (!el.paused) el.pause();
      return;
    }
    if (isPlaying) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [activeInsert, isPlaying]);

  const seekTo = useCallback(
    (sec: number) => {
      const v = mainVideoRef.current;
      const clamped = Math.max(0, sec);
      setPlayheadSec(clamped);
      if (v) {
        try {
          v.currentTime = clamped + introOffsetSec;
        } catch {}
      }
    },
    [introOffsetSec],
  );

  function togglePlay() {
    const v = mainVideoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }

  // Scrub on click + drag of empty track area
  function trackTimeFromEvent(e: { clientX: number }): number {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
    return Math.max(0, Math.min(1, ratio)) * mainDurationSec;
  }

  const pxToSec = useCallback(
    (px: number) => {
      const w = trackRef.current?.clientWidth ?? 1;
      return (px / w) * mainDurationSec;
    },
    [mainDurationSec],
  );

  const startDrag = useCallback(
    (
      e: React.PointerEvent,
      idx: number,
      mode: "move" | "resize-start" | "resize-end",
    ) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectIdx(idx);
      const ins = inserts[idx];
      dragRef.current = {
        idx,
        mode,
        startX: e.clientX,
        originalStart: ins.startSec,
        originalEnd: ins.endSec,
        pointerId: e.pointerId,
      };
    },
    [inserts, onSelectIdx],
  );

  // Global pointer move/up — bound once, reads the latest state from refs.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dxSec = pxToSec(e.clientX - drag.startX);
      const length = drag.originalEnd - drag.originalStart;
      let newStart = drag.originalStart;
      let newEnd = drag.originalEnd;
      if (drag.mode === "move") {
        newStart = clamp(
          drag.originalStart + dxSec,
          0,
          Math.max(0, mainDurationSec - length),
        );
        newEnd = newStart + length;
      } else if (drag.mode === "resize-start") {
        newStart = clamp(drag.originalStart + dxSec, 0, drag.originalEnd - 0.5);
        newEnd = drag.originalEnd;
      } else {
        newEnd = clamp(
          drag.originalEnd + dxSec,
          drag.originalStart + 0.5,
          mainDurationSec,
        );
        newStart = drag.originalStart;
      }
      newStart = snap(newStart);
      newEnd = snap(newEnd);
      onChange(
        inserts.map((p, i) =>
          i === drag.idx ? { ...p, startSec: newStart, endSec: newEnd } : p,
        ),
      );
      // Sync the preview playhead to the edge being dragged so the operator
      // can see the frame of the main video at the cut point.
      if (drag.mode === "resize-start" || drag.mode === "move") {
        seekTo(newStart);
      } else if (drag.mode === "resize-end") {
        seekTo(newEnd);
      }
    }
    function onUp() {
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
  }, [inserts, mainDurationSec, onChange, pxToSec, seekTo]);

  // Time-axis tick marks
  const ticks = useMemo(() => {
    const step =
      mainDurationSec > 120
        ? 30
        : mainDurationSec > 60
          ? 10
          : mainDurationSec > 20
            ? 5
            : 2;
    const out: number[] = [];
    for (let t = 0; t <= mainDurationSec; t += step) {
      out.push(t);
    }
    return out;
  }, [mainDurationSec]);

  const colourFor = (assetId: number) =>
    PALETTE[Math.abs(assetId) % PALETTE.length];

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {/* Main video preview */}
      {mainSrc && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 380px) 1fr",
            gap: 14,
            alignItems: "start",
          }}
        >
          {(() => {
            // When previewing the rendered file, the wrapper should match
            // the OUTPUT aspect (9:16 or 1:1). The file is already rotated +
            // scaled so no CSS rotation needed.
            const fallback =
              usingRenderedPreview && outputAspectRatio === "1:1"
                ? "1 / 1"
                : usingRenderedPreview
                  ? "9 / 16"
                  : "16 / 9";
            const mainStyle = rotationStyle(
              mainRotation,
              mainNatural,
              previewSize,
              fallback,
            );
            const brollRotation =
              ((activeBroll?.rotation ?? 0) % 360 + 360) % 360;
            const brollStyle = rotationStyle(
              brollRotation,
              brollNatural,
              previewSize,
              "16 / 9",
            );
            return (
              <div
                ref={previewWrapperRef}
                style={{
                  position: "relative",
                  background: "#0a0a0a",
                  borderRadius: "var(--radius)",
                  overflow: "hidden",
                  border: "1px solid var(--hairline)",
                  ...mainStyle.wrapper,
                }}
              >
                <video
                  ref={mainVideoRef}
                  src={mainSrc}
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(e) =>
                    setMainNatural({
                      w: e.currentTarget.videoWidth || 16,
                      h: e.currentTarget.videoHeight || 9,
                    })
                  }
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onTimeUpdate={(e) => {
                    if (scrubRef.current) return;
                    const t = Math.max(
                      0,
                      e.currentTarget.currentTime - introOffsetSec,
                    );
                    setPlayheadSec(t);
                  }}
                  style={{ display: "block", ...mainStyle.video }}
                />
                {activeBrollSrc && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#000",
                    }}
                  >
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        height: "100%",
                        ...brollStyle.wrapper,
                        maxWidth: "100%",
                        maxHeight: "100%",
                      }}
                    >
                      <video
                        ref={brollVideoRef}
                        src={activeBrollSrc}
                        muted
                        playsInline
                        preload="auto"
                        onLoadedMetadata={(e) =>
                          setBrollNatural({
                            w: e.currentTarget.videoWidth || 16,
                            h: e.currentTarget.videoHeight || 9,
                          })
                        }
                        style={{ display: "block", ...brollStyle.video }}
                      />
                    </div>
                  </div>
                )}
                {activeInsert && (
                  <div
                    style={{
                      position: "absolute",
                      top: 8,
                      left: 8,
                      background: "rgba(0,0,0,0.7)",
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.08em",
                      padding: "3px 8px",
                      borderRadius: "var(--radius)",
                      pointerEvents: "none",
                      zIndex: 5,
                    }}
                  >
                    B-ROLL #{activeInsert.idx + 1}
                  </div>
                )}
              </div>
            );
          })()}
          <div
            style={{
              display: "grid",
              gap: 8,
              alignContent: "start",
              paddingTop: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <button
                type="button"
                onClick={togglePlay}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--hairline-strong)",
                  background: "var(--bg)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-primary)",
                  padding: 0,
                }}
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <div
                style={{
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: 13,
                  color: "var(--text-primary)",
                }}
              >
                {formatSec(playheadSec)} /{" "}
                <span style={{ color: "var(--text-tertiary)" }}>
                  {formatSec(mainDurationSec)}
                </span>
              </div>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-tertiary)",
                letterSpacing: "0.02em",
                lineHeight: 1.45,
              }}
            >
              {usingRenderedPreview
                ? "Showing the latest render. Drag B-roll blocks to adjust timing, then re-render to see the updates."
                : "Click on the timeline to jump there. Drag along it to scrub. Drag a block's edge while watching the preview to trim the cutaway to the exact frame."}
            </div>
            {usingRenderedPreview && hasUnrenderedEdits && (
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                  color: "#b45309",
                  background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.4)",
                  borderRadius: "var(--radius)",
                  padding: "6px 10px",
                }}
              >
                Plan changes since last render — re-render to apply.
              </div>
            )}
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: 11,
          color: "var(--text-tertiary)",
          letterSpacing: "0.04em",
        }}
      >
        <span>MAIN TIMELINE · {formatSec(mainDurationSec)}</span>
        <span>Drag to move · drag edges to resize</span>
      </div>
      {/* Time axis */}
      <div
        style={{
          position: "relative",
          height: 18,
          fontSize: 10,
          color: "var(--text-tertiary)",
        }}
      >
        {ticks.map((t) => (
          <div
            key={t}
            style={{
              position: "absolute",
              left: `${(t / Math.max(1, mainDurationSec)) * 100}%`,
              transform: "translateX(-50%)",
              top: 0,
              whiteSpace: "nowrap",
            }}
          >
            {t}s
          </div>
        ))}
      </div>
      {/* Track */}
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          // Begin scrubbing on the empty track. Stops if the target is one
          // of the b-roll blocks (those handle their own drag).
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          onSelectIdx(null);
          scrubRef.current = true;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          const t = trackTimeFromEvent(e);
          seekTo(t);
        }}
        onPointerMove={(e) => {
          if (!scrubRef.current) return;
          const t = trackTimeFromEvent(e);
          seekTo(t);
        }}
        onPointerUp={(e) => {
          if (!scrubRef.current) return;
          scrubRef.current = false;
          try {
            (e.currentTarget as HTMLDivElement).releasePointerCapture(
              e.pointerId,
            );
          } catch {}
        }}
        style={{
          position: "relative",
          height: TRACK_HEIGHT,
          background:
            "repeating-linear-gradient(90deg, var(--surface-1) 0 49px, var(--surface-2) 49px 50px)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
          cursor: mainSrc ? "ew-resize" : "default",
          touchAction: "pan-y",
        }}
      >
        {/* Playhead — vertical line at the current time */}
        {mainSrc && (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${(playheadSec / Math.max(1, mainDurationSec)) * 100}%`,
              width: 2,
              transform: "translateX(-1px)",
              background: "var(--text-primary)",
              pointerEvents: "none",
              zIndex: 5,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.5)",
            }}
          />
        )}
        {inserts.map((ins, idx) => {
          const left = (ins.startSec / Math.max(1, mainDurationSec)) * 100;
          const width =
            ((ins.endSec - ins.startSec) / Math.max(1, mainDurationSec)) * 100;
          const asset = brollAssets.find((a) => a.id === ins.brollAssetId);
          const colour = colourFor(ins.brollAssetId);
          const isSel = selectedIdx === idx;
          return (
            <div
              key={idx}
              onClick={(e) => {
                e.stopPropagation();
                onSelectIdx(idx);
              }}
              onPointerDown={(e) => startDrag(e, idx, "move")}
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${width}%`,
                top: 4,
                bottom: 4,
                background: colour,
                borderRadius: "var(--radius)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 600,
                cursor: "grab",
                display: "flex",
                alignItems: "center",
                paddingLeft: HANDLE_WIDTH + 4,
                paddingRight: HANDLE_WIDTH + 4,
                overflow: "hidden",
                outline: isSel ? "2px solid var(--text-primary)" : "none",
                outlineOffset: 1,
                boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
              }}
              title={`${asset?.originalName ?? "(missing)"} · ${formatSec(
                ins.startSec,
              )} → ${formatSec(ins.endSec)}`}
            >
              {/* Left resize handle */}
              <div
                onPointerDown={(e) => startDrag(e, idx, "resize-start")}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: HANDLE_WIDTH,
                  cursor: "ew-resize",
                  background: "rgba(0,0,0,0.25)",
                }}
              />
              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                  textShadow: "0 1px 2px rgba(0,0,0,0.45)",
                }}
              >
                {asset?.originalName ?? "(deleted)"}
              </span>
              {/* Right resize handle */}
              <div
                onPointerDown={(e) => startDrag(e, idx, "resize-end")}
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: HANDLE_WIDTH,
                  cursor: "ew-resize",
                  background: "rgba(0,0,0,0.25)",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Detail editor for the selected block */}
      {selectedIdx !== null && inserts[selectedIdx] && (
        <InsertDetailPanel
          projectId={projectId}
          insert={inserts[selectedIdx]}
          brollAssets={brollAssets}
          allInserts={inserts}
          activeIdx={selectedIdx}
          onChange={(patch) => {
            onChange(
              inserts.map((p, i) =>
                i === selectedIdx ? { ...p, ...patch } : p,
              ),
            );
          }}
          onDelete={() => {
            onChange(inserts.filter((_, i) => i !== selectedIdx));
            onSelectIdx(null);
          }}
        />
      )}
    </div>
  );
}

function InsertDetailPanel({
  projectId,
  insert,
  brollAssets,
  allInserts,
  activeIdx,
  onChange,
  onDelete,
}: {
  projectId: number;
  insert: PlanInsertDraft;
  brollAssets: VideoAsset[];
  allInserts: PlanInsertDraft[];
  activeIdx: number;
  onChange: (patch: Partial<PlanInsertDraft>) => void;
  onDelete: () => void;
}) {
  const asset = brollAssets.find((a) => a.id === insert.brollAssetId);
  const sourceUrl = asset
    ? `/api/content-studio/projects/${projectId}/assets/${asset.id}/file`
    : null;
  const insertLength = Math.max(0.5, insert.endSec - insert.startSec);
  const sourceDuration = asset?.durationSeconds ?? 0;
  const maxStart = Math.max(0, sourceDuration - insertLength);
  const brollStart = insert.brollStartSec ?? 0;

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Keep video preview in sync with the brollStart value
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (Math.abs(v.currentTime - brollStart) > 0.05) {
      try {
        v.currentTime = brollStart;
      } catch {}
    }
  }, [brollStart]);

  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 16,
        display: "grid",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          Cutaway #{activeIdx + 1} · {formatSec(insert.startSec)} →{" "}
          {formatSec(insert.endSec)}
        </div>
        <button
          type="button"
          onClick={onDelete}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius)",
            padding: "4px 10px",
            fontSize: 12,
            color: "#dc2626",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <Trash2 size={12} />
          Remove
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Source video scrubber */}
        <div style={{ display: "grid", gap: 8 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-secondary)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            B-roll source
          </div>
          {sourceUrl ? (
            <>
              <video
                ref={videoRef}
                src={sourceUrl}
                muted
                playsInline
                preload="metadata"
                style={{
                  width: "100%",
                  borderRadius: "var(--radius)",
                  background: "#0a0a0a",
                  aspectRatio: "16 / 9",
                  objectFit: "contain",
                }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (Math.abs(v.currentTime - brollStart) > 0.05) {
                    try {
                      v.currentTime = brollStart;
                    } catch {}
                  }
                }}
              />
              <div style={{ display: "grid", gap: 4 }}>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.1, maxStart)}
                  step={SNAP_SEC}
                  value={Math.min(brollStart, maxStart)}
                  onChange={(e) => {
                    const v = snap(Number(e.target.value));
                    onChange({ brollStartSec: v });
                    if (videoRef.current) {
                      try {
                        videoRef.current.currentTime = v;
                      } catch {}
                    }
                  }}
                  style={{ width: "100%" }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    color: "var(--text-tertiary)",
                  }}
                >
                  <span>Start in source: {brollStart.toFixed(1)}s</span>
                  <span>
                    Plays {formatSec(brollStart)} →{" "}
                    {formatSec(brollStart + insertLength)} of source
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div
              style={{
                color: "var(--text-tertiary)",
                fontSize: 12,
                padding: 16,
                border: "1px dashed var(--hairline)",
                borderRadius: "var(--radius)",
              }}
            >
              No b-roll source selected.
            </div>
          )}
        </div>

        {/* Asset picker + numeric fine-tune */}
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <Label>B-roll clip</Label>
            <select
              value={insert.brollAssetId}
              onChange={(e) =>
                onChange({
                  brollAssetId: Number(e.target.value),
                  brollStartSec: 0,
                })
              }
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: "8px 10px",
                color: "var(--text-primary)",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            >
              {brollAssets.map((b) => {
                const usedElsewhere = allInserts.some(
                  (p, i) => i !== activeIdx && p.brollAssetId === b.id,
                );
                return (
                  <option
                    key={b.id}
                    value={b.id}
                    disabled={usedElsewhere}
                  >
                    {b.originalName}
                    {usedElsewhere ? " (used)" : ""}
                  </option>
                );
              })}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <Label>Start in main (s)</Label>
              <NumberInput
                value={insert.startSec}
                step={0.1}
                min={0}
                onChange={(v) =>
                  onChange({
                    startSec: snap(v),
                    endSec: Math.max(snap(v) + 0.5, insert.endSec),
                  })
                }
              />
            </div>
            <div>
              <Label>Length (s)</Label>
              <NumberInput
                value={insertLength}
                step={0.1}
                min={0.5}
                onChange={(v) =>
                  onChange({ endSec: snap(insert.startSec + Math.max(0.5, v)) })
                }
              />
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
            Source duration:{" "}
            {asset?.durationSeconds
              ? `${asset.durationSeconds.toFixed(1)}s`
              : "—"}
            {asset?.durationSeconds && insertLength > asset.durationSeconds
              ? " — your cutaway is longer than the source and will freeze on the last frame."
              : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: "var(--text-secondary)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        fontWeight: 500,
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function NumberInput({
  value,
  step,
  min,
  onChange,
}: {
  value: number;
  step: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      step={step}
      min={min}
      value={Number(value.toFixed(2))}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width: "100%",
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: "8px 10px",
        color: "var(--text-primary)",
        fontSize: 13,
        fontFamily: "inherit",
      }}
    />
  );
}
