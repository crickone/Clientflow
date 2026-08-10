"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/* ---------------------------------------------------------------------------
 * Platform analytics charts (admin, dark charcoal theme).
 * Conventions ported from the main app's RevenueLine/RevenueBars: Responsive-
 * Container, orange accent stroke + area gradient, hairline dashed grid, no
 * axis/tick lines, small mono ticks, tooltip on a dark surface.
 * ------------------------------------------------------------------------- */

const ACCENT = "#ff6a32";
const TICK = {
  fontSize: 11,
  fill: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), ui-monospace, monospace",
} as const;
const GRID = "rgba(255,255,255,0.06)";
const TOOLTIP_CONTENT = {
  background: "var(--surface-2)",
  border: "1px solid var(--hairline)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--text-primary)",
} as const;
const TOOLTIP_LABEL = { color: "var(--text-tertiary)", fontSize: 11 } as const;

const eur0 = (v: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

/** Subscription revenue collected — orange area over 12 months (cents → €). */
export function RevenueCollectedChart({
  data,
  height = 260,
}: {
  data: { label: string; eur: number }[];
  height?: number;
}) {
  return (
    <div style={{ width: "100%", height, minWidth: 0 }}>
      <ResponsiveContainer width="99%" height="100%">
        <AreaChart data={data} margin={{ top: 8, left: 0, right: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="platRevFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
          <YAxis
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={52}
            tickFormatter={(v) => eur0(Number(v))}
          />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT}
            labelStyle={TOOLTIP_LABEL}
            cursor={{ stroke: "var(--hairline)" }}
            formatter={(v) => [eur0(Number(v)), "Collected"]}
          />
          <Area
            type="monotone"
            dataKey="eur"
            stroke={ACCENT}
            strokeWidth={1.75}
            fill="url(#platRevFill)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Gyms on platform — cumulative count line over 12 months. */
export function GymGrowthChart({
  data,
  height = 260,
}: {
  data: { label: string; total: number }[];
  height?: number;
}) {
  return (
    <div style={{ width: "100%", height, minWidth: 0 }}>
      <ResponsiveContainer width="99%" height="100%">
        <LineChart data={data} margin={{ top: 8, left: 0, right: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
          <YAxis
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={36}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT}
            labelStyle={TOOLTIP_LABEL}
            cursor={{ stroke: "var(--hairline)" }}
            formatter={(v) => [String(v), "Businesses"]}
          />
          <Line
            type="monotone"
            dataKey="total"
            stroke={ACCENT}
            strokeWidth={1.75}
            dot={{ r: 2.5, fill: ACCENT, strokeWidth: 0 }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Gym status breakdown — donut + inline legend, semantic colours. */
export function StatusDonut({
  data,
  height = 220,
}: {
  data: { name: string; value: number; color: string }[];
  height?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 20 }}>
      <div style={{ width: 200, height, minWidth: 0, flexShrink: 0 }}>
        <ResponsiveContainer width="99%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={88}
              paddingAngle={2}
              stroke="var(--bg)"
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={TOOLTIP_CONTENT}
              labelStyle={TOOLTIP_LABEL}
              formatter={(v, n) => [String(v), String(n)]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10, minWidth: 0 }}>
        {data.map((d) => (
          <li key={d.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              aria-hidden
              style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }}
            />
            <span
              style={{
                fontFamily: "var(--font-mono), ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-secondary)",
              }}
            >
              {d.name}
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "var(--font-heading), system-ui, sans-serif",
                fontSize: 15,
                color: "var(--text-primary)",
              }}
            >
              {d.value}
            </span>
          </li>
        ))}
        <li
          style={{
            marginTop: 4,
            paddingTop: 10,
            borderTop: "1px solid var(--hairline)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            Total
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-heading), system-ui, sans-serif",
              fontSize: 15,
              color: "var(--text-primary)",
            }}
          >
            {total}
          </span>
        </li>
      </ul>
    </div>
  );
}
