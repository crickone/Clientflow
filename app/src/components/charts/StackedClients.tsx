"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Bucket {
  month: string;
  newClients: number;
  returning: number;
}

export function StackedClients({ data }: { data: Bucket[] }) {
  if (data.length === 0) {
    return (
      <div
        style={{
          height: 260,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-tertiary)",
          fontSize: 14,
        }}
      >
        No client activity in range.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} width={36} />
        <Tooltip
          contentStyle={{
            background: "var(--bg)",
            border: "1px solid var(--hairline)",
            borderRadius: 10,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} iconType="circle" />
        <Bar dataKey="newClients" stackId="a" fill="var(--text-primary)" name="New" radius={[4, 4, 0, 0]} />
        <Bar dataKey="returning" stackId="a" fill="rgba(10,10,10,0.32)" name="Returning" />
      </BarChart>
    </ResponsiveContainer>
  );
}
