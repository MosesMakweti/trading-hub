import { Target } from "lucide-react";

import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/analytics/kpi-card";
import { CompositionBar } from "@/components/viz/composition-bar";
import { VIZ, tint } from "@/components/viz/tokens";
import type {
  OpportunityCurvePoint,
  OpportunitySummary,
} from "@/domain/analytics/opportunity-engine";
import type { MissReasonAggregate } from "@/domain/analytics/miss-reasons";
import { MISS_REASON_LABELS } from "@/types/opportunity";

const rr = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}R`;
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);

/**
 * Opportunity-aware Discrepancy — the "why" behind the gap, from tracked
 * opportunities (executed + missed valid setups). Distinct from the verified
 * historical Discrepancy Gap above it, which covers ALL executed trades: this
 * section only appears once opportunities are captured, and never fabricates
 * misses for historical trades that had no opportunity record.
 */
export function OpportunityAnalytics({
  data,
}: {
  data: {
    hasData: boolean;
    summary: OpportunitySummary;
    curve: OpportunityCurvePoint[];
    missReasons: MissReasonAggregate;
  };
}) {
  if (!data.hasData) {
    return (
      <div className="glass flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
        <Target className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">No opportunities tracked in this range</p>
        <p className="max-w-md text-xs text-muted-foreground">
          Spot setups on the Journal day page (whether you take or miss them) to see your Edge
          Capture, execution rate, and how much of the gap is missed opportunity vs execution
          leakage. Trades logged before opportunity tracking aren&apos;t counted here — this stays
          honest to what was actually recorded.
        </p>
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="space-y-4">
      {/* Opportunity funnel metrics. Execution VARIANCE (expectancy vs realized on
          trades taken) is normal variance, not error — the trader-controlled leakage
          lives in the Discrepancy section. Missed-winner cost IS avoidable. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Edge capture"
          value={pct(s.edgeCapturePercent)}
          count={s.edgeCapturePercent == null ? undefined : { value: s.edgeCapturePercent, decimals: 0, suffix: "%" }}
          tone={s.edgeCapturePercent != null && s.edgeCapturePercent >= 60 ? "success" : "neutral"}
          sublabel="banked vs. valid setups you could have also taken"
        />
        <KpiCard
          label="Execution rate"
          value={pct(s.executionRatePercent)}
          count={s.executionRatePercent == null ? undefined : { value: s.executionRatePercent, decimals: 0, suffix: "%" }}
          sublabel={`${s.executed} of ${s.validOpportunities} valid setups taken`}
        />
        <KpiCard
          label="Missed opportunity"
          value={rr(s.missedOpportunityCostR)}
          count={{ value: s.missedOpportunityCostR, decimals: 2, suffix: "R", signed: true }}
          tone={s.missedOpportunityCostR > 0 ? "danger" : "neutral"}
          sublabel="forgone on valid setups skipped (avoidable)"
        />
        <KpiCard
          label="Execution variance"
          value={rr(s.executionLeakageR)}
          count={{ value: s.executionLeakageR, decimals: 2, suffix: "R", signed: true }}
          sublabel="vs. scaled expectancy on trades taken — normal variance, excluded from Edge capture above"
        />
      </div>

      {/* The funnel: valid setups → executed vs missed → what the misses were. */}
      <div className="glass space-y-4 rounded-2xl p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Opportunity funnel</h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            {s.validOpportunities} valid setup{s.validOpportunities === 1 ? "" : "s"} · {pct(s.executionRatePercent)} taken
          </span>
        </div>
        <FunnelStage label="Valid setups" value={s.validOpportunities} of={s.validOpportunities} color={tint("var(--viz-1)", 45)} />
        <FunnelStage label="Executed" value={s.executed} of={s.validOpportunities} color="var(--viz-1)" />
        <FunnelStage label="Missed" value={s.missed} of={s.validOpportunities} color={tint("var(--viz-1)", 70)} />
        {s.missed > 0 && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <div className="text-[11px] font-medium text-muted-foreground">What the misses were</div>
            <CompositionBar
              unitLabel="setups"
              parts={[
                { key: "w", label: "Missed winners", value: s.missedWins, color: VIZ.loss, detail: "forgone R — avoidable" },
                { key: "l", label: "Losers avoided", value: s.missedLosses, color: VIZ.profit, detail: "a miss that would have lost" },
                { key: "u", label: "Undetermined", value: s.missedUndetermined, color: VIZ.neutral, detail: "excluded from cost" },
              ]}
            />
          </div>
        )}
      </div>

      {data.missReasons.totalMissed > 0 && <MissReasonsBlock agg={data.missReasons} />}

      {s.invalidOpportunities > 0 && (
        <p className="text-xs text-muted-foreground">
          {s.invalidOpportunities} invalid setup{s.invalidOpportunities === 1 ? "" : "s"} excluded —
          a setup that failed its own rules is never counted as a missed opportunity.
        </p>
      )}
    </div>
  );
}

const rrCost = (v: number) => (v > 0 ? `−${v.toFixed(2)}R` : "0.00R");

/** Why valid setups were missed — the discipline signal: which lapse costs the most
 *  forgone R, and how many misses were disciplined passes vs behavioral lapses. */
function MissReasonsBlock({ agg }: { agg: MissReasonAggregate }) {
  const maxCost = Math.max(...agg.byReason.map((r) => r.missedCostR), 0.0001);
  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight">Why setups were missed</h3>
        <span className="text-xs text-muted-foreground/70">
          {agg.lapseCount} lapse{agg.lapseCount === 1 ? "" : "s"} · {agg.disciplinedCount} disciplined
          pass{agg.disciplinedCount === 1 ? "" : "es"}
        </span>
      </div>

      {agg.costliestLapse && (
        <p className="text-xs text-muted-foreground">
          Costliest lapse:{" "}
          <span className="font-medium text-foreground">
            {MISS_REASON_LABELS[agg.costliestLapse.reason]}
          </span>{" "}
          — <span className="tabular-nums text-danger">{rrCost(agg.costliestLapse.missedCostR)}</span>{" "}
          forgone across {agg.costliestLapse.count} miss{agg.costliestLapse.count === 1 ? "" : "es"}.
        </p>
      )}

      <ul className="space-y-2">
        {agg.byReason.map((r) => (
          <li key={r.reason} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                {MISS_REASON_LABELS[r.reason]}
                {r.disciplined && (
                  <span className="rounded-full border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                    disciplined
                  </span>
                )}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {r.count}×{r.missedCostR > 0 && <span className="ml-2 text-danger">{rrCost(r.missedCostR)}</span>}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", r.disciplined ? "bg-viz-neutral" : "bg-viz-loss")}
                style={{ width: `${Math.max(4, (r.missedCostR / maxCost) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FunnelStage({ label, value, of, color }: { label: string; value: number; of: number; color: string }) {
  const share = of > 0 ? (value / of) * 100 : 0;
  return (
    <div className="grid grid-cols-[6.5rem_1fr_5.5rem] items-center gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="h-3 overflow-hidden rounded-[4px] bg-muted/70" aria-hidden>
        <div className="h-full rounded-[4px]" style={{ width: `${share}%`, background: color }} />
      </div>
      <span className="text-right tabular-nums">
        <span className="font-semibold text-foreground">{value}</span>
        <span className="ml-1.5 text-muted-foreground">{of > 0 ? `${share.toFixed(0)}%` : "—"}</span>
      </span>
    </div>
  );
}
