import { DiscrepancyGapChart } from "@/components/analytics/discrepancy-gap-chart";
import type { DiscrepancyPoint, DiscrepancySummary } from "@/domain/analytics/execution-engine";

const R = (n: number | null, sign = false) =>
  n == null ? "—" : `${sign && n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
const PCT = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

const TREND_META: Record<DiscrepancySummary["gapTrend"], { label: string; className: string }> = {
  shrinking: { label: "Gap shrinking", className: "text-success" },
  stable: { label: "Gap stable", className: "text-muted-foreground" },
  growing: { label: "Gap growing", className: "text-danger" },
};

/**
 * Discrepancy Gap — Expected vs Actual cumulative equity (in R), with the gap
 * between them shaded. Companion to the Equity Curve: it shows not just how much
 * was made, but how much of a proven edge execution actually captured. A discipline
 * measure, not a market prediction.
 */
export function DiscrepancyGapCard({
  curve,
  summary,
}: {
  curve: DiscrepancyPoint[];
  summary: DiscrepancySummary;
}) {
  const trend = TREND_META[summary.gapTrend];

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Discrepancy Gap</h3>
        <span className={`text-xs font-medium ${trend.className}`}>{trend.label}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Current gap" value={R(summary.currentGap, true)} tone={summary.currentGap > 0 ? "danger" : "success"} />
        <Metric label="Execution efficiency" value={PCT(summary.executionEfficiencyPercent)} />
        <Metric label="Recoverable" value={R(summary.recoverableR)} tone="warning" />
      </div>

      <DiscrepancyGapChart curve={curve} />
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background/40 p-2.5">
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
