"use client";

import dynamic from "next/dynamic";

import type {
  ConfluenceStat,
  SetupQualityBucket,
  SetupQualityTrendPoint,
} from "@/domain/performance/adherence-analytics";
import { ChartSkeleton } from "./chart-skeleton";

// Recharts bodies are lazy-loaded so this dependency stays off the analytics
// route's initial JS; the empty states below render instantly (no recharts).
const SetupQualityPlot = dynamic(
  () => import("./charts-lazy-bundle").then((m) => m.SetupQualityPlot),
  { ssr: false, loading: () => <ChartSkeleton height={200} /> },
);
const ConfluenceWinRatePlot = dynamic(
  () => import("./charts-lazy-bundle").then((m) => m.ConfluenceWinRatePlot),
  { ssr: false, loading: () => <ChartSkeleton height={200} /> },
);
const SetupQualityTrendPlot = dynamic(
  () => import("./charts-lazy-bundle").then((m) => m.SetupQualityTrendPlot),
  { ssr: false, loading: () => <ChartSkeleton height={200} /> },
);

function EmptyChart({ label }: { label: string }) {
  return <p className="py-12 text-center text-sm text-muted-foreground">{label}</p>;
}

/** Setup Quality → Win Rate: does a higher weighted setup score actually win more? */
export function SetupQualityChart({ data }: { data: SetupQualityBucket[] }) {
  if (data.length === 0) {
    return <EmptyChart label="No rated setups in this range yet." />;
  }
  return <SetupQualityPlot data={data} />;
}

/** Per-confluence win rate — horizontal bars, ranked. */
export function ConfluenceWinRateChart({ data }: { data: ConfluenceStat[] }) {
  const rows = data.filter((c) => c.winRate != null).slice(0, 8);
  if (rows.length === 0) {
    return <EmptyChart label="No decided trades with confluences yet." />;
  }
  return <ConfluenceWinRatePlot rows={rows} />;
}

/** Average setup score over time — the discipline trend. */
export function SetupQualityTrendChart({ data }: { data: SetupQualityTrendPoint[] }) {
  if (data.length < 2) {
    return <EmptyChart label="Not enough months to chart a trend yet." />;
  }
  return <SetupQualityTrendPlot data={data} />;
}
