"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { setBodyAction } from "@/app/app/actions";

/**
 * Type in the numbers a goal needs when there is no InBody scan: weight,
 * height, age, sex, and body fat if they know it. Saved on the client's
 * record; a later scan takes over automatically.
 */
export function BodyForm({ initial, onDone }: { initial: { weightKg: string; heightCm: string; age: string; sex: string; pbf: string }; onDone?: () => void }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await setBodyAction(v);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  return (
    <form className="bf" onSubmit={submit}>
      <div className="bf-grid">
        <label className="bf-field">
          <span>Weight</span>
          <div className="bf-unit">
            <input className="ml-input" inputMode="decimal" value={v.weightKg} onChange={set("weightKg")} placeholder="82" required />
            <b>kg</b>
          </div>
        </label>
        <label className="bf-field">
          <span>Height</span>
          <div className="bf-unit">
            <input className="ml-input" inputMode="numeric" value={v.heightCm} onChange={set("heightCm")} placeholder="180" required />
            <b>cm</b>
          </div>
        </label>
        <label className="bf-field">
          <span>Age</span>
          <input className="ml-input" inputMode="numeric" value={v.age} onChange={set("age")} placeholder="30" required />
        </label>
        <label className="bf-field">
          <span>Body fat, if you know it</span>
          <div className="bf-unit">
            <input className="ml-input" inputMode="decimal" value={v.pbf} onChange={set("pbf")} placeholder="optional" />
            <b>%</b>
          </div>
        </label>
      </div>
      <div className="bf-field">
        <span>Sex</span>
        <div className="gl-activity" role="radiogroup" aria-label="Sex">
          {(["male", "female"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={v.sex === s} className="gl-act" onClick={() => setV({ ...v, sex: s })}>
              <b>{s === "male" ? "Male" : "Female"}</b>
            </button>
          ))}
        </div>
        <span className="bf-why">The resting-calorie formula needs it. With a body fat figure it isn&rsquo;t used.</span>
      </div>
      {error && (
        <div className="gl-error" role="alert">
          {error}
        </div>
      )}
      <button type="submit" className="ml-camera" disabled={pending}>
        {pending ? <Loader2 size={18} className="spin" /> : null} {pending ? "Saving" : "See my options"}
      </button>
    </form>
  );
}
