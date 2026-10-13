"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";

import { searchExercisesAction, type ExerciseHit } from "@/app/app/actions";

/**
 * Bottom sheet for adding an exercise to a workout: search the gym's library,
 * pick from what the member has done lately, or add one by the typed name.
 */
export function ExercisePicker({ onClose, onPick }: { onClose: () => void; onPick: (hit: ExerciseHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ExerciseHit[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const r = await searchExercisesAction(q).catch(() => []);
      if (mine === seq.current) setHits(r);
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q]);

  const typed = q.trim();
  const exact = hits?.some((h) => h.name.toLowerCase() === typed.toLowerCase());

  return (
    <div className="wl-sheet-backdrop" onClick={onClose}>
      <div className="wl-sheet" role="dialog" aria-modal="true" aria-label="Add an exercise" onClick={(e) => e.stopPropagation()}>
        <div className="wl-sheet-head">
          <span>Add an exercise</span>
          <button type="button" className="wl-icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="wl-search">
          <Search size={16} aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search exercises" aria-label="Search exercises" enterKeyHint="search" />
        </label>
        <div className="wl-sheet-list">
          {!q && hits && hits.length > 0 && <div className="wl-sheet-label">Done lately</div>}
          {hits?.map((h) => (
            <button key={`${h.exerciseId ?? "n"}-${h.name}`} type="button" className="wl-hit" onClick={() => onPick(h)}>
              <span className="wl-hit-name">{h.name}</span>
              {h.detail && <span className="wl-hit-detail">{h.detail}</span>}
            </button>
          ))}
          {q && hits && hits.length === 0 && <div className="wl-sheet-empty">Nothing in the library called that.</div>}
          {!q && hits && hits.length === 0 && <div className="wl-sheet-empty">Type to search the gym&rsquo;s exercise library.</div>}
          {typed && !exact && (
            <button type="button" className="wl-hit wl-hit-own" onClick={() => onPick({ exerciseId: null, name: typed, detail: null })}>
              <Plus size={15} aria-hidden />
              <span className="wl-hit-name">Add &ldquo;{typed}&rdquo;</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
