import { DiscrepancyGapChart } from "@/components/analytics/discrepancy-gap-chart";
import type { DiscrepancyPoint, DiscrepancySummary } from "@/domain/analytics/execution-engine";
import type { DeviationCauseStat } from "@/domain/analytics/deviation-engine";

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
  causes,
  avgStrategyAdherence,
  avgRuleAdherence,
}: {
  curve: DiscrepancyPoint[];
  summary: DiscrepancySummary;
  causes: DeviationCauseStat[];
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

      {causes.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            What execution is costing you
            <span className="ml-1 font-normal text-muted-foreground/50">
              biggest deviation per trade, aggregated
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1.5 font-medium">Cause</th>
                  <th className="pb-1.5 text-right font-medium">Occurrences</th>
                  <th className="pb-1.5 text-right font-medium">Avg cost</th>
                  <th className="pb-1.5 text-right font-medium">Total cost</th>
                </tr>
              </thead>
              <tbody>
                {causes.map((c) => (
                  <tr key={c.cause} className="border-t border-border/60">
                    <td className="py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-amber-500" />
                        {c.label}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{c.occurrences}</td>
                    <td className="py-1.5 text-right tabular-nums text-amber-600 dark:text-amber-400">
                      −{c.avgCostR.toFixed(2)}R
                    </td>
                    <td className="py-1.5 text-right font-medium tabular-nums text-amber-600 dark:text-amber-400">
                      −{c.totalCostR.toFixed(2)}R
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
