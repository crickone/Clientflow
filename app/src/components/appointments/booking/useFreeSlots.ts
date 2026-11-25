"use client";

import { useEffect, useState } from "react";

/** GET /api/appointments/free-slots */
export interface FreeSlotsDay {
  ok: true;
  date: string;
  closed: boolean;
  open: string;
  close: string;
  stepMinutes: number;
  slots: { time: string; free: boolean; reason?: string }[];
}

export type FreeSlotsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; day: FreeSlotsDay }
  | { status: "error" };

/** The day's start times for this length and these treatments. Idle until both are known. */
export function useFreeSlots(date: string, durationMinutes: number, therapyIds: number[]): FreeSlotsState {
  const [state, setState] = useState<FreeSlotsState>({ status: "idle" });
  const ids = therapyIds.join(",");

  useEffect(() => {
    if (!date || !(durationMinutes > 0) || !ids) {
      setState({ status: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: "loading" });
    const qs = new URLSearchParams({ date, duration: String(durationMinutes), therapyIds: ids });
    fetch(`/api/appointments/free-slots?${qs.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: FreeSlotsDay | { ok: false }) => setState(d.ok ? { status: "ready", day: d } : { status: "error" }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ status: "error" });
      });
    return () => ctrl.abort();
  }, [date, durationMinutes, ids]);

  return state;
}
