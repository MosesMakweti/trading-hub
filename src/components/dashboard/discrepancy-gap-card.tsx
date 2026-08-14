import { CounterfactualGapChart } from "@/components/analytics/counterfactual-gap-chart";
import { WhyGapPanel } from "@/components/analytics/why-gap-panel";
import { CATEGORY_LABEL, LEAKAGE_TONE } from "@/components/analytics/leakage-meta";
import type {
  AttributionSummary,
  CounterfactualPoint,
  LeakageCategory,
} from "@/domain/analytics/counterfactual-engine";

const CARD_ORDER: LeakageCategory[] = [
  "EXECUTION",
  "BEHAVIORAL",
  "RISK",
  "STRATEGY_ADHERENCE",
  "OPPORTUNITY",
];

/**
 * Discrepancy Gap — the Counterfactual model. Actual Equity vs Process-Perfect
 * Equity; the shaded band is ONLY the avoidable discrepancy (deviations from a valid
 * process), never normal strategy variance. A correctly-executed win or loss adds
 * nothing here. See domain/analytics/counterfactual-engine.
 */
export function DiscrepancyGapCard({
  curve,
  summary,
}: {
  curve: CounterfactualPoint[];
  summary: AttributionSummary;
}) {
  const measuredByCat = new Map(summary.byCategory.map((c) => [c.category, c] as const));

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Discrepancy Gap</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {summary.processEfficiencyPercent != null && (
            <span>
              Process eff.{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {summary.processEfficiencyPercent}%
              </span>
            </span>
          )}
          {summary.dataConfidencePercent != null && (
            <span title="Share of events with fully measurable attribution">
              Confidence{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {summary.dataConfidencePercent}%
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Headline: Total Avoidable Gap */}
      <div className="flex items-baseline gap-2">
        <span
          className={`text-3xl font-semibold tabular-nums ${
            summary.totalAvoidableGapR > 0 ? "text-danger" : "text-foreground"
          }`}
        >
          {summary.totalAvoidableGapR.toFixed(2)}R
        </span>
        <span className="text-xs text-muted-foreground">total avoidable gap</span>
        {summary.unearnedR > 0 && (
          <span className="ml-auto text-[11px] text-warning" title="R won by breaking process — not rewarded">
            {summary.unearnedR.toFixed(2)}R unearned
          </span>
        )}
      </div>

      {/* Per-category leakage tiles */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {CARD_ORDER.map((category) => {
          const c = measuredByCat.get(category);
          const value = c?.measuredR ?? 0;
          const flagged = c?.flaggedCount ?? 0;
          return (
            <div key={category} className="rounded-xl border border-border bg-background/40 p-2">
              <div className="flex items-center gap-1 text-[10px] leading-tight text-muted-foreground">
                <span className="size-1.5 rounded-full" style={{ background: LEAKAGE_TONE[category] }} />
                {CATEGORY_LABEL[category]}
              </div>
              <div className="text-sm font-semibold tabular-nums">
                {value > 0 ? `${value.toFixed(2)}R` : flagged > 0 ? `${flagged}⚑` : "—"}
              </div>
            </div>
          );
        })}
      </div>

      <CounterfactualGapChart curve={curve} />

      <WhyGapPanel summary={summary} />

      <p className="text-[11px] leading-snug text-muted-foreground/70">
        The gap is only what a <span className="font-medium text-foreground">deviation from your valid process</span>{" "}
        cost — a correctly-executed win or loss is normal variance and never counted.
      </p>
    </div>
  );
}
