"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Lazy-loaded Recharts body for Monthly Returns (parent owns the card chrome). */
export function MonthlyReturnsPlot({ data }: { data: { month: string; percent: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
        />
        <Tooltip
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--popover-foreground)",
          }}
          formatter={(value) => [`${Number(value).toFixed(2)}%`, "Return"]}
        />
        <Bar dataKey="percent" radius={[4, 4, 4, 4]} maxBarSize={36}>
          {data.map((d) => (
            <Cell key={d.month} fill={d.percent >= 0 ? "var(--success)" : "var(--danger)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
