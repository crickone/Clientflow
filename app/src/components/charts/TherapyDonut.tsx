"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { ChartEmpty } from "./ChartEmpty";
import { ChartPie } from "lucide-react";

interface Slice {
  name: string;
  sessions: number;
  colour: string;
}

export function TherapyDonut({ data, height = 240 }: { data: Slice[]; height?: number }) {
  if (data.length === 0) {
    return <ChartEmpty height={height} title="No sessions in this period" body="Completed sessions show here, split by what was booked." icon={<ChartPie size={18} />} />;
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
