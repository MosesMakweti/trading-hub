import { Target } from "lucide-react";

import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/analytics/kpi-card";
import { Donut } from "@/components/analytics/donut";
import type {
  OpportunityCurvePoint,
  OpportunitySummary,
} from "@/domain/analytics/opportunity-engine";

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
  data: { hasData: boolean; summary: OpportunitySummary; curve: OpportunityCurvePoint[] };
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
      {/* The decomposition, front and center: Total = Leakage + Missed. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Edge capture"
          value={pct(s.edgeCapturePercent)}
          tone={
            s.edgeCapturePercent != null && s.edgeCapturePercent >= 60 ? "success" : "neutral"
          }
          sublabel="of available edge banked"
        />
        <KpiCard
          label="Execution leakage"
          value={rr(s.executionLeakageR)}
          tone={s.executionLeakageR > 0 ? "danger" : "neutral"}
          sublabel="edge lost on trades taken"
        />
        <KpiCard
          label="Missed opportunity"
          value={rr(s.missedOpportunityCostR)}
          tone={s.missedOpportunityCostR > 0 ? "danger" : "neutral"}
          sublabel="forgone on valid setups skipped"
        />
        <KpiCard
          label="Total discrepancy"
          value={rr(s.totalDiscrepancyR)}
          tone={s.totalDiscrepancyR > 0 ? "danger" : "neutral"}
          sublabel="leakage + missed"
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

      {s.invalidOpportunities > 0 && (
        <p className="text-xs text-muted-foreground">
          {s.invalidOpportunities} invalid setup{s.invalidOpportunities === 1 ? "" : "s"} excluded —
          a setup that failed its own rules is never counted as a missed opportunity.
        </p>
      )}
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
