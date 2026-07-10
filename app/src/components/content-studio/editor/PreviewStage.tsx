"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

import type { VideoAsset } from "@/lib/db/schema";
import type { TranscriptWord } from "@/lib/ai/transcribe";
import type { TimelineDoc } from "@/lib/video/timeline";
import { layoutSegments, mapOutputToSource, outputDuration } from "@/lib/video/timeline";
import {
  activePhrase,
  configFor,
  phrasesForDisplay,
  type AspectRatio,
} from "@/lib/video/captionPhrases";
import { coverFitStyle } from "@/lib/video/rotationStyle";

/** Imperative API so a parent timeline can scrub/play the preview. */
export interface PreviewHandle {
  seekTo(outputSec: number): void;
  play(): void;
  pause(): void;
  getPlayhead(): number;
}

interface Props {
  projectId: number;
  timeline: TimelineDoc;
  assets: VideoAsset[];
  /** Transcript words (caption source), already in SOURCE-clip coordinates. */
  words: TranscriptWord[];
  aspectRatio: AspectRatio;
  captionFont?: string | null;
  /** URL for the background music track, or null. */
  musicSrc?: string | null;
  musicVolume?: number;
  /** Fires as the output playhead moves (so a parent timeline can follow). */
  onPlayheadChange?: (outputSec: number) => void;
  onPlayingChange?: (playing: boolean) => void;
}

const SEEK_EPSILON = 0.04;

function fmt(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const PreviewStage = forwardRef<PreviewHandle, Props>(function PreviewStage(
  {
    projectId,
    timeline,
    assets,
    words,
    aspectRatio,
    captionFont,
    musicSrc,
    musicVolume = 0.2,
    onPlayheadChange,
    onPlayingChange,
  },
  ref,
) {
  const mainAsset = useMemo(
    () => assets.find((a) => a.kind === "main") ?? null,
    [assets],
  );
  const brollById = useMemo(
    () => new Map(assets.filter((a) => a.kind === "broll").map((a) => [a.id, a])),
    [assets],
  );

  const segments = timeline.mainSegments;
  const laid = useMemo(() => layoutSegments(segments), [segments]);
  const total = useMemo(() => outputDuration(segments), [segments]);

  // Captions, re-timed onto the output timeline (preview = approximation).
  const phrases = useMemo(() => {
    // remap words → output coords using the same midpoint rule as the renderer
    // (kept local to avoid importing the server caption builder)
    const out: TranscriptWord[] = [];
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      const seg = laid.find((s) => mid >= s.sourceStart && mid < s.sourceEnd);
      if (!seg) continue;
      const startInSeg = Math.max(0, w.start - seg.sourceStart);
      const endInSeg = Math.min(seg.length, w.end - seg.sourceStart);
      out.push({
        word: w.word,
        start: seg.outputStart + startInSeg,
        end: seg.outputStart + Math.max(startInSeg, endInSeg),
      });
    }
    out.sort((a, b) => a.start - b.start);
    return phrasesForDisplay(out);
  }, [words, laid]);

  const cfg = useMemo(() => configFor(aspectRatio), [aspectRatio]);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const brollVideoRef = useRef<HTMLVideoElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  /** Which output-order segment the main video is currently playing. */
  const segIndexRef = useRef(0);

  const [wrapperSize, setWrapperSize] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setWrapperSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const emitPlayhead = useCallback(
    (t: number) => {
      setPlayhead(t);
      onPlayheadChange?.(t);
    },
    [onPlayheadChange],
  );

  const mainRotation = mainAsset?.rotation ?? 0;

  // ── active b-roll at the current playhead ────────────────────────────────
  const activeInsert = useMemo(() => {
    for (let i = 0; i < timeline.brollInserts.length; i++) {
      const ins = timeline.brollInserts[i];
      if (playhead >= ins.startSec && playhead < ins.endSec) return { ins, idx: i };
    }
    return null;
  }, [timeline.brollInserts, playhead]);
  const activeBroll = activeInsert
    ? brollById.get(activeInsert.ins.brollAssetId) ?? null
    : null;
  const activeBrollSrc = activeBroll
    ? `/api/content-studio/projects/${projectId}/assets/${activeBroll.id}/file`
    : null;

  // Keep the b-roll frame in sync with the playhead.
  useEffect(() => {
    const el = brollVideoRef.current;
    if (!el || !activeInsert) return;
    const into = playhead - activeInsert.ins.startSec;
    const target = (activeInsert.ins.brollStartSec ?? 0) + into;
    if (Math.abs(el.currentTime - target) > 0.06) {
      try {
        el.currentTime = target;
      } catch {}
    }
  }, [activeInsert, playhead]);

  useEffect(() => {
    const el = brollVideoRef.current;
    if (!el) return;
    if (!activeInsert) {
      if (!el.paused) el.pause();
      return;
    }
    if (playing) el.play().catch(() => {});
    else el.pause();
  }, [activeInsert, playing]);

  // ── core seek: position the main <video> for an output time ──────────────
  const applySeek = useCallback(
    (outputSec: number) => {
      const v = mainVideoRef.current;
      const clamped = Math.max(0, Math.min(outputSec, total));
      const pos = mapOutputToSource(segments, clamped);
      if (pos) {
        segIndexRef.current = pos.segmentIndex;
        if (v && Math.abs(v.currentTime - pos.sourceTime) > SEEK_EPSILON) {
          try {
            v.currentTime = pos.sourceTime;
          } catch {}
        }
      }
      const music = musicRef.current;
      if (music && Math.abs(music.currentTime - clamped) > 0.12) {
        try {
          music.currentTime = clamped;
        } catch {}
      }
      emitPlayhead(clamped);
    },
    [segments, total, emitPlayhead],
  );

  // ── playback loop: advance across segment boundaries ─────────────────────
  const tick = useCallback(() => {
    const v = mainVideoRef.current;
    if (!v) return;
    let idx = segIndexRef.current;
    let seg = laid[idx];
    if (!seg) {
      stopLoopAndPause();
      return;
    }
    // Crossed the end of the current segment → jump to the next one.
    if (v.currentTime >= seg.sourceEnd - SEEK_EPSILON) {
      idx += 1;
      if (idx >= laid.length) {
        emitPlayhead(total);
        stopLoopAndPause();
        return;
      }
      segIndexRef.current = idx;
      seg = laid[idx];
      try {
        v.currentTime = seg.sourceStart;
      } catch {}
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    const output = seg.outputStart + (v.currentTime - seg.sourceStart);
    emitPlayhead(Math.min(output, total));
    rafRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laid, total, emitPlayhead]);

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const stopLoopAndPause = useCallback(() => {
    stopLoop();
    const v = mainVideoRef.current;
    if (v && !v.paused) v.pause();
    const music = musicRef.current;
    if (music && !music.paused) music.pause();
    setPlaying(false);
    onPlayingChange?.(false);
  }, [stopLoop, onPlayingChange]);

  const doPlay = useCallback(() => {
    const v = mainVideoRef.current;
    if (!v || total <= 0) return;
    // Restart from the top if we're parked at the end.
    const startAt = playhead >= total - SEEK_EPSILON ? 0 : playhead;
    if (startAt !== playhead) applySeek(0);
    // Make sure we're positioned inside the current segment.
    const pos = mapOutputToSource(segments, Math.min(startAt, total));
    if (pos) {
      segIndexRef.current = pos.segmentIndex;
      if (Math.abs(v.currentTime - pos.sourceTime) > SEEK_EPSILON) {
        try {
          v.currentTime = pos.sourceTime;
        } catch {}
      }
    }
    v.play().catch(() => {});
    const music = musicRef.current;
    if (music && musicSrc) {
      music.volume = Math.max(0, Math.min(1, musicVolume));
      music.play().catch(() => {});
    }
    setPlaying(true);
    onPlayingChange?.(true);
    stopLoop();
    rafRef.current = requestAnimationFrame(tick);
  }, [
    total,
    playhead,
    segments,
    applySeek,
    musicSrc,
    musicVolume,
    onPlayingChange,
    stopLoop,
    tick,
  ]);

  const doPause = useCallback(() => {
    stopLoopAndPause();
  }, [stopLoopAndPause]);

  useEffect(() => () => stopLoop(), [stopLoop]);

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (sec: number) => applySeek(sec),
      play: () => doPlay(),
      pause: () => doPause(),
      getPlayhead: () => playhead,
    }),
    [applySeek, doPlay, doPause, playhead],
  );

  const togglePlay = useCallback(() => {
    if (playing) doPause();
    else doPlay();
  }, [playing, doPlay, doPause]);

  // spacebar = play/pause
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === "Space" && !(e.target as HTMLElement)?.closest("input,textarea")) {
        e.preventDefault();
        togglePlay();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  const mainSrc = mainAsset
    ? `/api/content-studio/projects/${projectId}/assets/${mainAsset.id}/file`
    : null;
  const outAspect = aspectRatio === "1:1" ? "1 / 1" : "9 / 16";
  const caption = activePhrase(phrases, playhead);

  // Caption placement as a fraction of frame height, mirroring the ASS margins.
  const capBottomPct = (cfg.marginVBottom / cfg.height) * 100;
  const capFontVw = (cfg.fontSize / cfg.width) * 100; // % of preview width

  return (
    <div style={{ display: "grid", gap: 10, justifyItems: "center" }}>
      <div
        ref={wrapperRef}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: aspectRatio === "1:1" ? 420 : 300,
          aspectRatio: outAspect,
          background: "#000",
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--hairline)",
          containerType: "inline-size",
        }}
      >
        {mainSrc ? (
          <video
            ref={mainVideoRef}
            src={mainSrc}
            playsInline
            preload="auto"
            onLoadedMetadata={() => applySeek(playhead)}
            onEnded={() => stopLoopAndPause()}
            style={{ display: "block", ...coverFitStyle(mainRotation, wrapperSize) }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "var(--text-tertiary)",
              fontSize: 13,
            }}
          >
            No main clip
          </div>
        )}

        {/* B-roll overlay (covers the frame during a cutaway) */}
        {activeBrollSrc && (
          <div style={{ position: "absolute", inset: 0, background: "#000" }}>
            <video
              ref={brollVideoRef}
              key={activeBroll?.id}
              src={activeBrollSrc}
              muted
              playsInline
              preload="auto"
              style={{
                display: "block",
                ...coverFitStyle(activeBroll?.rotation ?? 0, wrapperSize),
              }}
            />
          </div>
        )}

        {/* Caption overlay */}
        {caption && (
          <div
            style={{
              position: "absolute",
              left: "6%",
              right: "6%",
              bottom: `${capBottomPct}%`,
              textAlign: "center",
              pointerEvents: "none",
              fontFamily: `${captionFont ?? "Arial Black"}, Arial, sans-serif`,
              fontWeight: 900,
              fontSize: `${capFontVw}cqw`,
              lineHeight: 1.05,
              color: "#fff",
              textTransform: "uppercase",
              textShadow:
                "0 0 6px #000, 2px 2px 0 #000, -2px 2px 0 #000, 2px -2px 0 #000, -2px -2px 0 #000",
              WebkitTextStroke: "1px #000",
            }}
          >
            {caption.text}
          </div>
        )}
      </div>

      {musicSrc && (
        <audio ref={musicRef} src={musicSrc} preload="auto" style={{ display: "none" }} />
      )}

      {/* Transport */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <TransportButton title="Back to start" onClick={() => applySeek(0)}>
          <SkipBack size={15} />
        </TransportButton>
        <TransportButton title={playing ? "Pause" : "Play"} onClick={togglePlay} primary>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </TransportButton>
        <TransportButton title="To end" onClick={() => applySeek(total)}>
          <SkipForward size={15} />
        </TransportButton>
        <div
          style={{
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            fontSize: 13,
            color: "var(--text-primary)",
            minWidth: 92,
            textAlign: "center",
          }}
        >
          {fmt(playhead)}{" "}
          <span style={{ color: "var(--text-tertiary)" }}>/ {fmt(total)}</span>
        </div>
      </div>
    </div>
  );
});

function TransportButton({
  children,
  onClick,
  title,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: primary ? 40 : 34,
        height: primary ? 40 : 34,
        borderRadius: 8,
        border: "1px solid var(--hairline-strong, var(--hairline))",
        background: primary ? "var(--accent, #ef5a24)" : "var(--bg)",
        color: primary ? "#fff" : "var(--text-primary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}
