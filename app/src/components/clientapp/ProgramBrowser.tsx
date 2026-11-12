// app/src/components/clientapp/ProgramBrowser.tsx
"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { PhaseBar, Pill, Pills, PkCard, PkSection } from "@/components/clientapp/programs/kit";
import { byline, filterCards, filterQuery, groupByGoal, type CardFilter, type StoryCard } from "@/lib/programs/cards";

const GOALS: [CardFilter["family"], string][] = [
  ["all", "Any goal"],
  ["strength", "Strength"],
  ["peaking", "Powerlifting peak"],
  ["beginner", "Beginner"],
  ["size", "Size"],
];
const DAYS: [CardFilter["days"], string][] = [
  ["any", "Any days"],
  ["3", "3 or fewer"],
  ["4", "4 days"],
  ["5+", "5 or more"],
];
const LENGTHS: [CardFilter["length"], string][] = [
  ["any", "Any length"],
  ["short", "Up to 6 weeks"],
  ["medium", "7 to 12 weeks"],
  ["long", "Longer"],
];

function Filter<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <select className="pk-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

function ProgramStoryCard({ c }: { c: StoryCard }) {
  return (
    <PkCard href={`/app/programs/${encodeURIComponent(c.key)}`}>
      <div className="pk-row">
        <Pill>{c.levelLabel}</Pill>
      </div>
      <h3 className="pk-card-title">{c.name}</h3>
      {c.basedOn && <span className="pk-small">{byline(c)}</span>}
      <span className="pk-muted">{c.summary}</span>
      <PhaseBar phases={c.phases} />
      <Pills items={c.tags} />
    </PkCard>
  );
}

/**
 * The Programs tab: a compact filter row kept in the URL (so it is still set
 * when the member comes back), the member's own programs (children), then big
 * story cards under goal headings.
 */
export function ProgramBrowser({ cards, initial, children }: { cards: StoryCard[]; initial: CardFilter; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [f, setF] = useState<CardFilter>(initial);
  const groups = groupByGoal(filterCards(cards, f));

  function change(next: CardFilter) {
    setF(next);
    router.replace(`${pathname}${filterQuery(next)}`, { scroll: false });
  }

  return (
    <>
      <div className="pk-filters" role="group" aria-label="Filter programs">
        <Filter label="Goal" options={GOALS} value={f.family} onChange={(family) => change({ ...f, family })} />
        <Filter label="Days a week" options={DAYS} value={f.days} onChange={(days) => change({ ...f, days })} />
        <Filter label="Length" options={LENGTHS} value={f.length} onChange={(length) => change({ ...f, length })} />
      </div>
      {children}
      {groups.length === 0 ? (
        <PkCard>
          <span className="pk-muted">No programs match. Try fewer filters.</span>
        </PkCard>
      ) : (
        groups.map((g) => (
          <PkSection key={g.family} label={g.label}>
            {g.cards.map((c) => (
              <ProgramStoryCard key={c.key} c={c} />
            ))}
          </PkSection>
        ))
      )}
    </>
  );
}
