"use client";

import type { RotaDay, RotaPerson } from "@/lib/scheduling/rotaModel";

import { PersonDayShifts, type RotaCellHandlers } from "./RotaGrid";

interface Props extends RotaCellHandlers {
  days: RotaDay[];
  people: RotaPerson[];
}

/** The week on a narrow screen: one card per day, a line per person. */
export function RotaCards({ days, people, onAdd, onEdit }: Props) {
  return (
    <div className="rv-cards">
      {days.map((d) => (
        <section key={d.date} className={`rv-day${d.closed ? " is-closed" : ""}`} aria-label={d.label}>
          <div className="rv-day-h">
            <b>{d.label}</b>
            <span>{d.closed ? "Closed" : d.text.join(" · ")}</span>
          </div>
          {!d.closed &&
            people.map((p) => (
              <div key={p.id} className="rv-prow">
                <span>{p.name}</span>
                <div className="rv-prow-shifts">
                  <PersonDayShifts person={p} day={d} onAdd={onAdd} onEdit={onEdit} />
                </div>
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}
