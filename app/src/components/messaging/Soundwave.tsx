"use client";

import { useEffect, useRef } from "react";

import { computeBarLevels, SOUNDWAVE_MIN_LEVEL } from "./soundwaveLevels";

/** Bars across the row — within the ~28-40 range that reads as a wave rather than either a single blob or noisy static. */
const BAR_COUNT = 32;
/** Small fftSize keeps ~30 bars chunky/responsive; smoothingTimeConstant softens frame-to-frame jitter into a wave instead of a flicker. */
const FFT_SIZE = 256;
const SMOOTHING = 0.75;
/** Fallback fill if --accent can't be read for any reason — matches globals.css's own base default. */
const FALLBACK_ACCENT = "#ff6a32";

/**
 * Live mic-reactive soundwave shown in the compose row, in place of the
 * `<textarea>`, for exactly the lifetime of one recording — AssistantChat
 * mounts this only while `voice.state === "recording"` (see
 * `useVoiceInput`'s `stream`, which is non-null for exactly that window).
 *
 * Purely presentational: it only ever READS `stream` through a Web Audio
 * AnalyserNode. It never stops a track (`useVoiceInput` alone owns that, via
 * its own `releaseMic`) and never connects the graph to `ctx.destination`, so
 * nothing is ever played back / no echo. One AudioContext is created per
 * mount and fully torn down — cancelAnimationFrame + disconnect + `ctx.close()`
 * — on unmount or whenever `stream` changes (both drive the same effect
 * cleanup), so repeated record/stop cycles never leak contexts.
 *
 * Fails soft: the whole setup below is wrapped in try/catch. If anything
 * throws (unsupported browser, a closed-context race, …) this silently
 * renders a blank canvas instead of the wave — recording lives entirely in
 * `useVoiceInput` and keeps working either way.
 */
export function Soundwave({ stream }: { stream: MediaStream }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const canvas2d = canvas?.getContext("2d") ?? null;
    if (!canvas || !canvas2d) return;

    let audioCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let rafId = 0;
    let stopped = false;
    let cssWidth = 0;
    let cssHeight = 0;

    try {
      const reduceMotion =
        typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // One-time read — getComputedStyle is too costly to call every
      // animation frame. --accent inherits from whatever ancestor sets it
      // (tenant theming, see /settings/appearance), so this stays
      // theme-aware without any extra light/dark branching.
      const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || FALLBACK_ACCENT;

      // A gentle, static undulating pattern (not flat bars) for the
      // reduced-motion path — reads as "listening" without spinning a 60fps loop.
      const idleLevels = Array.from(
        { length: BAR_COUNT },
        (_, i) => SOUNDWAVE_MIN_LEVEL + (1 - SOUNDWAVE_MIN_LEVEL) * 0.12 * (0.5 + 0.5 * Math.sin(i * 0.9)),
      );

      const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        cssWidth = canvas.clientWidth || 1;
        cssHeight = canvas.clientHeight || 1;
        canvas.width = Math.max(1, Math.round(cssWidth * dpr));
        canvas.height = Math.max(1, Math.round(cssHeight * dpr));
        canvas2d.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS-pixel coordinates; device pixels stay crisp
      };

      // Rounded-cap bar via a manual arc path rather than `ctx.roundRect` —
      // built only from primitives every canvas implementation has, so a
      // single bar just doesn't draw on an ancient browser instead of the
      // whole visualizer throwing on one unsupported call.
      const bar = (x: number, y: number, w: number, h: number) => {
        const r = Math.min(w / 2, h / 2);
        if (r <= 0) return;
        canvas2d.beginPath();
        canvas2d.moveTo(x + r, y);
        canvas2d.lineTo(x + w - r, y);
        canvas2d.arcTo(x + w, y, x + w, y + r, r);
        canvas2d.lineTo(x + w, y + h - r);
        canvas2d.arcTo(x + w, y + h, x + w - r, y + h, r);
        canvas2d.lineTo(x + r, y + h);
        canvas2d.arcTo(x, y + h, x, y + h - r, r);
        canvas2d.lineTo(x, y + r);
        canvas2d.arcTo(x, y, x + r, y, r);
        canvas2d.closePath();
        canvas2d.fill();
      };

      const draw = (levels: number[]) => {
        canvas2d.clearRect(0, 0, cssWidth, cssHeight);
        if (levels.length === 0) return;
        canvas2d.fillStyle = accent;
        const mid = cssHeight / 2;
        const maxAmp = Math.max(1, mid - 2); // small margin so full-height bars don't kiss the border
        const slot = cssWidth / levels.length;
        const barWidth = Math.max(2, slot * 0.55);
        levels.forEach((level, i) => {
          const amp = Math.max(1.5, level * maxAmp); // centered: grows both up and down from mid
          bar(i * slot + (slot - barWidth) / 2, mid - amp, barWidth, amp * 2);
        });
      };

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          resize();
          if (reduceMotion) draw(idleLevels); // no rAF loop to pick this up itself
        });
        resizeObserver.observe(canvas);
      }

      audioCtx = new AudioContext();
      void audioCtx.resume().catch(() => {}); // defensive — the user gesture already happened on the mic click
      source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = SMOOTHING;
      source.connect(analyser);
      // Deliberately never `analyser.connect(audioCtx.destination)` — reads
      // the mic only; nothing is ever played back.

      resize();

      if (reduceMotion) {
        draw(idleLevels);
      } else {
        const data = new Uint8Array(analyser.frequencyBinCount);
        const activeAnalyser = analyser; // narrowed local: closures over the outer `let` lose the non-null narrowing
        const loop = () => {
          if (stopped) return;
          try {
            resize();
            activeAnalyser.getByteFrequencyData(data);
            draw(computeBarLevels(data, BAR_COUNT));
          } catch {
            return; // fail soft mid-stream too — just stop animating, never throw into the frame
          }
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      }
    } catch {
      // Fail soft: no visualizer. Recording itself is untouched — it lives
      // entirely in useVoiceInput, which never calls into this component.
    }

    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      try {
        analyser?.disconnect();
      } catch {
        /* already disconnected */
      }
      try {
        source?.disconnect();
      } catch {
        /* already disconnected */
      }
      try {
        if (audioCtx && audioCtx.state !== "closed") void audioCtx.close();
      } catch {
        /* already closed */
      }
    };
  }, [stream]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        flex: 1,
        // 43px = the textarea it replaces: 14px font * 1.5 line-height +
        // 10px*2 padding + 1px*2 border (see the textarea styles in
        // AssistantChat.tsx) — border-box so this is the box's literal outer
        // height, keeping the compose row's height identical whichever one
        // is currently showing.
        height: 43,
        boxSizing: "border-box",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        background: "var(--bg)",
        display: "block",
      }}
    />
  );
}
