import { DiscrepancyGapChart } from "@/components/analytics/discrepancy-gap-chart";
import type { DiscrepancyCurvePoint, DiscrepancySummary } from "@/domain/analytics/discrepancy-model";
import type { DeviationCauseStat } from "@/domain/analytics/deviation-engine";

const R = (n: number | null, sign = false) =>
  n == null ? "—" : `${sign && n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
const PCT = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

/**
 * The corrected Discrepancy section. It separates the two things the old model
 * conflated: NORMAL strategy variance (not the trader's fault) from AVOIDABLE
 * trader-controlled leakage. The dual-line chart shows Expected Statistical vs
 * Actual; the drill-down attributes the avoidable part to concrete causes.
 */
export function DiscrepancyAnalytics({
  curve,
  summary,
  causes,
  avgStrategyAdherence,
  avgRuleAdherence,
}: {
  curve: DiscrepancyCurvePoint[];
  summary: DiscrepancySummary;
  causes: DeviationCauseStat[];
  avgStrategyAdherence: number | null;
  avgRuleAdherence: number | null;
}) {
  return (
    <div className="glass space-y-4 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Discrepancy — variance vs avoidable</h3>
          <p className="text-xs text-muted-foreground/60">
            How much of the gap to your strategy&apos;s expectancy is normal variance vs things you could
            control. A losing trade with correct execution is variance, not error.
          </p>
        </div>
        {!summary.hasBenchmark && (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">Insufficient sample</span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Group title="Performance (System A)">
          <Stat label="Expected statistical" value={R(summary.expectedStatisticalEquity)} />
          <Stat label="Actual" value={R(summary.actualEquity)} />
          <Stat
            label="Performance variance"
            value={R(summary.performanceVariance, true)}
            tone={summary.performanceVariance > 0 ? "danger" : "success"}
          />
        </Group>
        <Group title="Attribution">
          <Stat
            label="Avoidable discrepancy"
            value={R(summary.avoidableDiscrepancyR)}
            tone={summary.avoidableDiscrepancyR > 0 ? "danger" : "success"}
          />
          <Stat label="Normal variance" value={R(summary.normalVarianceR, true)} />
          <Stat label="Edge capture" value={PCT(summary.edgeCapturePercent)} />
        </Group>
        <Group title="Process adherence">
          <Stat label="Avg strategy adherence" value={PCT(avgStrategyAdherence)} />
          <Stat label="Avg rule adherence" value={PCT(avgRuleAdherence)} />
          <Stat label="Benchmarked trades" value={String(summary.benchmarkedTrades)} />
        </Group>
      </div>

      <DiscrepancyGapChart curve={curve} height={240} />

      {causes.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Execution deviations detected
            <span className="ml-1 font-normal text-muted-foreground/50">
              planned-vs-actual slips, aggregated (context for the avoidable trades)
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
                  <tr key={c.cause} className="border-t border-border/60 transition-colors hover:bg-accent/50">
                    <td className="py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-danger" />
                        {c.label}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{c.occurrences}</td>
                    <td className="py-1.5 text-right tabular-nums text-danger">−{c.avgCostR.toFixed(2)}R</td>
                    <td className="py-1.5 text-right font-medium tabular-nums text-danger">
                      −{c.totalCostR.toFixed(2)}R
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No planned-vs-actual execution deviations detected in this range.
        </p>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</div>
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
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}
