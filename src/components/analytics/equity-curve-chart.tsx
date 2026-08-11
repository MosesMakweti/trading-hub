"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EquityCurvePoint } from "@/domain/performance/rr";
import { ChartSkeleton } from "./chart-skeleton";

// Recharts lives in a lazy chunk loaded only after the card chrome paints, so it
// never sits in the route's initial JS. The skeleton reserves the plot height.
const EquityCurvePlot = dynamic(
  () => import("./charts-lazy-bundle").then((m) => m.EquityCurvePlot),
  { ssr: false, loading: () => <ChartSkeleton height={280} /> },
);

export function EquityCurveChart({ data }: { data: EquityCurvePoint[] }) {
  const [mode, setMode] = useState<"compounding" | "additive">("compounding");

  const chartData = data.map((d) => ({
    date: d.dateKey,
    value: mode === "compounding" ? d.cumulativeCompounding : d.cumulativeAdditive,
  }));

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Equity Curve</h3>
        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList>
            <TabsTrigger value="compounding">Compounding</TabsTrigger>
            <TabsTrigger value="additive">Additive</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {chartData.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No closed trades in this range yet.
        </p>
      ) : (
        <EquityCurvePlot chartData={chartData} />
      )}
    </div>
  );
}
