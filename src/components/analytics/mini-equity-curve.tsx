"use client";

import dynamic from "next/dynamic";

import { ChartSkeleton } from "./chart-skeleton";

const MiniEquityCurvePlot = dynamic(
  () => import("./charts-lazy-bundle").then((m) => m.MiniEquityCurvePlot),
  { ssr: false, loading: () => <ChartSkeleton height={48} /> },
);

export function MiniEquityCurve({
  points,
  className,
}: {
  points: { balance: number }[];
  className?: string;
}) {
  if (points.length < 2) {
    return (
      <div className={className}>
        <p className="text-xs text-muted-foreground">Not enough trade history yet.</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <MiniEquityCurvePlot points={points} />
    </div>
  );
}
