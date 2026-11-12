import type { SetupView } from "@/lib/types";

/** How far through setup the business is, and where it is stuck. */
export function SetupProgress({ setup }: { setup: SetupView }) {
  const pct = setup.total === 0 ? 0 : Math.round((setup.resolved / setup.total) * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="bar" aria-label={`${pct}% of setup done`}><i style={{ width: `${pct}%` }} /></div>
      <div style={{ fontSize: 13.5 }}>
        {setup.requiredDone} of {setup.requiredTotal} required steps done
        {setup.nextTitle && <span style={{ color: "var(--text-secondary)" }}>. Next: {setup.nextTitle}</span>}
        {!setup.nextTitle && <span style={{ color: "var(--text-secondary)" }}>. All done.</span>}
      </div>
      <ul className="steps">
        {setup.steps.map((s) => (
          <li key={s.id} className={s.done ? "is-done" : s.skipped ? "is-skipped" : undefined}>
            <i aria-hidden /> {s.title}{s.optional && !s.done && !s.skipped ? <span className="step-opt"> optional</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
