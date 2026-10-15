"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Flame } from "lucide-react";

import { setHabitAction } from "@/app/app/actions";

/**
 * Today's habits as big tick boxes. Ticking saves at once and feels instant;
 * the streak and the week row come from the server on refresh.
 */
export function HabitTicks({ habits, ticked, day, streak, compact = false }: { habits: { id: number; label: string }[]; ticked: number[]; day: string; streak: number; compact?: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState<Set<number>>(new Set(ticked));
  const [, start] = useTransition();
  const done = habits.filter((h) => on.has(h.id)).length;
  const all = habits.length > 0 && done === habits.length;

  function flip(id: number) {
    const next = new Set(on);
    const nowOn = !next.has(id);
    if (nowOn) next.add(id);
    else next.delete(id);
    setOn(next);
    start(async () => {
      const r = await setHabitAction(id, day, nowOn);
      if (!r.ok) {
        setOn((s) => {
          const back = new Set(s);
          if (nowOn) back.delete(id);
          else back.add(id);
          return back;
        });
      }
      router.refresh();
    });
  }

  return (
    <div className="hb" data-compact={compact}>
      <div className="hb-top">
        <span className="hb-count">
          {done} of {habits.length} today
        </span>
        <span className="hb-streak" data-on={streak > 0 || all}>
          <Flame size={14} /> {all && streak === 0 ? 1 : streak} day{(all && streak === 0 ? 1 : streak) === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="hb-list">
        {habits.map((h) => (
          <li key={h.id}>
            <button type="button" className="hb-item" data-on={on.has(h.id)} onClick={() => flip(h.id)} aria-pressed={on.has(h.id)}>
              <span className="hb-box" aria-hidden>
                <Check size={16} strokeWidth={3} />
              </span>
              <span>{h.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
