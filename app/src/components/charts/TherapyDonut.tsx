"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface Slice {
  name: string;
  sessions: number;
  colour: string;
}

export function TherapyDonut({ data, height = 240 }: { data: Slice[]; height?: number }) {
  if (data.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-tertiary)",
          fontSize: 14,
        }}
      >
        No sessions in range.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="sessions"
          nameKey="name"
          innerRadius={60}
          outerRadius={92}
          paddingAngle={2}
          stroke="var(--bg)"
        >
          {data.map((slice) => (
            <Cell key={slice.name} fill={slice.colour} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "var(--bg)",
            border: "1px solid var(--hairline)",
            borderRadius: 10,
            fontSize: 12,
          }}
        />
        <Legend
          verticalAlign="bottom"
          iconType="circle"
          wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
