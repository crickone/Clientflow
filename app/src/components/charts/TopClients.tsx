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
import { ChartEmpty } from "./ChartEmpty";
import { Trophy } from "lucide-react";

interface Row {
  name: string;
  total: number;
}

export function TopClients({ data }: { data: Row[] }) {
  if (data.length === 0) {
    return <ChartEmpty height={260} title="No spending in this period" body="Your top-spending clients show here once payments are recorded." icon={<Trophy size={18} />} />;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(260, data.length * 28)}>
      <BarChart layout="vertical" data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${v}`} />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
          width={140}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: "var(--bg)",
            border: "1px solid var(--hairline)",
            borderRadius: 10,
            fontSize: 12,
          }}
          formatter={(v) => [`€${Number(v).toFixed(2)}`, "Spend"]}
        />
        <Bar dataKey="total" fill="var(--text-primary)" radius={[0, 4, 4, 0]} barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}
