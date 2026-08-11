"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TrendPoint } from "@/domain/psychology/analytics";
import { ChartSkeleton } from "./chart-skeleton";

const PsychologyTrendPlot = dynamic(
  () => import("./charts-lazy-bundle").then((m) => m.PsychologyTrendPlot),
  { ssr: false, loading: () => <ChartSkeleton height={240} /> },
);

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
        <PsychologyTrendPlot data={data} />
      )}
    </div>
  );
}
