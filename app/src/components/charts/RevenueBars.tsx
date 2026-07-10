"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Props {
  data: { day: string; total: number }[];
  height?: number;
}

export function RevenueBars({ data, height = 220 }: Props) {
  return (
    <div style={{ width: "100%", height, minWidth: 0 }}>
      <ResponsiveContainer width="99%" height="100%">
        <BarChart data={data} margin={{ top: 8, left: 0, right: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
            tickFormatter={(d) => d.slice(8)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
            axisLine={false}
            tickLine={false}
            width={48}
            tickFormatter={(v) => `€${v}`}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            contentStyle={{
              background: "var(--bg)",
              border: "1px solid var(--hairline)",
              borderRadius: 10,
              fontSize: 12,
            }}
            formatter={(v) => [`€${Number(v).toFixed(2)}`, "Revenue"]}
          />
          <Bar dataKey="total" fill="var(--text-primary)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
