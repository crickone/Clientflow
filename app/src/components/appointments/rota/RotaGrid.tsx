"use client";

import { Fragment } from "react";

import { shiftLabel, shortTime, type RotaDay, type RotaPerson, type ShiftRow } from "@/lib/scheduling/rotaModel";

export interface RotaCellHandlers {
  onAdd: (person: RotaPerson, day: RotaDay) => void;
  onEdit: (person: RotaPerson, day: RotaDay, shift: ShiftRow) => void;
}

interface Props extends RotaCellHandlers {
  days: RotaDay[];
  people: RotaPerson[];
}

export function shiftsOn(person: RotaPerson, date: string): ShiftRow[] {
  return person.shifts.filter((s) => s.date === date);
}

/** One person's shifts on one day as buttons, then "+ Add". Shared by the grid and the phone cards. */
export function PersonDayShifts({ person, day, onAdd, onEdit }: RotaCellHandlers & { person: RotaPerson; day: RotaDay }) {
  return (
    <>
      {shiftsOn(person, day.date).map((s) => {
        const label = shiftLabel(s.start, s.end);
        return (
          <button
            key={s.id}
            type="button"
            className="rv-shift"
            data-tone={person.tone}
            aria-label={`Edit ${person.name}'s shift on ${day.label}, ${label}`}
            onClick={() => onEdit(person, day, s)}
          >
            {label}
          </button>
        );
      })}
      <button type="button" className="rv-add" aria-label={`Add a shift for ${person.name} on ${day.label}`} onClick={() => onAdd(person, day)}>
        + Add
      </button>
    </>
  );
}

/** The week on a wide screen: a row per person, a column per day, and who is on underneath. */
export function RotaGrid({ days, people, onAdd, onEdit }: Props) {
  return (
    <>
      <div className="rv-grid">
        <div className="rv-hd" />
        {days.map((d) => (
          <div key={d.date} className={`rv-hd${d.closed ? " is-closed" : ""}`}>
            <b>{d.label}</b>
            {d.closed || !d.open || !d.close ? "Closed" : `Open ${shortTime(d.open)}–${shortTime(d.close)}`}
          </div>
        ))}

        {people.map((p) => (
          <Fragment key={p.id}>
            <div className="rv-who">
              <span className="rv-av" aria-hidden>
                {p.initials}
              </span>
              <div className="rv-who-name">
                {p.name}
                <small>{p.hours}</small>
              </div>
            </div>
            {days.map((d) => (
              <div key={d.date} className={`rv-cell${d.closed ? " is-closed" : ""}`}>
                {!d.closed && <PersonDayShifts person={p} day={d} onAdd={onAdd} onEdit={onEdit} />}
              </div>
            ))}
          </Fragment>
        ))}

        <div className="rv-foot">
          <b>On shift</b>how many are in
        </div>
        {days.map((d) => (
          <div key={d.date} className="rv-cov">
            {!d.closed && (
              <>
                <div className="rv-bar" aria-hidden>
                  {d.runs.map((r) => (
                    <i key={r.startMin} style={{ flexGrow: r.endMin - r.startMin }} data-n={Math.min(r.count, 2)} />
                  ))}
                </div>
                <span>
                  {d.text.map((t, i) => (
                    <Fragment key={i}>
                      {i > 0 && <br />}
                      {t}
                    </Fragment>
                  ))}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="rv-legend">
        <span>
          <i className="rv-swatch is-two" aria-hidden />
          Two on: a massage and the machines together
        </span>
        <span>
          <i className="rv-swatch is-one" aria-hidden />
          One on: a massage or the machines
        </span>
        <span>
          <i className="rv-swatch" aria-hidden />
          Nobody on: no bookings
        </span>
      </div>
    </>
  );
}
