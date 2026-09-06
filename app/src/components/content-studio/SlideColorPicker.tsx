"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Check } from "lucide-react";

import {
  clamp01,
  hexToHsv,
  hsvToHex,
  normaliseHex,
  readableTextOn,
  type Hsv,
} from "@/lib/image/color";

/**
 * The slide's colours, as one circular swatch under the preview.
 *
 * Both colours used to live in the Style section down the controls column, so
 * changing one meant scrolling away from the very thing you were changing.
 * This sits beside the slide actions, and the panel is PORTALLED to the body:
 * the preview column is a capped, scrollable, sticky container, so a panel
 * positioned inside it would simply be clipped.
 */

const PANEL_WIDTH = 248;

type Channel = "accent" | "background";

export function SlideColorPicker({
  accent,
  background,
  onAccent,
  onBackground,
  accentSwatches,
  backgroundSwatches,
  disabled = false,
}: {
  accent: string;
  background: string | null;
  onAccent: (hex: string) => void;
  onBackground: (hex: string | null) => void;
  accentSwatches: string[];
  backgroundSwatches: string[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("accent");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Fixed coordinates off the trigger, recomputed while open so scrolling the
  // page (or the preview column) doesn't leave the panel behind.
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelH = panelRef.current?.offsetHeight ?? 300;
    const below = r.bottom + 8;
    // Flip above when there isn't room below.
    const top =
      below + panelH > window.innerHeight - 8
        ? Math.max(8, r.top - panelH - 8)
        : below;
    const left = Math.min(
      Math.max(8, r.left + r.width / 2 - PANEL_WIDTH / 2),
      window.innerWidth - PANEL_WIDTH - 8,
    );
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true); // true: catches the column too
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t))
        return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const value = channel === "accent" ? accent : background;
  const swatches = channel === "accent" ? accentSwatches : backgroundSwatches;

  function setValue(hex: string | null) {
    if (channel === "accent") {
      if (hex) onAccent(hex);
    } else {
      onBackground(hex);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Slide colours"
        title="Slide colours"
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          padding: 0,
          flex: "0 0 auto",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
          background: accent,
          // Two rings so a swatch the colour of the page still reads as a
          // control, and the open state is visible at a glance.
          border: "2px solid var(--bg)",
          boxShadow: open
            ? "0 0 0 2px var(--text-primary)"
            : "0 0 0 1px var(--hairline-strong)",
        }}
      />
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Slide colours"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: PANEL_WIDTH,
              zIndex: 95,
              background: "var(--surface-1)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-2)",
              padding: 12,
              display: "grid",
              gap: 10,
              animation: "fade-up 0.14s var(--ease)",
            }}
          >
            <div
              role="group"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 2,
                padding: 2,
                background: "var(--surface-2)",
                borderRadius: "var(--radius)",
              }}
            >
              {(
                [
                  { id: "accent" as const, label: "Accent" },
                  { id: "background" as const, label: "Background" },
                ]
              ).map((c) => {
                const active = channel === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setChannel(c.id)}
                    aria-pressed={active}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "calc(var(--radius) - 2px)",
                      border: "none",
                      background: active ? "var(--bg)" : "transparent",
                      color: active
                        ? "var(--text-primary)"
                        : "var(--text-secondary)",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>

            <ColorField
              value={value}
              onChange={setValue}
              allowNone={channel === "background"}
              swatches={swatches}
            />

            {channel === "background" && (
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  lineHeight: 1.4,
                }}
              >
                Used when no background photo is set. A photo always wins.
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/** The gradient map, hue slider, presets and hex field for one colour. */
function ColorField({
  value,
  onChange,
  allowNone,
  swatches,
}: {
  value: string | null;
  onChange: (hex: string | null) => void;
  allowNone: boolean;
  swatches: string[];
}) {
  const fallback = value ?? "#0a0a0a";
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(fallback) ?? { h: 0, s: 0, v: 0 });
  const [draft, setDraft] = useState(fallback);
  // What we last sent out. Without this, dragging brightness to zero gives
  // #000000, which has no hue — re-reading it would snap the handle to red.
  const emittedRef = useRef(fallback);

  useEffect(() => {
    const next = value ?? "#0a0a0a";
    if (next === emittedRef.current) return;
    const parsed = hexToHsv(next);
    if (parsed) setHsv(parsed);
    emittedRef.current = next;
    setDraft(next);
  }, [value]);

  const commit = useCallback(
    (next: Hsv) => {
      setHsv(next);
      const hex = hsvToHex(next);
      emittedRef.current = hex;
      setDraft(hex);
      onChange(hex);
    },
    [onChange],
  );

  const hex = hsvToHex(hsv);
  const hueHex = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <div style={{ display: "grid", gap: 9 }}>
      <DragSurface
        ariaLabel="Saturation and brightness"
        height={120}
        onPick={(x, y) => commit({ h: hsv.h, s: x, v: 1 - y })}
        style={{
          borderRadius: "var(--radius)",
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`,
        }}
        handleX={hsv.s}
        handleY={1 - hsv.v}
        handleColor={hex}
      />
      <DragSurface
        ariaLabel="Hue"
        height={14}
        onPick={(x) => commit({ ...hsv, h: x * 360 })}
        style={{
          borderRadius: 999,
          background:
            "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
        }}
        handleX={hsv.h / 360}
        handleY={0.5}
        handleColor={hueHex}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {allowNone && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="No colour"
            title="No colour"
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              padding: 0,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              color: "var(--text-secondary)",
              background:
                "repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 50% / 8px 8px",
              border: !value
                ? "2px solid var(--text-primary)"
                : "1px solid var(--hairline-strong)",
            }}
          >
            {!value && <Ban size={11} />}
          </button>
        )}
        {swatches.map((c) => {
          const active = (value ?? "").toLowerCase() === c.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              aria-label={c}
              title={c}
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                padding: 0,
                background: c,
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                color: readableTextOn(c),
                border: active
                  ? "2px solid var(--text-primary)"
                  : "1px solid var(--hairline-strong)",
              }}
            >
              {active && <Check size={11} strokeWidth={3} />}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            flex: "0 0 auto",
            borderRadius: "50%",
            background: value ?? "transparent",
            border: "1px solid var(--hairline-strong)",
            backgroundImage: value
              ? undefined
              : "repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%)",
            backgroundSize: value ? undefined : "8px 8px",
          }}
        />
        <input
          value={draft}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            // Only commit once it's a real colour, so the slide doesn't change
            // on every keystroke of a half-typed hex.
            const clean = normaliseHex(raw);
            if (clean) {
              const parsed = hexToHsv(clean);
              if (parsed) setHsv(parsed);
              emittedRef.current = clean;
              onChange(clean);
            }
          }}
          onBlur={() => setDraft(value ?? "")}
          spellCheck={false}
          aria-label="Hex colour"
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--field-bg)",
            border: "1px solid transparent",
            borderRadius: "var(--radius-field)",
            padding: "6px 9px",
            color: "var(--text-primary)",
            fontSize: 12,
            fontFamily: "var(--font-mono), ui-monospace, monospace",
          }}
        />
      </div>
    </div>
  );
}

/**
 * A rectangle you drag a handle around. Pointer capture means the drag keeps
 * tracking once the pointer leaves the rectangle, which is how every colour
 * picker behaves — you shouldn't have to stay inside the box to reach pure
 * white.
 */
function DragSurface({
  ariaLabel,
  height,
  onPick,
  style,
  handleX,
  handleY,
  handleColor,
}: {
  ariaLabel: string;
  height: number;
  onPick: (x: number, y: number) => void;
  style: React.CSSProperties;
  handleX: number;
  handleY: number;
  handleColor: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  function pick(clientX: number, clientY: number) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onPick(
      clamp01((clientX - r.left) / r.width),
      clamp01((clientY - r.top) / r.height),
    );
  }

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(handleX * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault(); // don't start a text selection
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          pick(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.02;
        if (e.key === "ArrowLeft") onPick(clamp01(handleX - step), handleY);
        else if (e.key === "ArrowRight") onPick(clamp01(handleX + step), handleY);
        else if (e.key === "ArrowUp") onPick(handleX, clamp01(handleY - step));
        else if (e.key === "ArrowDown") onPick(handleX, clamp01(handleY + step));
        else return;
        e.preventDefault();
      }}
      style={{
        position: "relative",
        height,
        width: "100%",
        cursor: "crosshair",
        touchAction: "none", // or the page scrolls instead of the handle moving
        border: "1px solid var(--hairline)",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: `${handleX * 100}%`,
          top: `${handleY * 100}%`,
          transform: "translate(-50%, -50%)",
          width: 13,
          height: 13,
          borderRadius: "50%",
          background: handleColor,
          border: "2px solid #fff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
