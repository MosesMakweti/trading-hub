import { KpiCard } from "@/components/analytics/kpi-card";
import { directionOf } from "@/components/analytics/delta-chip";

function currency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function signedCurrency(n: number) {
  return `${n >= 0 ? "+" : ""}${currency(n)}`;
}

function signedR(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

/** Every KPI's period-over-period delta, direction-corrected for metrics
 *  where a lower number is the good outcome (drawdown, avoidable discrepancy)
 *  — `DeltaChip` always renders "up" green / "down" red, so those two invert
 *  the raw diff before deriving direction. */
function delta(
  current: number | null,
  previous: number | null,
  format: (n: number) => string,
  lowerIsBetter = false,
): { value: string; direction: "up" | "down" | "flat" } | undefined {
  if (current == null || previous == null) return undefined;
  const diff = current - previous;
  const signedDiff = lowerIsBetter ? -diff : diff;
  return { value: format(diff), direction: directionOf(signedDiff) };
}

export function KpiRow({
  analytics,
  previousAnalytics,
}: {
  analytics: { trading: KpiTradingData };
  previousAnalytics: { trading: KpiTradingData };
}) {
  const t = analytics.trading;
  const p = previousAnalytics.trading;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      <KpiCard
        label="Net Performance"
        value={signedCurrency(t.netPnl)}
        tone={t.netPnl >= 0 ? "success" : "danger"}
        delta={delta(t.netPnl, p.netPnl, signedCurrency)}
        deltaCaption="vs prev. period"
        sparkBars={t.dailyPercents.map((d) => d.percent)}
      />
      <KpiCard
        label="Expectancy"
        value={t.expectancy == null ? "—" : signedR(t.expectancy)}
        tone={t.expectancy == null ? "neutral" : t.expectancy >= 0 ? "success" : "danger"}
        delta={delta(t.expectancy, p.expectancy, signedR)}
      />
      <KpiCard
        label="Profit Factor"
        value={t.profitFactor == null ? "—" : t.profitFactor.toFixed(2)}
        tone={t.profitFactor == null ? "neutral" : t.profitFactor >= 1 ? "success" : "danger"}
        delta={delta(t.profitFactor, p.profitFactor, (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`)}
      />
      <KpiCard
        label="Win Rate"
        value={t.winRate == null ? "—" : `${t.winRate.toFixed(0)}%`}
        delta={delta(t.winRate, p.winRate, (n) => `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`)}
        meter={{ value: t.winRate, reference: 50 }}
        spark={t.winRateSeries}
        sparkTone="brand"
      />
      <KpiCard
        label="Max Drawdown"
        value={`${t.maxDrawdownPercent.toFixed(1)}%`}
        tone={t.maxDrawdownPercent > 0 ? "danger" : "neutral"}
        delta={delta(t.maxDrawdownPercent, p.maxDrawdownPercent, (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`, true)}
        spark={t.drawdownCurve.some((d) => d.drawdownPercent > 0) ? t.drawdownCurve.map((d) => -d.drawdownPercent) : undefined}
        sparkTone="danger"
      />
      <KpiCard
        label="Strategy Adherence"
        value={t.ruleAdherenceAverage == null ? "—" : `${t.ruleAdherenceAverage.toFixed(0)}%`}
        delta={delta(t.ruleAdherenceAverage, p.ruleAdherenceAverage, (n) => `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`)}
        meter={{ value: t.ruleAdherenceAverage }}
      />
      <KpiCard
        label="Avoidable Discrepancy"
        value={`${t.counterfactual.summary.totalAvoidableGapR.toFixed(2)}R`}
        tone={t.counterfactual.summary.totalAvoidableGapR > 0 ? "danger" : "neutral"}
        delta={delta(
          t.counterfactual.summary.totalAvoidableGapR,
          p.counterfactual.summary.totalAvoidableGapR,
          (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`,
          true,
        )}
        spark={t.counterfactual.curve.some((c) => c.avoidableGap > 0) ? t.counterfactual.curve.map((c) => -c.avoidableGap) : undefined}
        sparkTone="danger"
      />
    </div>
  );
}

interface KpiTradingData {
  netPnl: number;
  expectancy: number | null;
  profitFactor: number | null;
  winRate: number | null;
  winRateSeries: number[];
  maxDrawdownPercent: number;
  ruleAdherenceAverage: number | null;
  dailyPercents: { dateKey: string; percent: number }[];
  drawdownCurve: { drawdownPercent: number }[];
  counterfactual: { summary: { totalAvoidableGapR: number }; curve: { avoidableGap: number }[] };
}
