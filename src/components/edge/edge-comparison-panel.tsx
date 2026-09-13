"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Columns3, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { EdgeCumulativeRChart } from "@/components/edge/edge-cumulative-r-chart";
import { EdgeComparisonTable } from "@/components/edge/edge-comparison-table";
import { reopenReplayReviewSession } from "@/actions/replay.actions";
import type { ActualVsReplayComparison, CategoryComparisonRow, PeriodMetrics } from "@/domain/replay-comparison/types";

const rr = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`);
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
const num = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const toneClass = (v: number | null) => (v == null ? "" : v > 0 ? "text-success" : v < 0 ? "text-danger" : "");

interface MetricRow {
  label: string;
  actual: string;
  replay: string;
  actualTone?: string;
  replayTone?: string;
}

function buildRows(actual: PeriodMetrics, replay: PeriodMetrics): MetricRow[] {
  return [
    { label: "Executed Trades", actual: String(actual.executedTrades), replay: String(replay.executedTrades) },
    { label: "Wins", actual: String(actual.wins), replay: String(replay.wins) },
    { label: "Losses", actual: String(actual.losses), replay: String(replay.losses) },
    { label: "Breakeven", actual: String(actual.breakeven), replay: String(replay.breakeven) },
    { label: "Win Rate", actual: pct(actual.winRate), replay: pct(replay.winRate) },
    {
      label: "Total Realized R",
      actual: rr(actual.totalRealizedR),
      replay: rr(replay.totalRealizedR),
      actualTone: toneClass(actual.totalRealizedR),
      replayTone: toneClass(replay.totalRealizedR),
    },
    {
      label: "Avg R / Trade",
      actual: rr(actual.averageRPerTrade),
      replay: rr(replay.averageRPerTrade),
      actualTone: toneClass(actual.averageRPerTrade),
      replayTone: toneClass(replay.averageRPerTrade),
    },
    {
      label: "Expectancy",
      actual: rr(actual.expectancy),
      replay: rr(replay.expectancy),
      actualTone: toneClass(actual.expectancy),
      replayTone: toneClass(replay.expectancy),
    },
    { label: "Profit Factor", actual: num(actual.profitFactor), replay: num(replay.profitFactor) },
    { label: "Validated Trades", actual: String(actual.validatedTrades), replay: String(replay.validatedTrades) },
    { label: "Overrides", actual: String(actual.overrideCount), replay: String(replay.overrideCount) },
  ];
}

/**
 * Actual vs Replay Comparison (Stage 15, completed Stage 15.2) — every
 * number here comes from `domain/replay-comparison/*`'s pure builders; this
 * component does no comparison math of its own. Deliberately descriptive
 * throughout — no "mistake"/"error" language, no coaching, no
 * recommendations. A raw R delta is not a verdict: a correctly-executed
 * Actual loss can sit next to a Replay win with no implication the Actual
 * trade was wrong (see the domain layer's own doc comments for the full
 * rationale).
 */
export function EdgeComparisonPanel({
  sessionId,
  replayTradeCount,
  comparison,
}: {
  sessionId: string | null;
  replayTradeCount: number;
  comparison: ActualVsReplayComparison;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (replayTradeCount === 0) {
    return (
      <EmptyState
        icon={Columns3}
        title="Actual vs Replay"
        description="Complete replay decisions for this review to unlock comparison."
      />
    );
  }

  function reopen() {
    if (!sessionId) return;
    startTransition(async () => {
      const result = await reopenReplayReviewSession(sessionId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Review reopened — Replay is editable again.");
      router.refresh();
    });
  }

  const rows = buildRows(comparison.actual.metrics, comparison.replay.metrics);
  const { discrepancy, overrideAnalysis, breakdowns } = comparison;

  return (
    <div className="space-y-4">
      {/* Header — Replay completion status (§25) */}
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium",
              comparison.isProvisional ? "bg-warning/15 text-warning" : "bg-success/15 text-success",
            )}
          >
            {comparison.isProvisional ? "Provisional Comparison — Replay incomplete" : "Final Comparison — Replay completed"}
          </span>
          <span className="text-[11px] text-muted-foreground/70">
            {comparison.replay.decisionCounts.taken} taken · {comparison.replay.decisionCounts.skipped} skipped
          </span>
        </div>
        {comparison.sessionStatus === "COMPLETED" && sessionId && (
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={reopen} disabled={pending}>
            <RotateCcw className="size-3.5" /> Reopen Replay
          </Button>
        )}
      </div>

      {/* Row 1 — Actual vs Replay KPI table */}
      <div className="glass space-y-3 rounded-2xl p-4">
        <h3 className="text-sm font-semibold">Period Summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="pb-2 text-left font-medium">Metric</th>
                <th className="pb-2 text-right font-medium">Actual</th>
                <th className="pb-2 text-right font-medium">Replay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row) => (
                <tr key={row.label}>
                  <td className="py-1.5 text-muted-foreground">{row.label}</td>
                  <td className={cn("py-1.5 text-right font-medium tabular-nums", row.actualTone)}>{row.actual}</td>
                  <td className={cn("py-1.5 text-right font-medium tabular-nums", row.replayTone)}>{row.replay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground/60 italic">
          Actual is the frozen baseline for this period; Replay is computed independently from ReplayTrade data — neither feeds
          the other.
        </p>
      </div>

      {/* Row 2 — Cumulative R comparison */}
      <EdgeCumulativeRChart comparison={comparison.cumulativeR} />

      {/* Row 3 — Four-bucket discrepancy summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BucketCard
          title="Strategy Variance"
          count={discrepancy.strategyVariance.count}
          description="Same decision & execution, different outcome — normal variance, never priced."
        />
        <BucketCard
          title="Execution Discrepancy"
          count={discrepancy.executionDiscrepancy.count}
          description="Objective entry/stop/exit/management differences."
          rImpact={discrepancy.executionDiscrepancy.totalCostR}
        />
        <BucketCard
          title="Behavioral Discrepancy"
          count={discrepancy.behavioralDiscrepancy.count}
          description="Process/rule divergence — a count, never converted to R."
        />
        <BucketCard
          title="Opportunity Discrepancy"
          count={discrepancy.opportunityDiscrepancy.count}
          description="Confirmed missed opportunities only."
          rImpact={discrepancy.opportunityDiscrepancy.totalReplayR}
          rLabel="Replay outcome"
        />
      </div>
      <div className="glass rounded-2xl p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Avoidable Discrepancy: {rr(discrepancy.avoidableDiscrepancy.totalR)}</span>
        <span className="ml-2">{discrepancy.avoidableDiscrepancy.formula}</span>
      </div>

      {/* Row 4 — Validation / Override analysis */}
      <div className="glass space-y-3 rounded-2xl p-4">
        <h3 className="text-sm font-semibold">Override Analysis</h3>
        <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3">
          <OverrideStat label="Actual" validated={overrideAnalysis.actual.validated} overridden={overrideAnalysis.actual.overridden} third={overrideAnalysis.actual.notValidated} thirdLabel="Not validated" />
          <OverrideStat label="Replay" validated={overrideAnalysis.replay.validated} overridden={overrideAnalysis.replay.overridden} third={overrideAnalysis.replay.skipped} thirdLabel="Skipped" />
          <div className="space-y-1 rounded-lg border border-border/60 bg-background/40 p-2.5">
            <div className="text-muted-foreground">Review cases</div>
            <div>Actual override → Replay skipped: {overrideAnalysis.actualOverrideReplaySkipped}</div>
            <div>Actual override → Replay validated: {overrideAnalysis.actualOverrideReplayValidated}</div>
            <div>Actual validated → Replay skipped: {overrideAnalysis.actualValidatedReplaySkipped}</div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground/60 italic">These are review cases, not automatic mistakes.</p>
      </div>

      {/* Row 5 — Category breakdowns */}
      <CategoryBreakdownSection breakdowns={breakdowns} />

      {/* Main — Detailed comparison table */}
      <div className="glass space-y-2 rounded-2xl p-4">
        <h3 className="text-sm font-semibold">Detailed Comparison</h3>
        {sessionId ? (
          <EdgeComparisonTable sessionId={sessionId} comparison={comparison} />
        ) : (
          <p className="text-xs text-muted-foreground">Start the review to enable match review actions.</p>
        )}
      </div>
    </div>
  );
}

function BucketCard({
  title,
  count,
  description,
  rImpact,
  rLabel = "R impact",
}: {
  title: string;
  count: number;
  description: string;
  rImpact?: number;
  rLabel?: string;
}) {
  return (
    <div className="glass space-y-1.5 rounded-2xl p-4">
      <div className="text-xs font-medium text-muted-foreground uppercase">{title}</div>
      <div className="text-2xl font-semibold tabular-nums">{count}</div>
      {rImpact != null && (
        <div className={cn("text-xs font-medium tabular-nums", toneClass(rImpact))}>
          {rLabel}: {rr(rImpact)}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground/70">{description}</p>
    </div>
  );
}

function OverrideStat({
  label,
  validated,
  overridden,
  third,
  thirdLabel,
}: {
  label: string;
  validated: number;
  overridden: number;
  third: number;
  thirdLabel: string;
}) {
  return (
    <div className="space-y-1 rounded-lg border border-border/60 bg-background/40 p-2.5">
      <div className="text-muted-foreground">{label}</div>
      <div>Validated: {validated}</div>
      <div>Overridden: {overridden}</div>
      <div>
        {thirdLabel}: {third}
      </div>
    </div>
  );
}

function CategoryBreakdownSection({ breakdowns }: { breakdowns: ActualVsReplayComparison["breakdowns"] }) {
  const [tab, setTab] = useState<"byAsset" | "byStrategy" | "bySetupType" | "byDirection">("byAsset");
  const rowsFor: Record<typeof tab, CategoryComparisonRow[]> = {
    byAsset: breakdowns.byAsset,
    byStrategy: breakdowns.byStrategy,
    bySetupType: breakdowns.bySetupType,
    byDirection: breakdowns.byDirection,
  };
  const rows = rowsFor[tab];

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Breakdown</h3>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="byAsset">Asset</TabsTrigger>
            <TabsTrigger value="byStrategy">Strategy</TabsTrigger>
            <TabsTrigger value="bySetupType">Setup</TabsTrigger>
            <TabsTrigger value="byDirection">Direction</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="pb-2 text-left font-medium">{tab === "byAsset" ? "Asset" : tab === "byStrategy" ? "Strategy" : tab === "bySetupType" ? "Setup Type" : "Direction"}</th>
              <th className="pb-2 text-right font-medium">Actual R</th>
              <th className="pb-2 text-right font-medium">Actual #</th>
              <th className="pb-2 text-right font-medium">Replay R</th>
              <th className="pb-2 text-right font-medium">Replay #</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="py-1.5">{row.label}</td>
                <td className={cn("py-1.5 text-right tabular-nums", toneClass(row.actualR))}>{rr(row.actualR)}</td>
                <td className="py-1.5 text-right tabular-nums">{row.actualCount}</td>
                <td className={cn("py-1.5 text-right tabular-nums", toneClass(row.replayR))}>{rr(row.replayR)}</td>
                <td className="py-1.5 text-right tabular-nums">{row.replayTakenCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
