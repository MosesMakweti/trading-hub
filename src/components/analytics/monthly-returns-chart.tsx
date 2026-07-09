"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function MonthlyReturnsChart({ data }: { data: { month: string; percent: number }[] }) {
  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <h3 className="text-sm font-medium text-muted-foreground">Monthly Returns</h3>
      {data.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No closed trades in this range yet.
        </p>
      ) : (
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
      )}
    </div>
  );
}
