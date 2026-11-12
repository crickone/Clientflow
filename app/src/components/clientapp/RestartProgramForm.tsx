// app/src/components/clientapp/RestartProgramForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { restartProgramAction } from "@/app/app/programs/actions";
import type { LiftKey, WeightUnit } from "@/lib/programs/types";
import { kgToUnit } from "@/lib/programs/units";

/** New maxes, prefilled from the test day, to run the block again. */
export function RestartProgramForm({ unit, lifts }: { unit: WeightUnit; lifts: { lift: LiftKey; label: string; suggestionKg: number | null }[] }) {
  const router = useRouter();
  const [values, setValues] = useState<string[]>(lifts.map((l) => (l.suggestionKg ? String(kgToUnit(l.suggestionKg, unit)) : "")));
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const maxes = lifts.map((l, i) => ({ lift: l.lift, kind: "one_rm" as const, weight: Number(values[i].replace(",", ".")) || null, reps: null }));
      const r = await restartProgramAction({ maxes });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Started again from your new max");
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {lifts.map((l, i) => (
        <label key={l.lift} style={{ display: "grid", gap: 6 }}>
          <span className="td-label">{l.label} max</span>
          <input
            className="pk-input"
            inputMode="decimal"
            aria-label={`New ${l.label.toLowerCase()} max in ${unit}`}
            placeholder={`Max in ${unit}`}
            value={values[i]}
            onChange={(e) => setValues((xs) => xs.map((x, k) => (k === i ? e.target.value : x)))}
          />
        </label>
      ))}
      <Button onClick={submit} loading={pending} style={{ width: "100%" }}>
        Start again
      </Button>
    </div>
  );
}
