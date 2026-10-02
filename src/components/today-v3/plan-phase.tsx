"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, Info, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TodayAssetsSection } from "@/components/today/today-assets-section";
import { TodaysRules } from "@/components/today-v3/todays-rules";
import { DayContext } from "@/components/today-v3/day-context";
import { updateTodaysPlan } from "@/actions/today.actions";
import { useDayRef } from "@/components/workspace/workspace-context";
import type { SessionWindow } from "@/domain/schedule/session-countdown";
import type { DailyAssetAnalysisDTO, TodaysPlanDTO, TodaysRulesDTO } from "@/types/today";

function PlanSection({ code, title, hint, children }: { code: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card" aria-label={title}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5">
        <span className="font-mono text-[11px] text-muted-foreground">{code}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * Today V3 — Plan: Today's Rules → Day Context → Asset analysis → Plan set.
 * Not a wizard: every section is always open and reachable, before or after
 * the routine is confirmed (Decision 1). "Plan set" stays an explicit
 * action writing planCompletedAt; missing final biases are shown as
 * information, never as a blocker.
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
}) {
  const dayRef = useDayRef(dateKey);
  const router = useRouter();
  const [isComplete, setIsComplete] = useState(plan.planComplete);
  const [pending, start] = useTransition();
  const withoutFinalBias = analyses.filter((a) => a.finalBias == null).length;
  const limitsUnconfirmed = [plan.riskBudgetPercent, plan.maxTradesPerDay].filter((v) => v == null).length;

  function toggle() {
    const next = !isComplete;
    start(async () => {
      const r = await updateTodaysPlan(dayRef, { planComplete: next });
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      setIsComplete(next);
      toast.success(next ? "Plan set." : "Plan reopened.");
      router.refresh();
    });
  }

  const notes: string[] = [];
  if (analyses.length === 0) notes.push("No assets analysed yet");
  else if (withoutFinalBias > 0) notes.push(`${withoutFinalBias} asset${withoutFinalBias === 1 ? "" : "s"} without a final bias`);
  if (limitsUnconfirmed > 0) notes.push(limitsUnconfirmed === 2 ? "Daily limits not confirmed" : "One daily limit not confirmed");

  return (
    <div className="space-y-4">
      <PlanSection code="A" title="Today's rules" hint="What Strategy Lab already knows — confirm, don't retype">
        <TodaysRules dateKey={dateKey} plan={plan} rules={rules} sessionWindows={sessionWindows} readOnly={readOnly} />
      </PlanSection>

      <PlanSection code="B" title="Day context">
        <DayContext dateKey={dateKey} plan={plan} readOnly={readOnly} />
      </PlanSection>

      <PlanSection code="C" title="Asset analysis" hint="Your thesis per market — the final bias is your decision">
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
      </PlanSection>

      <div className="flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-border bg-card px-4 py-3">
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
        {!readOnly && (
          <Button type="button" variant={isComplete ? "outline" : "default"} onClick={toggle} disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {isComplete ? "Reopen plan" : "Plan set"}
          </Button>
        )}
      </div>
    </div>
  );
}
