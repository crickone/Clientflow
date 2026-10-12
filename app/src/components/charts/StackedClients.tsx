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
import { ChartEmpty } from "./ChartEmpty";
import { Users } from "lucide-react";

interface Bucket {
  month: string;
  newClients: number;
  returning: number;
}

export function StackedClients({ data }: { data: Bucket[] }) {
  if (data.length === 0) {
    return <ChartEmpty height={260} title="No client visits in this period" body="New and returning clients show here once sessions are logged." icon={<Users size={18} />} />;
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
