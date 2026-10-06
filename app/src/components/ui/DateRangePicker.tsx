"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A date-range control: one button that opens a panel with the preset
 * ranges on the left and a month calendar on the right for a custom range.
 * Click a first day, then a last day (or the same day twice for one day);
 * Apply commits it. Dates are ISO "YYYY-MM-DD" strings, local calendar days.
 */

export interface RangePreset {
  key: string;
  label: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const nice = (s: string) => fromIso(s).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
/** "3 Oct", with the year only when it is not this year. */
const short = (s: string) =>
  fromIso(s).toLocaleDateString("en-IE", s.slice(0, 4) === String(new Date().getFullYear()) ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });

export function DateRangePicker({
  presets,
  activeKey,
  label,
  custom,
  disabled,
  maxDays,
  onPreset,
  onCustom,
}: {
  presets: RangePreset[];
  /** The selected preset key, or "custom". */
  activeKey: string;
  /** What the button shows ("Last 30 days", "1 Sep to 30 Sep"). */
  label: string;
  custom?: { from: string; to: string };
  disabled?: boolean;
  /** Longest custom range accepted, in days; longer ones can't be applied. */
  maxDays?: number;
  onPreset: (key: string) => void;
  onCustom: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(custom?.from ?? null);
  const [end, setEnd] = useState<string | null>(custom?.to ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const today = iso(new Date());
  const [month, setMonth] = useState(() => {
    const base = custom?.to ? fromIso(custom.to) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= count; d++) cells.push(iso(new Date(month.getFullYear(), month.getMonth(), d)));
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [month]);

  function pickDay(d: string) {
    if (!start || end) {
      setStart(d);
      setEnd(null);
      return;
    }
    if (d < start) {
      setEnd(start);
      setStart(d);
    } else setEnd(d);
  }

  // The range being drawn: the committed pair, or start-to-hover while choosing the end.
  const lo = start && !end && hover ? (hover < start ? hover : start) : start;
  const hi = start && !end && hover ? (hover < start ? start : hover) : end;

  const spanDays = start ? Math.round((fromIso(end ?? start).getTime() - fromIso(start).getTime()) / 86400000) + 1 : 0;
  const tooLong = maxDays != null && spanDays > maxDays;

  const monthLabel = month.toLocaleDateString("en-IE", { month: "long", year: "numeric" });
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div ref={wrap} className="drp">
      <button
        type="button"
        className="drp-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <CalendarDays size={15} strokeWidth={1.9} />
        <span>{label}</span>
        <ChevronDown size={15} className="drp-chev" />
      </button>

      {open && (
        <div className="drp-panel" role="dialog" aria-label="Choose a date range">
          <div className="drp-presets">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                className={p.key === activeKey ? "drp-preset is-on" : "drp-preset"}
                onClick={() => {
                  setOpen(false);
                  if (p.key !== activeKey) onPreset(p.key);
                }}
              >
                <span>{p.label}</span>
                {p.key === activeKey && <Check size={15} />}
              </button>
            ))}
            <div className={activeKey === "custom" ? "drp-preset is-on is-static" : "drp-preset is-static"}>
              <span>Custom range</span>
              {activeKey === "custom" && <Check size={15} />}
            </div>
          </div>

          <div className="drp-cal">
            <div className="drp-cal-head">
              <button type="button" className="drp-nav" onClick={() => shift(-1)} aria-label="Previous month">
                <ChevronLeft size={16} />
              </button>
              <span className="drp-month">{monthLabel}</span>
              <button type="button" className="drp-nav" onClick={() => shift(1)} aria-label="Next month">
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="drp-grid" role="grid" onMouseLeave={() => setHover(null)}>
              {WEEKDAYS.map((w) => (
                <span key={w} className="drp-wd" aria-hidden>
                  {w}
                </span>
              ))}
              {days.map((d, i) =>
                d ? (
                  <button
                    key={d}
                    type="button"
                    className={[
                      "drp-day",
                      lo && hi && d > lo && d < hi ? "in" : "",
                      d === lo ? "lo" : "",
                      d === hi ? "hi" : "",
                      d === today ? "today" : "",
                    ].join(" ")}
                    aria-pressed={d === lo || d === hi}
                    aria-label={nice(d)}
                    onClick={() => pickDay(d)}
                    onMouseEnter={() => setHover(d)}
                  >
                    {Number(d.slice(8))}
                  </button>
                ) : (
                  <span key={`b${i}`} />
                ),
              )}
            </div>
            <div className="drp-foot">
              <span className={tooLong ? "drp-sel drp-sel--warn" : "drp-sel"}>
                {tooLong
                  ? `Pick ${maxDays} days or fewer`
                  : start
                    ? end
                      ? `${short(start)} to ${short(end)}`
                      : `${short(start)} to ...`
                    : "Pick a first day"}
              </span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={!start || tooLong}
                onClick={() => {
                  if (!start) return;
                  setOpen(false);
                  onCustom(start, end ?? start);
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
