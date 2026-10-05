"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, CircleCheck, Info, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TodayAssetsSection } from "@/components/today/today-assets-section";
import { RulesSummary } from "@/components/today-v3/todays-rules";
import { phaseAfterPlan, type PhaseKey } from "@/domain/today/day-phase";
import { DayContext } from "@/components/today-v3/day-context";
import { updateTodaysPlan } from "@/actions/today.actions";
import { useDayRef } from "@/components/workspace/workspace-context";
import type { SessionWindow } from "@/domain/schedule/session-countdown";
import type { DailyAssetAnalysisDTO, TodaysPlanDTO, TodaysRulesDTO } from "@/types/today";

/**
 * Today V3 — Plan, as a pre-flight checklist (Plan UX pass):
 *   markets (asset → strategy → final bias, one row each)
 *   · quiet inherited rules line (confirm / view strategy rules)
 *   · WHAT I'M LOOKING FOR / STAY OUT IF
 *   · Ready → continues to Trade (or to Prepare while readiness is open).
 * Same canonical data and autosaves as before; everything detailed is one
 * click away. Plan stays reachable before readiness (Decision 1); missing
 * final biases / limits are information, never a blocker.
 */
export function PlanPhase({
  dateKey,
  plan,
  rules,
  analyses,
  strategies,
  tradeFormAccounts,
  sessionWindows,
  ready,
  readOnly,
  onStartIdea,
  onContinue,
}: {
  dateKey: string;
  plan: TodaysPlanDTO;
  rules: TodaysRulesDTO | null;
  analyses: DailyAssetAnalysisDTO[];
  strategies: { id: string; name: string; version: number }[];
  tradeFormAccounts: { id: string; name: string; kind: string }[];
  sessionWindows: SessionWindow[];
  ready: boolean;
  readOnly: boolean;
  /** Opens the V3 Quick Trade Idea for an analyzed asset. */
  onStartIdea: (analysis: DailyAssetAnalysisDTO) => void;
  /** Moves to the next phase once the plan is set. */
  onContinue: (phase: PhaseKey) => void;
}) {
  const dayRef = useDayRef(dateKey);
  const router = useRouter();
  const [isComplete, setIsComplete] = useState(plan.planComplete);
  const [pending, start] = useTransition();
  const withoutFinalBias = analyses.filter((a) => a.finalBias == null).length;
  const limitsUnconfirmed = [plan.riskBudgetPercent, plan.maxTradesPerDay].filter((v) => v == null).length;

  const next = phaseAfterPlan(ready);

  function setPlan(complete: boolean) {
    start(async () => {
      const r = await updateTodaysPlan(dayRef, { planComplete: complete });
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      setIsComplete(complete);
      router.refresh();
      if (complete) onContinue(next);
    });
  }

  const notes: string[] = [];
  if (analyses.length === 0) notes.push("No assets analysed yet");
  else if (withoutFinalBias > 0) notes.push(`${withoutFinalBias} asset${withoutFinalBias === 1 ? "" : "s"} without a final bias`);
  if (limitsUnconfirmed > 0) notes.push(limitsUnconfirmed === 2 ? "Daily limits not confirmed" : "One daily limit not confirmed");

  return (
    <div className="space-y-8">
      <section aria-label="Markets" className="space-y-3">
        <h3 className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Markets</h3>
        <TodayAssetsSection
          dateKey={dateKey}
          analyses={analyses}
          strategies={strategies}
          tradeFormAccounts={tradeFormAccounts}
          activeSessions={plan.activeSessions}
          sessionWindows={sessionWindows}
          variant="v3"
          tradeCreationLocked={!ready || readOnly}
          onStartIdea={onStartIdea}
        />
        <RulesSummary dateKey={dateKey} plan={plan} rules={rules} sessionWindows={sessionWindows} readOnly={readOnly} />
      </section>

      <DayContext dateKey={dateKey} plan={plan} readOnly={readOnly} />

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border/60 pt-4">
        {!isComplete && notes.length > 0 && (
          <p className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5 shrink-0" />
            {notes.join(" · ")}
          </p>
        )}
        {isComplete && (
          <span className="mr-auto flex items-center gap-1.5 text-sm text-success">
            <CircleCheck className="size-4" />
            Plan set
          </span>
        )}
        {!readOnly &&
          (isComplete ? (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPlan(false)} disabled={pending} className="text-muted-foreground">
                Reopen plan
              </Button>
              <Button type="button" onClick={() => onContinue(next)} className="gap-1.5">
                Continue to {next === "trade" ? "Trade" : "Prepare"}
                <ArrowRight className="size-3.5" />
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => setPlan(true)} disabled={pending} className="gap-1.5">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CircleCheck className="size-3.5" />}
              {next === "trade" ? "Ready to trade" : "Plan set · continue to Prepare"}
            </Button>
          ))}
      </div>
    </div>
  );
}
