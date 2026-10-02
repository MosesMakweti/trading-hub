"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";

import { TradePlanSection } from "@/components/journal/workspace/trade-plan/trade-plan-section";
import { TradeImageBucket } from "@/components/journal/workspace/trade-image-bucket";
import { SetupScoreCard } from "@/components/journal/setup-score-card";
import { loadPlanningReferenceAction } from "@/actions/today-v3.actions";
import { loadMediaAction } from "@/actions/media.actions";
import { suggestedPlanTargets } from "@/domain/today/idea-inheritance";
import type { PlanningReferenceDTO } from "@/server/services/today-rules.service";
import type { TradeWorkspaceDTO } from "@/types/trades";
import type { DailyAssetAnalysisDTO } from "@/types/today";

/**
 * Today V3 — Plan stage: "if this setup occurs, exactly what will I do?"
 * The canonical TradePlanSection (TradePlanVersion append-only history,
 * lock on first entry, reason-required revisions, screenshot recognition)
 * with V3 additions only: the trade's ONE direction, Strategy Lab partial
 * TPs as suggested rows for a new plan, today's asset chart as a screenshot
 * source, and the strategy's planning reference next to the levels.
 */
export function PlanStage({ trade, analysis }: { trade: TradeWorkspaceDTO; analysis: DailyAssetAnalysisDTO | null }) {
  const [reference, setReference] = useState<PlanningReferenceDTO | null | "none">(trade.strategyId ? null : "none");
  const [charts, setCharts] = useState<{ id: string; label: string }[] | null>(analysis ? null : []);

  useEffect(() => {
    let active = true;
    if (trade.strategyId) {
      void loadPlanningReferenceAction(trade.strategyId, trade.entryModelName).then((r) => {
        if (active) setReference(r ?? "none");
      });
    }
    if (analysis) {
      void loadMediaAction("DAILY_ASSET_ANALYSIS", analysis.id).then((r) => {
        if (!active) return;
        setCharts(
          r.items
            .filter((i) => i.category === "CHART")
            .map((i) => ({ id: i.id, label: `${analysis.assetSymbol}${i.timeframe ? ` · ${i.timeframe}` : ""}` })),
        );
      });
    }
    return () => {
      active = false;
    };
  }, [trade.strategyId, trade.entryModelName, analysis]);

  if (reference === null || charts === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading plan…
      </div>
    );
  }

  const ref = reference === "none" ? null : reference;
  const suggestions = ref?.strategy ? suggestedPlanTargets(ref.strategy.management.partialTakeProfits) : [];
  const m = ref?.strategy?.management;
  const guidance: [string, string | null][] = [
    ["Stop placement", ref?.entryModel?.stopPlacement ?? m?.initialStopPlacement ?? null],
    ["Target logic", ref?.entryModel?.targetLogic ?? null],
    ["Invalidation", ref?.entryModel?.invalidation ?? null],
    ["Break-even", m?.breakEven ?? null],
    ["Trailing", m?.trailing ?? null],
    ["Scaling out", m?.scalingOut ?? null],
    ["Max holding", m?.maxHoldingTime ?? null],
  ];
  const filled = guidance.filter(([, v]) => v);

  return (
    <div className="space-y-4">
      {(filled.length > 0 || trade.setupValid !== null) && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
          {filled.length > 0 ? (
            <details className="group rounded-xl border border-border" open>
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs select-none">
                <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
                <span className="font-medium">How {ref?.strategy?.name ?? "this strategy"} plans this</span>
                {ref?.entryModel && <span className="text-muted-foreground">· {ref.entryModel.name}</span>}
              </summary>
              <dl className="grid gap-x-3 gap-y-1.5 border-t border-border px-3 py-2.5 text-xs sm:grid-cols-[100px_minmax(0,1fr)]">
                {filled.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : (
            <div />
          )}
          {trade.setupValid !== null && (
            <SetupScoreCard score={trade.setupScore} rating={trade.setupRating} valid={trade.setupValid} missingMandatory={trade.missingMandatory} />
          )}
        </div>
      )}

      <TradePlanSection
        dateKey={trade.dateKey}
        tradeId={trade.id}
        assetSymbol={trade.assetSymbol}
        initialDirection={trade.direction}
        tradeUpdatedAt={trade.updatedAt}
        directionMode="fixed"
        suggestedTargets={suggestions}
        assetCharts={charts}
        timeframeSuggestions={ref?.timeframes}
      />

      <div className="rounded-xl border border-border p-3">
        <TradeImageBucket tradeId={trade.id} category="BEFORE" label="Before-trade images" />
      </div>
    </div>
  );
}
