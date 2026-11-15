// app/src/components/clientapp/programs/LiftSwitch.tsx
"use client";

import { useState, type ReactNode } from "react";

/**
 * A segmented control over per-lift panels. Every panel is rendered by the
 * server; this only toggles which one is not `hidden`. With one lift there is
 * nothing to switch, so it shows the panel alone.
 */
export function LiftSwitch({ lifts, children }: { lifts: { lift: string; label: string }[]; children: ReactNode[] }) {
  const [active, setActive] = useState(0);
  if (lifts.length < 2) return <>{children}</>;
  return (
    <>
      <div className="pk-switch" role="group" aria-label="Lift">
        {lifts.map((l, i) => (
          <button key={l.lift} type="button" className="pk-switch-btn" aria-pressed={i === active} onClick={() => setActive(i)}>
            {l.label}
          </button>
        ))}
      </div>
      {children.map((panel, i) => (
        <div key={lifts[i]?.lift ?? i} hidden={i !== active}>
          {panel}
        </div>
      ))}
    </>
  );
}
