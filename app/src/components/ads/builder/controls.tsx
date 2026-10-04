"use client";

import type { ReactNode } from "react";
import { Eye, Heart, MessageCircle, Minus, MousePointerClick, Plus, UserPlus } from "lucide-react";

import type { Objective } from "@/lib/ads/spec";

/**
 * The ad builder's controls. Each replaces a raw input with something that
 * says what it sets: objective cards, a segmented switch, a budget stepper, a
 * two-handle age range, start/end toggles. Styling lives in globals.css
 * (.adb-*) so hover and focus states work, which inline styles cannot do.
 */

const OBJECTIVE_ICON: Record<Objective, typeof Eye> = {
  awareness: Eye,
  traffic: MousePointerClick,
  engagement: Heart,
  leads: UserPlus,
  messages: MessageCircle,
};

export function ObjectiveCards({
  options,
  value,
  onChange,
}: {
  options: Array<{ key: Objective; title: string; desc: string }>;
  value: Objective;
  onChange: (o: Objective) => void;
}) {
  return (
    <div className="adb-objectives" role="radiogroup" aria-label="Campaign goal">
      {options.map((o) => {
        const Icon = OBJECTIVE_ICON[o.key];
        const on = o.key === value;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} className="adb-objective" data-on={on} onClick={() => onChange(o.key)}>
            <span className="adb-objective-icon">
              <Icon size={18} strokeWidth={1.9} />
            </span>
            <span className="adb-objective-title">{o.title}</span>
            <span className="adb-objective-desc">{o.desc}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ key: T; label: ReactNode }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="adb-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={o.key === value} className="adb-seg-btn" data-on={o.key === value} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const fmt = (n: number, currency: string) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

/** Daily budget: a large figure with - and +, and what it comes to over a month. */
export function BudgetStepper({ value, onChange, currency, id }: { value: number; onChange: (n: number) => void; currency: string; id: string }) {
  const step = value >= 50 ? 5 : 1;
  const set = (n: number) => onChange(Math.max(1, Math.round(n * 100) / 100));
  return (
    <div className="adb-budget">
      <button type="button" className="adb-budget-btn" aria-label="Less" onClick={() => set(value - step)} disabled={value <= 1}>
        <Minus size={16} />
      </button>
      <label htmlFor={id} className="adb-budget-figure">
        <span className="adb-budget-currency">{fmt(0, currency).replace(/[\d.,\s]/g, "")}</span>
        <input id={id} type="number" min={1} step={1} inputMode="decimal" value={Number.isFinite(value) ? value : ""} onChange={(e) => set(Number(e.target.value))} aria-label={`Daily budget in ${currency}`} />
        <span className="adb-budget-unit">a day</span>
      </label>
      <button type="button" className="adb-budget-btn" aria-label="More" onClick={() => set(value + step)}>
        <Plus size={16} />
      </button>
      <span className="adb-budget-month">About {fmt(Math.round(value * 30.4), currency)} a month at most</span>
    </div>
  );
}

/** Ages 18-65+, two handles on one track. */
export function AgeRange({ min, max, onChange, id }: { min: number; max: number; onChange: (min: number, max: number) => void; id: string }) {
  const pct = (n: number) => ((n - 18) / (65 - 18)) * 100;
  return (
    <div className="adb-age">
      <div className="adb-age-figure" aria-live="polite">
        {min}–{max >= 65 ? "65+" : max}
      </div>
      <div className="adb-age-track">
        <span className="adb-age-fill" style={{ left: `${pct(min)}%`, right: `${100 - pct(max)}%` }} />
        <input id={`${id}-min`} type="range" min={18} max={65} value={min} aria-label="Youngest age" onChange={(e) => onChange(Math.min(Number(e.target.value), max), max)} />
        <input id={`${id}-max`} type="range" min={18} max={65} value={max} aria-label="Oldest age" onChange={(e) => onChange(min, Math.max(Number(e.target.value), min))} />
      </div>
    </div>
  );
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Start now / On a date" and "Run until paused / End on a date". */
export function DateChoice({
  id,
  value,
  onChange,
  openLabel,
  dateLabel,
}: {
  id: string;
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
  openLabel: string;
  dateLabel: string;
}) {
  const on = value != null;
  return (
    <div className="adb-datechoice">
      <Segmented
        label={dateLabel}
        value={on ? "date" : "open"}
        onChange={(v) => onChange(v === "open" ? null : new Date(Date.now() + 86_400_000).toISOString())}
        options={[
          { key: "open", label: openLabel },
          { key: "date", label: dateLabel },
        ]}
      />
      {on && (
        <input
          id={id}
          className="adb-date"
          type="datetime-local"
          value={toLocalInput(value)}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      )}
    </div>
  );
}
