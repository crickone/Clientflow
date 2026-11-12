// app/src/components/clientapp/OwnMaxForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { setOwnMaxAction } from "@/app/app/programs/actions";
import { LIFT_LABEL, type LiftKey, type WeightUnit } from "@/lib/programs/types";

/** Set a max on the member's own program: its percentages use it from the next session. */
export function OwnMaxForm({ unit, lifts }: { unit: WeightUnit; lifts: LiftKey[] }) {
  const router = useRouter();
  const [lift, setLift] = useState<LiftKey>(lifts[0]);
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  if (lifts.length === 0) return null;

  function save() {
    start(async () => {
      const weight = Number(value.replace(",", ".")) || null;
      const r = await setOwnMaxAction({ max: { lift, kind: "one_rm", weight, reps: null } });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Max saved. Your percentages use it from your next session.");
      setValue("");
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="td-label">Change a max</div>
      <div className="pk-pair">
        {lifts.length > 1 ? (
          <select className="pk-input" aria-label="Lift" value={lift} onChange={(e) => setLift(e.target.value as LiftKey)}>
            {lifts.map((l) => (
              <option key={l} value={l}>
                {LIFT_LABEL[l]}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ alignSelf: "center", fontSize: 13.5, color: "var(--text-secondary)" }}>{LIFT_LABEL[lift]}</span>
        )}
        <input className="pk-input" inputMode="decimal" aria-label={`New ${LIFT_LABEL[lift].toLowerCase()} max in ${unit}`} placeholder={`Max in ${unit}`} value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <Button variant="secondary" onClick={save} loading={pending} disabled={!value.trim()} style={{ minHeight: 44 }}>
        Save max
      </Button>
    </div>
  );
}
