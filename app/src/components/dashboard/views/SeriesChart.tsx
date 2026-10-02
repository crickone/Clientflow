"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Props {
  data: Record<string, string | number>[];
  xKey: string;
  series: { key: string; label: string; color?: string; dashed?: boolean }[];
  kind?: "line" | "bar";
  stacked?: boolean;
  height?: number;
}

const FALLBACK = ["var(--accent)", "var(--text-tertiary)"];

export function SeriesChart({ data, xKey, series, kind = "line", stacked, height = 220 }: Props) {
  const colour = (i: number, c?: string) => c ?? FALLBACK[i % FALLBACK.length];
  // Whole-number ticks flatten small values (euro amounts under a few euro);
  // allow decimals whenever the largest value is small.
  const maxValue = Math.max(0, ...data.flatMap((row) => series.map((s) => Number(row[s.key]) || 0)));
  const decimals = maxValue < 5;
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" />
      <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} minTickGap={16} />
      <YAxis tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} width={40} allowDecimals={decimals} />
      <Tooltip
        cursor={kind === "bar" ? { fill: "var(--text-tertiary)", fillOpacity: 0.2 } : undefined}
        contentStyle={{ background: "var(--bg)", border: "1px solid var(--hairline)", borderRadius: 10, fontSize: 12 }}
      />
    </>
  );
  return (
    <div style={{ width: "100%", height, minWidth: 0 }}>
      <ResponsiveContainer width="99%" height="100%">
        {kind === "bar" ? (
          <BarChart data={data} margin={{ top: 8, left: 0, right: 8, bottom: 0 }}>
            {common}
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={colour(i, s.color)} stackId={stacked ? "a" : undefined} radius={stacked ? undefined : [4, 4, 0, 0]} />
            ))}
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, left: 0, right: 8, bottom: 0 }}>
            {common}
            {series.map((s, i) => (
              <Line key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={colour(i, s.color)} strokeWidth={2} strokeDasharray={s.dashed ? "4 4" : undefined} dot={false} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
