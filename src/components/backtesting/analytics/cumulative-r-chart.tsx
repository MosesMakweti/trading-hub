"use client";

import { EquityInstrument } from "@/components/viz/equity-instrument";
import { EmptyPlot } from "@/components/viz/chart-card";
import { fmtR } from "@/lib/analytics-format";
import type { FinalizedRCurvePoint } from "@/domain/analytics/canonical-aggregations";

/**
 * Backtesting's primary performance chart: cumulative R over finalized
 * trades in simulated-market order (x = trade sequence, so several trades on
 * one day stay distinct), with the R drawdown from the running peak in a
 * synced underwater pane. Origin (0R before the first trade) is always
 * plotted. Rendered by the shared EquityInstrument.
 */
export function CumulativeRChart({ curve }: { curve: FinalizedRCurvePoint[] }) {
  if (curve.length === 0) {
    return <EmptyPlot height={300} title="No closed trades yet" hint="The curve starts with the first finalized result." />;
  }
  const final = curve[curve.length - 1].cumulativeR;
  const maxDrawdown = Math.min(0, ...curve.map((p) => p.drawdownR));
  return (
    <figure>
      <figcaption className="sr-only">
        Cumulative R over {curve.length} closed trade{curve.length === 1 ? "" : "s"}, ending at {fmtR(final)}, with a maximum drawdown
        of {fmtR(maxDrawdown)}.
      </figcaption>
      <div aria-hidden>
        <EquityInstrument
          points={curve.map((p) => ({ x: p.dateKey, value: p.cumulativeR, stepValue: p.r }))}
          unit="r"
          xMode="sequence"
          valueLabel="Cumulative R"
          stepLabel="Trade R"
          drawdownPane
          height={280}
        />
      </div>
    </figure>
  );
}
