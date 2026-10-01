import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/analytics/kpi-card";
import { PsychologyTrendChart } from "@/components/analytics/psychology-trend-chart";
import { BreakdownList } from "@/components/analytics/breakdown-list";
import { Heatmap } from "@/components/analytics/heatmap";
import type { getAnalyticsData } from "@/server/services/analytics.service";

type PsychologyData = Awaited<ReturnType<typeof getAnalyticsData>>["psychology"];

function gradeTone(grade: string | null): "neutral" | "success" | "danger" {
  if (grade === "A" || grade === "B") return "success";
  if (grade === "F") return "danger";
  return "neutral";
}

export function PsychologyAnalytics({ data }: { data: PsychologyData }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label="Avg Psychology Score"
          value={data.averageScore == null ? "—" : `${data.averageScore >= 0 ? "+" : ""}${data.averageScore.toFixed(1)} / 8`}
          count={data.averageScore == null ? undefined : { value: data.averageScore, decimals: 1, suffix: " / 8", signed: true }}
        />
        <KpiCard
          label="Avg Psychology %"
          value={data.averagePercent == null ? "—" : `${data.averagePercent.toFixed(1)}%`}
          count={data.averagePercent == null ? undefined : { value: data.averagePercent, decimals: 1, suffix: "%" }}
          spark={data.trendByWeek.map((p) => p.averagePercent)}
          sparkTone="brand"
        />
        <KpiCard
          label="Avg Grade"
          value={data.averageGrade ?? "—"}
          tone={gradeTone(data.averageGrade)}
        />
        <KpiCard
          label="Best Month"
          value={data.bestMonth?.key ?? "—"}
          sublabel={data.bestMonth ? `${data.bestMonth.averagePercent.toFixed(1)}%` : undefined}
          tone="success"
        />
        <KpiCard
          label="Worst Month"
          value={data.worstMonth?.key ?? "—"}
          sublabel={data.worstMonth ? `${data.worstMonth.averagePercent.toFixed(1)}%` : undefined}
          tone="danger"
        />
      </div>

      <PsychologyTrendChart byWeek={data.trendByWeek} byMonth={data.trendByMonth} />

      <div className="glass space-y-3 rounded-2xl p-4">
        <h3 className="text-sm font-medium text-muted-foreground">Psychology Heatmap</h3>
        <Heatmap
          points={data.byDay.map((p) => ({
            dateKey: p.key,
            value: p.averagePercent,
            label: `${p.key}: ${p.averagePercent.toFixed(0)}%`,
          }))}
          scale="psychology"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BreakdownList title="Psychology by Asset" points={data.byAsset} />
        <BreakdownList title="Psychology by Account" points={data.byAccount} />
        <BreakdownList title="Psychology by Session" points={data.bySession} />
        <BreakdownList title="Psychology by Day of Week" points={data.byDayOfWeek} />
      </div>

      <div className="glass space-y-3 rounded-2xl p-4">
        <h3 className="text-sm font-medium text-muted-foreground">Correlations</h3>
        <p className="text-xs text-muted-foreground">
          Correlation, not causation — this describes a pattern in your own data, not a proven
          cause-and-effect relationship.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CorrelationStat label="vs Win Rate" value={data.correlationWithWinRate} />
          <CorrelationStat label="vs Profitability" value={data.correlationWithProfitability} />
          <CorrelationStat label="vs Rule Adherence" value={data.correlationWithRuleAdherence} />
        </div>
      </div>
    </div>
  );
}

/** Correlation magnitude as a single-hue bar (sign carries direction via color,
 *  never encoded by hue-cycling) — matches the dataviz "sequential = one hue"
 *  rule already used throughout the module, instead of a bare number. */
function CorrelationStat({ label, value }: { label: string; value: number | null }) {
  const magnitude = value == null ? 0 : Math.min(100, Math.abs(value) * 100);
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          value != null && value > 0 && "text-success",
          value != null && value < 0 && "text-danger",
        )}
      >
        {value == null ? "—" : value.toFixed(2)}
      </div>
      <div className="mx-auto mt-2 h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", value != null && value < 0 ? "bg-danger" : "bg-success")}
          style={{ width: `${magnitude}%` }}
        />
      </div>
    </div>
  );
}
