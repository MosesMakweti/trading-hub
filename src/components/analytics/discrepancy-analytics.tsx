import { CounterfactualGapChart } from "@/components/analytics/counterfactual-gap-chart";
import { WhyGapPanel } from "@/components/analytics/why-gap-panel";
import type {
  AttributionSummary,
  CounterfactualPoint,
} from "@/domain/analytics/counterfactual-engine";

const R = (n: number | null, sign = false) =>
  n == null ? "—" : `${sign && n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
const PCT = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

/**
 * Discrepancy Gap — the Counterfactual model. Actual Equity vs Process-Perfect
 * Equity; the gap is ONLY what deviating from a valid process cost (a correctly
 * executed win or loss is normal variance and adds nothing). The attribution panel
 * decomposes the avoidable gap by cause. See domain/analytics/counterfactual-engine.
 */
export function DiscrepancyAnalytics({
  curve,
  summary,
  avgStrategyAdherence,
  avgRuleAdherence,
}: {
  curve: CounterfactualPoint[];
  summary: AttributionSummary;
  avgStrategyAdherence: number | null;
  avgRuleAdherence: number | null;
}) {
  return (
    <div className="glass space-y-4 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">
            Discrepancy — the cost of deviating from your process
          </h3>
          <p className="text-xs text-muted-foreground/60">
            Actual vs the equity a disciplined execution of the same opportunities would have made. Only
            attributable deviations move the gap — a correctly-executed win or loss never does.
          </p>
        </div>
        {summary.dataConfidencePercent != null && (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {summary.dataConfidencePercent}% confidence
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Group title="Gap">
          <Stat
            label="Total avoidable"
            value={R(summary.totalAvoidableGapR)}
            tone={summary.totalAvoidableGapR > 0 ? "danger" : "success"}
          />
          <Stat label="Unearned (lucky breaches)" value={R(summary.unearnedR)} tone="warning" />
          <Stat label="Process efficiency" value={PCT(summary.processEfficiencyPercent)} />
        </Group>
        <Group title="Equity">
          <Stat label="Realized" value={R(summary.realizedR, true)} />
          <Stat label="Process-perfect" value={R(summary.processPerfectR, true)} />
          <Stat label="Disciplined potential" value={R(summary.potentialR, true)} />
        </Group>
        <Group title="Process adherence">
          <Stat label="Avg strategy adherence" value={PCT(avgStrategyAdherence)} />
          <Stat label="Avg rule adherence" value={PCT(avgRuleAdherence)} />
          <Stat label="Process breaches" value={String(summary.processBreaches)} />
        </Group>
      </div>

      <CounterfactualGapChart curve={curve} height={240} />

      <WhyGapPanel summary={summary} />
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
