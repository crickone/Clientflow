"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  Appointment,
  BlockOut,
  Client,
  Therapy,
} from "@/lib/db/schema";
import type { OpeningHour } from "@/lib/settings";
import { useVocab } from "@/components/providers/VocabProvider";

interface Props {
  weekStart: Date;
  appointments: Appointment[];
  clients: Map<number, Client>;
  therapies: Map<number, Therapy>;
  /** Active therapies in display order — drives the colour legend + day dots. */
  therapyList: Therapy[];
  openingHours: OpeningHour[];
  blockOuts: BlockOut[];
  windowOpen: string;
  windowClose: string;
  slotMinutes: number;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_PX = 60; // 1px per minute — roomy, simple math
const TIME_COL = 52;
const DAY_MIN = 132;
const CARD_GAP = 2;

function hmToMin(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortTherapyLabel(name: string) {
  return name.replace(/\s*Therapy$/i, "").trim();
}

function fmtTime(hm: string) {
  // "09:00" -> "9:00"; keep minutes
  const [h, m] = hm.split(":");
  return `${Number(h)}:${m}`;
}

/** A single appointment's computed box within its day column. */
interface Positioned {
  appt: Appointment;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
}

/**
 * Lay out a day's appointments. Appointments that overlap in time are packed
 * into side-by-side sub-columns (max width when alone, splitting evenly when
 * concurrent). Handles staggered overlaps, not just identical start slots.
 */
function packDay(
  appts: Appointment[],
  windowStart: number,
  pxPerMin: number,
): Positioned[] {
  const items = appts
    .map((a) => ({ a, s: hmToMin(a.startTime), e: hmToMin(a.endTime) }))
    .sort((x, y) => x.s - y.s || x.e - y.e);

  const colEnds: number[] = []; // end-min of the last appt in each open sub-column
  const colOf: number[] = [];
  const clusterOf: number[] = [];
  let cluster = -1;
  let clusterEnd = -1;

  items.forEach((it, i) => {
    if (it.s >= clusterEnd) {
      cluster += 1; // no overlap with the running cluster → start a fresh one
      colEnds.length = 0;
    }
    let c = colEnds.findIndex((end) => end <= it.s);
    if (c === -1) {
      c = colEnds.length;
      colEnds.push(it.e);
    } else {
      colEnds[c] = it.e;
    }
    colOf[i] = c;
    clusterOf[i] = cluster;
    clusterEnd = Math.max(clusterEnd, it.e);
  });

  const clusterCols: Record<number, number> = {};
  items.forEach((_, i) => {
    clusterCols[clusterOf[i]] = Math.max(
      clusterCols[clusterOf[i]] ?? 0,
      colOf[i] + 1,
    );
  });

  return items.map((it, i) => {
    const n = clusterCols[clusterOf[i]];
    const widthPct = 100 / n;
    return {
      appt: it.a,
      top: (it.s - windowStart) * pxPerMin,
      height: Math.max(22, (it.e - it.s) * pxPerMin - CARD_GAP),
      leftPct: colOf[i] * widthPct,
      widthPct,
    };
  });
}

interface Block {
  s: number;
  e: number;
  reason: string;
}

/** Closed/outside-hours/blockout intervals for a day, clamped to the window. */
function dayBlocks(
  d: Date,
  openingHours: OpeningHour[],
  blockOuts: BlockOut[],
  startMin: number,
  endMin: number,
): { closed: boolean; intervals: Block[] } {
  const dow = d.getDay();
  const dateIso = isoOf(d);
  const oh = openingHours.find((o) => o.dow === dow);
  if (!oh || oh.closed) return { closed: true, intervals: [] };

  const openMin = oh.open ? hmToMin(oh.open) : startMin;
  const closeMin = oh.close ? hmToMin(oh.close) : endMin;
  const intervals: Block[] = [];
  if (openMin > startMin) intervals.push({ s: startMin, e: openMin, reason: "" });
  if (closeMin < endMin) intervals.push({ s: closeMin, e: endMin, reason: "" });

  for (const b of blockOuts) {
    let matches = false;
    if (b.type === "recurring") {
      const days = b.daysOfWeek
        ? b.daysOfWeek
            .split(",")
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => Number.isInteger(n))
        : b.dayOfWeek != null
          ? [b.dayOfWeek]
          : [];
      matches = days.includes(dow);
    } else {
      const bStart = b.date ?? "";
      const bEnd = b.endDate ?? bStart;
      matches = dateIso >= bStart && dateIso <= bEnd;
    }
    if (!matches) continue;
    const s = Math.max(hmToMin(b.startTime), startMin);
    const e = Math.min(hmToMin(b.endTime), endMin);
    if (s < e) intervals.push({ s, e, reason: b.reason });
  }

  return { closed: false, intervals };
}

const HATCH =
  "repeating-linear-gradient(135deg, rgba(0,0,0,0.05) 0 6px, transparent 6px 12px)";

export function WeekCalendar({
  weekStart,
  appointments,
  clients,
  therapies,
  therapyList,
  openingHours,
  blockOuts,
  windowOpen,
  windowClose,
}: Props) {
  const vocab = useVocab();
  const startMin = hmToMin(windowOpen);
  const endMin = hmToMin(windowClose);
  const pxPerMin = HOUR_PX / 60;
  const bodyHeight = (endMin - startMin) * pxPerMin;
  const todayIso = isoOf(new Date());

  // Now-line: client-only so SSR/CSR stay in sync; ticks each minute.
  const [nowMin, setNowMin] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = Math.floor(startMin / 60); h * 60 < endMin; h += 1) out.push(h);
    return out;
  }, [startMin, endMin]);

  const days = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        return d;
      }),
    [weekStart],
  );

  const gridCols = `${TIME_COL}px repeat(6, minmax(${DAY_MIN}px, 1fr))`;

  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
      }}
    >
      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 18,
          alignItems: "center",
          padding: "10px 14px",
          borderBottom: "1px solid var(--hairline)",
          flexWrap: "wrap",
        }}
      >
        {therapyList.map((t) => (
          <span
            key={t.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--text-secondary)",
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: t.colourHex,
              }}
            />
            {shortTherapyLabel(t.name)}
          </span>
        ))}
        <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: "auto" }}>
          dots under each date = therapies booked that day
        </span>
      </div>

      <div style={{ overflow: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridCols,
            minWidth: TIME_COL + 6 * DAY_MIN,
          }}
        >
          {/* HEADER ROW */}
          <div
            style={{
              background: "var(--surface-1)",
              borderRight: "1px solid var(--hairline)",
              borderBottom: "1px solid var(--hairline)",
            }}
          />
          {days.map((d, i) => {
            const isToday = isoOf(d) === todayIso;
            const dateIso = isoOf(d);
            return (
              <div
                key={`h-${i}`}
                style={{
                  borderLeft: "1px solid var(--hairline)",
                  borderBottom: "1px solid var(--hairline)",
                  background: isToday ? "var(--accent-soft)" : "transparent",
                  padding: "10px 4px 8px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--text-tertiary)",
                    fontWeight: 500,
                  }}
                >
                  {DAY_NAMES[i]}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 20,
                    marginTop: 1,
                    color: isToday ? "var(--accent)" : "var(--text-secondary)",
                  }}
                >
                  {d.getDate()}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    justifyContent: "center",
                    marginTop: 5,
                  }}
                >
                  {therapyList.map((t) => {
                    const booked = appointments.some((a) => {
                      if (a.date !== dateIso) return false;
                      const tids: number[] = JSON.parse(a.therapyIds || "[]");
                      return tids.includes(t.id);
                    });
                    return (
                      <span
                        key={t.id}
                        title={`${shortTherapyLabel(t.name)}: ${booked ? "booked" : "free"}`}
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 2,
                          background: booked ? t.colourHex : "var(--hairline)",
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* BODY ROW */}
          {/* time gutter */}
          <div
            style={{
              position: "relative",
              height: bodyHeight,
              background: "var(--surface-1)",
              borderRight: "1px solid var(--hairline)",
            }}
          >
            {hours.map((h) => {
              const top = (h * 60 - startMin) * pxPerMin;
              if (top < 0) return null;
              return (
                <div
                  key={`t-${h}`}
                  style={{
                    position: "absolute",
                    top: top - 6,
                    right: 6,
                    fontSize: 10,
                    color: "var(--text-tertiary)",
                    letterSpacing: "0.03em",
                  }}
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              );
            })}
          </div>

          {/* day columns */}
          {days.map((d, di) => {
            const dateIso = isoOf(d);
            const isToday = dateIso === todayIso;
            const { closed, intervals } = dayBlocks(
              d,
              openingHours,
              blockOuts,
              startMin,
              endMin,
            );
            const dayAppts = appointments.filter((a) => a.date === dateIso);
            const boxes = packDay(dayAppts, startMin, pxPerMin);

            return (
              <div
                key={`d-${di}`}
                style={{
                  position: "relative",
                  height: bodyHeight,
                  borderLeft: "1px solid var(--hairline)",
                  background: isToday ? "rgba(239,90,36,0.03)" : undefined,
                }}
              >
                {/* hour bands (zebra + gridlines) */}
                {hours.map((h, hi) => {
                  const bt = Math.max(h * 60, startMin);
                  const bb = Math.min((h + 1) * 60, endMin);
                  return (
                    <div
                      key={`b-${hi}`}
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: (bt - startMin) * pxPerMin,
                        height: (bb - bt) * pxPerMin,
                        background:
                          hi % 2 === 1 ? "rgba(0,0,0,0.02)" : "transparent",
                        borderTop:
                          h * 60 >= startMin
                            ? "1px solid var(--hairline)"
                            : "none",
                      }}
                    />
                  );
                })}

                {/* closed day */}
                {closed && (
                  <div
                    title="Closed"
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: HATCH,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    Closed
                  </div>
                )}

                {/* blocked intervals (outside hours / blockouts) */}
                {!closed &&
                  intervals.map((b, bi) => (
                    <div
                      key={`bk-${bi}`}
                      title={b.reason || "Outside opening hours"}
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: (b.s - startMin) * pxPerMin,
                        height: (b.e - b.s) * pxPerMin,
                        background: HATCH,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "var(--text-tertiary)",
                        textAlign: "center",
                        pointerEvents: "none",
                        overflow: "hidden",
                      }}
                    >
                      {b.reason}
                    </div>
                  ))}

                {/* now line */}
                {isToday &&
                  nowMin != null &&
                  nowMin >= startMin &&
                  nowMin <= endMin && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: (nowMin - startMin) * pxPerMin,
                        height: 2,
                        background: "var(--accent)",
                        zIndex: 6,
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          left: -3,
                          top: -3,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "var(--accent)",
                        }}
                      />
                    </div>
                  )}

                {/* appointments */}
                {boxes.map((box) => {
                  const a = box.appt;
                  const tids: number[] = JSON.parse(a.therapyIds || "[]");
                  const t = tids.length ? therapies.get(tids[0]) : undefined;
                  const colour = t?.colourHex ?? "#6b7280";
                  const client = clients.get(a.clientId);
                  const fullName = client
                    ? `${client.firstName} ${client.lastName}`.trim()
                    : vocab.member;
                  const label = t ? shortTherapyLabel(t.name) : "";
                  return (
                    <Link
                      key={a.id}
                      href={`/appointments/${a.id}`}
                      title={`${fullName} · ${label} · ${a.startTime}–${a.endTime}`}
                      style={{
                        position: "absolute",
                        top: box.top + 1,
                        height: box.height,
                        left: `calc(${box.leftPct}% + 2px)`,
                        width: `calc(${box.widthPct}% - 4px)`,
                        background: colour,
                        borderRadius: "var(--radius)",
                        padding: "4px 6px",
                        color: "#fff",
                        overflow: "hidden",
                        zIndex: 3,
                        display: "flex",
                        flexDirection: "column",
                        gap: 1,
                        textDecoration: "none",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 11,
                          lineHeight: 1.15,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {fullName}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          lineHeight: 1.1,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          opacity: 0.9,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {label ? `${label} · ` : ""}
                        {fmtTime(a.startTime)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
