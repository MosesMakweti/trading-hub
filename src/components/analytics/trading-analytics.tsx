import { KpiCard } from "@/components/analytics/kpi-card";
import { EquityCurveChart } from "@/components/analytics/equity-curve-chart";
import { MonthlyReturnsChart } from "@/components/analytics/monthly-returns-chart";
import { BestAssetTable } from "@/components/analytics/best-asset-table";
import { AdherenceAnalytics } from "@/components/analytics/adherence-analytics";
import { DiscrepancyAnalytics } from "@/components/analytics/discrepancy-analytics";
import { Heatmap, pnlHeatColor } from "@/components/analytics/heatmap";
import type { getAnalyticsData } from "@/server/services/analytics.service";

type TradingData = Awaited<ReturnType<typeof getAnalyticsData>>["trading"];

function fmtPercent(v: number | null) {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

function fmtRR(v: number | null) {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;
}

export function TradingAnalytics({ data }: { data: TradingData }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard
          label="Win Rate"
          value={fmtPercent(data.winRate)}
          count={data.winRate == null ? undefined : { value: data.winRate, decimals: 1, suffix: "%" }}
          spark={data.winRateSeries}
          sparkTone="brand"
        />
        <KpiCard label="Average RR" value={fmtRR(data.averageRR)} />
        <KpiCard label="Rule Adherence" value={fmtPercent(data.ruleAdherenceAverage)} />
        <KpiCard
          label="Profit Factor"
          value={data.profitFactor == null ? "—" : data.profitFactor.toFixed(2)}
        />
        <KpiCard label="Expectancy" value={fmtRR(data.expectancy)} />
        <KpiCard
          label="Total Trades"
          value={String(data.totalTrades)}
          sublabel={`${data.winningTrades}W / ${data.losingTrades}L`}
        />
        <KpiCard label="Avg Trades / Day" value={data.averageTradesPerDay.toFixed(2)} />
        <KpiCard
          label="Most Traded Asset"
          value={data.mostTradedAsset?.assetSymbol ?? "—"}
          sublabel={data.mostTradedAsset ? `${data.mostTradedAsset.count} trades` : undefined}
        />
        <KpiCard label="Average Winner" value={fmtRR(data.averageWinner)} tone="success" />
        <KpiCard label="Average Loser" value={fmtRR(data.averageLoser)} tone="danger" />
        <KpiCard label="Longest Win Streak" value={String(data.longestWinStreak)} />
        <KpiCard label="Longest Loss Streak" value={String(data.longestLossStreak)} />
      </div>

      <EquityCurveChart data={data.equityCurve} />
      <MonthlyReturnsChart data={data.monthlyReturns} />

      <DiscrepancyAnalytics
        curve={data.discrepancy.curve}
        summary={data.discrepancy.summary}
        causes={data.discrepancy.causes}
        avgStrategyAdherence={data.adherence.avgTradeQuality}
        avgRuleAdherence={data.ruleAdherenceAverage}
      />

      <AdherenceAnalytics data={data.adherence} />

      <div className="glass space-y-3 rounded-2xl p-4">
        <h3 className="text-sm font-medium text-muted-foreground">Best Performing Asset</h3>
        <BestAssetTable stats={data.statsByAsset} />
      </div>

      <div className="glass space-y-3 rounded-2xl p-4">
        <h3 className="text-sm font-medium text-muted-foreground">Performance Heatmap</h3>
        <Heatmap
          points={data.dailyPercents.map((d) => ({
            dateKey: d.dateKey,
            value: d.percent,
            label: `${d.dateKey}: ${d.percent >= 0 ? "+" : ""}${d.percent.toFixed(2)}%`,
          }))}
          getColor={pnlHeatColor}
        />
      </div>
    </div>
  );
}
