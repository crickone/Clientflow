"use client";

import { useState } from "react";

import { useVocab } from "@/components/providers/VocabProvider";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { chipTime, clock12, fullDate, weekdayLong } from "@/lib/booking/format";
import { groupByPeriod, onGrid, type StripDay } from "@/lib/booking/slotModel";

import s from "./booking.module.css";
import { useFreeSlots } from "./useFreeSlots";
import { RotaUnfilledBanner } from "../rota/RotaUnfilledBanner";

interface Props {
  strip: StripDay[];
  date: string;
  onDate: (date: string) => void;
  startTime: string;
  onStartTime: (time: string) => void;
  durationMinutes: number;
  therapyIds: number[];
}

/** Card 3: a strip of days, then that day's start times, free or taken, for the chosen treatment and length. */
export function WhenCard({ strip, date, onDate, startTime, onStartTime, durationMinutes, therapyIds }: Props) {
  const vocab = useVocab();
  const slots = useFreeSlots(date, durationMinutes, therapyIds);
  const inStrip = strip.some((d) => d.date === date);
  const [otherDate, setOtherDate] = useState(!inStrip);
  const [otherTime, setOtherTime] = useState(Boolean(startTime) && !onGrid(startTime));

  const day = slots.status === "ready" && slots.day.date === date ? slots.day : null;
  const picked = day?.slots.find((x) => x.time === startTime) ?? null;
  const freeCount = day ? day.slots.filter((x) => x.free).length : 0;

  return (
    <Card>
      <div className={s.cardHead}>
        <CardLabel style={{ marginBottom: 0 }}>When</CardLabel>
        <button type="button" className={s.link} onClick={() => setOtherDate((v) => !v)} aria-expanded={otherDate}>
          Other date
        </button>
      </div>

      {otherDate && (
        <div className={s.inline} style={{ marginTop: 0, marginBottom: 12 }}>
          <Label htmlFor="booking-date" srOnly>
            Date
          </Label>
          <Input id="booking-date" type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} style={{ width: 200 }} />
        </div>
      )}

      <div className={s.days} role="group" aria-label="Day">
        {strip.map((d) => (
          <button
            key={d.date}
            type="button"
            disabled={d.closed}
            aria-pressed={d.date === date}
            aria-label={`${weekdayLong(d.date)} ${fullDate(d.date)}${d.closed ? ", closed" : ""}`}
            className={`${s.day} ${d.date === date ? s.dayOn : ""}`}
            onClick={() => onDate(d.date)}
          >
            <span className={s.dayName}>{d.weekday}</span>
            <span className={s.dayNum}>{d.day}</span>
          </button>
        ))}
      </div>

      {day?.rota?.unfilled && <RotaUnfilledBanner week={day.rota.week} />}

      {slots.status === "idle" && <div className={s.muted}>Pick a {vocab.service.toLowerCase()} to see the free times.</div>}
      {slots.status === "loading" && <div className={s.muted}>Finding free times.</div>}
      {slots.status === "error" && <div className={s.warn}>Could not load the free times. Type a time below.</div>}

      {day && !day.closed && (
        <div className={s.periods}>
          {groupByPeriod(day.slots).map((run) => (
            <div key={run.period}>
              <div className={s.period}>{run.period}</div>
              <div className={s.slots}>
                {run.slots.map((slot) => (
                  <button
                    key={slot.time}
                    type="button"
                    disabled={!slot.free}
                    aria-pressed={slot.time === startTime}
                    title={slot.free ? undefined : slot.reason}
                    aria-label={slot.free ? undefined : `${chipTime(slot.time)}, taken: ${slot.reason}`}
                    className={`${s.slot} ${slot.time === startTime ? s.slotOn : ""}`}
                    onClick={() => onStartTime(slot.time)}
                  >
                    {chipTime(slot.time)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {day && (
        <div className={s.hint}>
          {day.closed
            ? `${weekdayLong(date)} is closed.`
            : `Free times for a ${durationMinutes}-minute session. ${weekdayLong(date)}: open ${clock12(day.open)} to ${clock12(day.close)}.`}
          {!day.closed && freeCount === 0 ? " Nothing free for this length." : ""}
        </div>
      )}
      {picked && !picked.free && (
        <div className={s.warn}>
          {chipTime(startTime)} is taken for this length. {picked.reason}
        </div>
      )}

      <div className={s.inline}>
        {otherTime || slots.status === "error" ? (
          <>
            <Label htmlFor="booking-time" srOnly>
              Start time
            </Label>
            <Input id="booking-time" type="time" value={startTime} onChange={(e) => onStartTime(e.target.value)} style={{ width: 160 }} />
            <span className={s.muted}>Any start time. The booking is still checked when you book.</span>
          </>
        ) : (
          <button type="button" className={s.link} onClick={() => setOtherTime(true)}>
            Other time
          </button>
        )}
      </div>
    </Card>
  );
}
