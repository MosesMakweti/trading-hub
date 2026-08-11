"use client";

import dynamic from "next/dynamic";

import type { DiscrepancyCurvePoint } from "@/domain/analytics/discrepancy-model";
import { ChartSkeleton } from "./chart-skeleton";

const DiscrepancyGapPlot = dynamic(
  () => import("./charts-lazy-bundle").then((m) => m.DiscrepancyGapPlot),
  { ssr: false, loading: () => <ChartSkeleton height={216} /> },
);

/**
 * Expected Statistical vs Actual cumulative R. The shaded band between the lines is
 * PERFORMANCE VARIANCE (mostly normal strategy variance) — NOT execution error. The
 * avoidable portion is surfaced separately as a metric, never as the whole band.
 * The Recharts body is lazy-loaded to keep it off the route's initial JS.
 */
export function DiscrepancyGapChart({
  curve,
  height = 216,
}: {
  curve: DiscrepancyCurvePoint[];
  height?: number;
}) {
  if (curve.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No benchmarked trades yet — a strategy needs a sufficient sample (or a backtested expectancy) to
        draw its statistical benchmark.
      </p>
    );
  }

  return <DiscrepancyGapPlot curve={curve} height={height} />;
}
