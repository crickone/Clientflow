export function FunnelView({ steps, empty }: { steps: { label: string; value: number }[]; empty: string }) {
  const first = steps[0]?.value ?? 0;
  if (steps.length === 0 || first === 0) {
    return <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{empty}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {steps.map((s, i) => {
        const ofFirst = Math.round((s.value / first) * 1000) / 10;
        const prev = i > 0 ? steps[i - 1].value : 0;
        const conv = i > 0 && prev > 0 ? Math.round((s.value / prev) * 1000) / 10 : null;
        return (
          <div key={`${s.label}:${i}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, marginBottom: 4 }}>
              <span style={{ color: "var(--text-secondary)" }}>{s.label}</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                {s.value}
                <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}> · {ofFirst}% of first</span>
                {conv !== null && <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}> · {conv}% from previous</span>}
              </span>
            </div>
            <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, (s.value / first) * 100)}%`, height: "100%", background: "var(--accent)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
