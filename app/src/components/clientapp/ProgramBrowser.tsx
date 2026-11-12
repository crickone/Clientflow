// app/src/components/clientapp/ProgramBrowser.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Play } from "lucide-react";

import { Card } from "@/components/clientapp/ui";
import { NO_FILTER, byline, cardLine, filterCards, type CardFilter, type ProgramCard } from "@/lib/programs/cards";

const GOALS: [CardFilter["family"], string][] = [
  ["all", "All"],
  ["strength", "Strength"],
  ["peaking", "Powerlifting peak"],
  ["beginner", "Beginner"],
  ["size", "Size"],
];
const DAYS: [CardFilter["days"], string][] = [
  ["any", "Any"],
  ["3", "3 or fewer"],
  ["4", "4"],
  ["5+", "5 or more"],
];
const LENGTHS: [CardFilter["length"], string][] = [
  ["any", "Any"],
  ["short", "Up to 6 weeks"],
  ["medium", "7 to 12 weeks"],
  ["long", "Longer"],
];

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="td-label">{label}</div>
      <div className="pg-chips" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" className="pg-chip" aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The program library: filter by goal, days a week and length. */
export function ProgramBrowser({ cards, current }: { cards: ProgramCard[]; current: { name: string; paused: boolean } | null }) {
  const [f, setF] = useState<CardFilter>(NO_FILTER);
  const list = filterCards(cards, f);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {current && (
        <Link href="/app/programs/mine">
          <Card style={{ display: "flex", alignItems: "center", gap: 12, borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
            <Play size={18} style={{ color: "var(--accent-ink)", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>{current.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{current.paused ? "Paused while you're coach guided" : "Your program. Open it to train."}</div>
            </div>
            <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
          </Card>
        </Link>
      )}
      <Chips label="Goal" options={GOALS} value={f.family} onChange={(family) => setF({ ...f, family })} />
      <Chips label="Days a week" options={DAYS} value={f.days} onChange={(days) => setF({ ...f, days })} />
      <Chips label="Length" options={LENGTHS} value={f.length} onChange={(length) => setF({ ...f, length })} />
      {list.length === 0 ? (
        <Card style={{ textAlign: "center", fontSize: 13.5, color: "var(--text-secondary)" }}>No programs match. Try fewer filters.</Card>
      ) : (
        list.map((c) => (
          <Link key={c.key} href={`/app/programs/${encodeURIComponent(c.key)}`}>
            <Card style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{c.name}</span>
                <span className="pg-tag">{c.familyLabel}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{byline(c)}</div>
              <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                {cardLine(c)}. {c.who}
              </div>
              {c.warning && (
                <div className="pg-warning">
                  <AlertTriangle size={14} aria-hidden />
                  <span>{c.warning}</span>
                </div>
              )}
            </Card>
          </Link>
        ))
      )}
    </div>
  );
}
