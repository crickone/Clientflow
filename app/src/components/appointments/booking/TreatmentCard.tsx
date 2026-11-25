"use client";

import { useMemo, useState } from "react";

import { useVocab } from "@/components/providers/VocabProvider";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import {
  familyOf,
  filterGroups,
  lengthLabel,
  pickOption,
  priceHint,
  type TreatmentGroup,
} from "@/lib/booking/treatmentGroups";
import type { Therapy } from "@/lib/db/schema";

import s from "./booking.module.css";

interface Props {
  groups: TreatmentGroup<Therapy>[];
  therapyId: number | null;
  onPick: (therapyId: number) => void;
  /** Treatments the client has a usable prepaid session for. */
  prepaidTherapyIds: ReadonlySet<number>;
}

/** Card 2: the treatment, grouped, with one tile per treatment and a Length switch for 30/60-minute versions. */
export function TreatmentCard({ groups, therapyId, onPick, prepaidTherapyIds }: Props) {
  const vocab = useVocab();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterGroups(groups, query), [groups, query]);
  const selected = familyOf(groups, therapyId);
  // One "Other" group alone is a business the name patterns do not know: no heading.
  const headings = !(groups.length === 1 && groups[0].name === "Other");

  return (
    <Card>
      <CardLabel>{vocab.service}</CardLabel>
      <Label htmlFor="booking-treatment-search" srOnly>
        Search {vocab.services.toLowerCase()}
      </Label>
      <Input
        id="booking-treatment-search"
        placeholder={`Search ${vocab.services.toLowerCase()}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        style={{ marginBottom: 14 }}
      />

      {shown.length === 0 && <div className={s.muted}>No {vocab.services.toLowerCase()} match.</div>}

      {shown.map((group) => (
        <section key={group.name} className={s.groupSection} aria-label={headings ? group.name : undefined}>
          {headings && <div className={s.group}>{group.name}</div>}
          <div className={s.tiles}>
            {group.families.map((family) => {
              const on = selected?.key === family.key;
              const prepaid = family.options.some((o) => prepaidTherapyIds.has(o.id));
              return (
                <button
                  key={family.key}
                  type="button"
                  aria-pressed={on}
                  title={family.name}
                  className={`${s.tile} ${on ? s.tileOn : ""}`}
                  onClick={() => {
                    if (!on) onPick(pickOption(family, prepaidTherapyIds).id);
                  }}
                >
                  <span className={s.tileName}>{family.label}</span>
                  {prepaid ? <span className={s.tag}>PREPAID</span> : <span className={s.tileMeta}>{priceHint(family)}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {selected && selected.options.length > 1 && (
        <div className={s.length}>
          <span id="booking-length-label">Length</span>
          <div className={s.seg} role="group" aria-labelledby="booking-length-label">
            {selected.options.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === therapyId}
                className={`${s.segBtn} ${option.id === therapyId ? s.segBtnOn : ""}`}
                onClick={() => onPick(option.id)}
              >
                {lengthLabel(option)}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
