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
 * The dedicated Discrepancy-Gap analytics section — Expected vs Actual over the
 * range, grouped into Overall / Execution / Recoverable Edge, with the gap trend
 * and the dual-line chart. A discipline lens, not a market prediction.
 */
export function DiscrepancyAnalytics({
  curve,
  summary,
  avgStrategyAdherence,
  avgRuleAdherence,
}: {
  curve: DiscrepancyPoint[];
  summary: DiscrepancySummary;
  avgStrategyAdherence: number | null;
  avgRuleAdherence: number | null;
}) {
  const trend = TREND_META[summary.gapTrend];
  const recoverablePercent =
    summary.fullPotentialEquity !== 0
      ? (summary.recoverableR / summary.fullPotentialEquity) * 100
      : null;

  return (
    <div className="glass space-y-4 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Discrepancy Gap</h3>
          <p className="text-xs text-muted-foreground/60">
            Expected edge vs what execution actually captured — a discipline measure, not a prediction.
          </p>
        </div>
        <span className={`shrink-0 text-xs font-medium ${trend.className}`}>{trend.label}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Group title="Overall">
          <Stat label="Expected equity" value={R(summary.expectedEquity)} />
          <Stat label="Actual equity" value={R(summary.actualEquity)} />
          <Stat
            label="Lifetime gap"
            value={R(summary.currentGap, true)}
            tone={summary.currentGap > 0 ? "danger" : "success"}
          />
        </Group>
        <Group title="Execution">
          <Stat label="Avg execution score" value={PCT(summary.averageExecutionScore)} />
          <Stat label="Avg strategy adherence" value={PCT(avgStrategyAdherence)} />
          <Stat label="Avg rule adherence" value={PCT(avgRuleAdherence)} />
        </Group>
        <Group title="Recoverable edge">
          <Stat label="Recoverable" value={R(summary.recoverableR)} tone="warning" />
          <Stat label="Recoverable %" value={PCT(recoverablePercent)} tone="warning" />
          <Stat label="Edge capture" value={PCT(summary.edgeCapturePercent)} />
        </Group>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Execution efficiency{" "}
          <span className="font-medium text-foreground tabular-nums">
            {PCT(summary.executionEfficiencyPercent)}
          </span>
        </span>
        <span>
          Best execution streak{" "}
          <span className="font-medium text-success tabular-nums">{summary.bestExecutionStreak}</span>
        </span>
        <span>
          Worst execution streak{" "}
          <span className="font-medium text-danger tabular-nums">{summary.worstExecutionStreak}</span>
        </span>
      </div>

      <DiscrepancyGapChart curve={curve} height={240} />
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Stat({
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
          ? "text-amber-600 dark:text-amber-400"
          : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}
