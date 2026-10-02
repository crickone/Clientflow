"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const FALLBACK = ["var(--accent)", "var(--text-secondary)", "var(--text-tertiary)", "var(--hairline)"];

export function DonutView({
  data,
  height = 160,
  empty,
}: {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  empty: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{empty}</div>;
  }
  const colour = (i: number, c?: string) => c ?? FALLBACK[i % FALLBACK.length];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ width: height, height, minWidth: 0 }}>
        <ResponsiveContainer width="99%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="60%" outerRadius="95%" stroke="none">
              {data.map((d, i) => (
                <Cell key={d.label} fill={colour(i, d.color)} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ background: "var(--bg)", border: "1px solid var(--hairline)", borderRadius: 10, fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 140 }}>
        {data.map((d, i) => (
          <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: colour(i, d.color), flexShrink: 0 }} />
            <span style={{ color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{d.value}</span>
            <span style={{ color: "var(--text-tertiary)", width: 44, textAlign: "right" }}>{Math.round((d.value / total) * 1000) / 10}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
