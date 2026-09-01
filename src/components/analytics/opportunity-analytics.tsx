import { Target } from "lucide-react";

import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/analytics/kpi-card";
import { Donut } from "@/components/analytics/donut";
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
          sublabel="of available edge banked"
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
          sublabel="vs expectancy on trades taken — normal variance"
        />
      </div>

      {/* The funnel: valid setups → executed vs missed. */}
      <div className="glass grid grid-cols-1 items-center gap-4 rounded-2xl p-4 sm:grid-cols-[auto_1fr]">
        <Donut
          size={116}
          stroke={14}
          segments={[
            { label: "Executed", value: s.executed, color: "var(--success)" },
            { label: "Missed", value: s.missed, color: "var(--danger)" },
          ]}
        >
          <span className="text-lg font-semibold tabular-nums">{pct(s.executionRatePercent)}</span>
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">Executed</span>
        </Donut>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Valid opportunities" value={String(s.validOpportunities)} />
          <Stat label="Executed" value={String(s.executed)} tone="success" />
          <Stat label="Missed" value={String(s.missed)} tone="danger" />
          <Stat label="Missed winners" value={String(s.missedWins)} tone="danger" />
          <Stat label="Missed losers avoided" value={String(s.missedLosses)} tone="success" />
          <Stat
            label="Undetermined"
            value={String(s.missedUndetermined)}
            hint="excluded from cost"
          />
        </div>
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
                className={cn("h-full rounded-full", r.disciplined ? "bg-success/50" : "bg-danger/60")}
                style={{ width: `${Math.max(4, (r.missedCostR / maxCost) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-base font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}
