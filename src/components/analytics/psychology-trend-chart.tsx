"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TrendPoint } from "@/domain/psychology/analytics";

export function PsychologyTrendChart({
  byWeek,
  byMonth,
}: {
  byWeek: TrendPoint[];
  byMonth: TrendPoint[];
}) {
  const [mode, setMode] = useState<"week" | "month">("month");
  const data = (mode === "month" ? byMonth : byWeek).map((p) => ({
    key: p.key,
    percent: p.averagePercent,
  }));

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Psychology Trend</h3>
        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList>
            <TabsTrigger value="week">Weekly</TabsTrigger>
            <TabsTrigger value="month">Monthly</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {data.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No completed questionnaires in this range yet.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <ReferenceArea y1={80} y2={100} fill="var(--success)" fillOpacity={0.06} />
            <ReferenceArea y1={60} y2={80} fill="var(--warning)" fillOpacity={0.06} />
            <ReferenceArea y1={0} y2={60} fill="var(--danger)" fillOpacity={0.06} />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="key"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={36}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--popover-foreground)",
              }}
              formatter={(value) => [`${Number(value).toFixed(1)}%`, "Avg discipline"]}
            />
            <Line
              type="monotone"
              dataKey="percent"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--chart-1)" }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
