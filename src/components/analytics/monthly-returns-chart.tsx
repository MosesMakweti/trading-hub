"use client";

import dynamic from "next/dynamic";

import { ChartSkeleton } from "./chart-skeleton";

const MonthlyReturnsPlot = dynamic(
  () => import("./charts-lazy-bundle").then((m) => m.MonthlyReturnsPlot),
  { ssr: false, loading: () => <ChartSkeleton height={220} /> },
);

export function MonthlyReturnsChart({ data }: { data: { month: string; percent: number }[] }) {
  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <h3 className="text-sm font-medium text-muted-foreground">Monthly Returns</h3>
      {data.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No closed trades in this range yet.
        </p>
      ) : (
        <MonthlyReturnsPlot data={data} />
      )}
    </div>
  );
}
