"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function RevenueLine({ data, height = 260 }: { data: { day: string; total: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, left: 0, right: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--text-primary)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--text-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
          tickFormatter={(d: string) => d.slice(5)}
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
          contentStyle={{
            background: "var(--bg)",
            border: "1px solid var(--hairline)",
            borderRadius: 10,
            fontSize: 12,
          }}
          formatter={(v) => [`€${Number(v).toFixed(2)}`, "Revenue"]}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke="var(--text-primary)"
          strokeWidth={1.5}
          fill="url(#revFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
