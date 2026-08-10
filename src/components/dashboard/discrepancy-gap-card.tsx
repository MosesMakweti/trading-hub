import { DiscrepancyGapChart } from "@/components/analytics/discrepancy-gap-chart";
import type { DiscrepancyCurvePoint, DiscrepancySummary } from "@/domain/analytics/discrepancy-model";

const R = (n: number | null, sign = false) =>
  n == null ? "—" : `${sign && n >= 0 ? "+" : ""}${n.toFixed(2)}R`;

/**
 * Expected vs Actual — the corrected model. The band between the lines is
 * Performance Variance, split into Normal Variance (not your fault) and Avoidable
 * Discrepancy (trader-controlled). A correctly-executed loss adds to variance, never
 * to avoidable. See domain/analytics/discrepancy-model.
 */
export function DiscrepancyGapCard({
  curve,
  summary,
}: {
  curve: DiscrepancyCurvePoint[];
  summary: DiscrepancySummary;
}) {
  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Expected vs Actual</h3>
        {!summary.hasBenchmark && (
          <span className="text-xs font-medium text-muted-foreground">Insufficient sample</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric
          label="Performance variance"
          value={R(summary.performanceVariance, true)}
          tone={summary.performanceVariance > 0 ? "danger" : "success"}
        />
        <Metric
          label="Avoidable discrepancy"
          value={R(summary.avoidableDiscrepancyR)}
          tone={summary.avoidableDiscrepancyR > 0 ? "danger" : "neutral"}
        />
        <Metric label="Normal variance" value={R(summary.normalVarianceR, true)} tone="neutral" />
      </div>

      <DiscrepancyGapChart curve={curve} />
      <p className="text-[11px] leading-snug text-muted-foreground/70">
        Only <span className="font-medium text-foreground">avoidable discrepancy</span> is
        trader-controlled — normal variance is the strategy&apos;s own noise, not an execution error.
      </p>
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
  tone?: "success" | "danger" | "warning" | "neutral";
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
