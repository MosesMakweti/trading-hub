"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Check, ExternalLink, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateKeyLong } from "@/lib/date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { TradeReviewSection } from "@/components/journal/workspace/trade-review-section";
import { IdeaStage } from "@/components/today-v3/trade/idea-stage";
import { PlanStage } from "@/components/today-v3/trade/plan-stage";
import { ExecutionStage } from "@/components/today-v3/trade/execution-stage";
import { setReviewLifecycleStatusAction } from "@/actions/trade-review.actions";
import { STATE_LABEL, type TradeLifecycle, type TradeStageKey } from "@/domain/trades/trade-lifecycle";
import type { DayUsage } from "@/domain/today/limit-state";
import type { TradeLifecycleFactsDTO } from "@/server/services/today-trade.service";
import type { TradeWorkspaceDTO } from "@/types/trades";
import type { DailyAssetAnalysisDTO, TodaysPlanDTO } from "@/types/today";
import type { AccountAllocationSelectorDTO, ExecutionDTO } from "@/types/prop-firms";

const STAGES: { key: TradeStageKey; label: string }[] = [
  { key: "idea", label: "Idea" },
  { key: "plan", label: "Plan" },
  { key: "execution", label: "Execution" },
  { key: "review", label: "Review" },
];

export const STATE_TONE: Record<TradeLifecycle["state"], string> = {
  IDEA: "border-border text-muted-foreground",
  PLANNED: "border-primary/40 text-primary",
  OPEN: "border-warning/50 text-warning",
  PARTIALLY_CLOSED: "border-warning/50 text-warning",
  REVIEW_NEEDED: "border-danger/50 text-danger",
  REVIEWED: "border-success/50 text-success",
  CANCELLED: "border-border text-muted-foreground line-through",
};

function stageSummary(stage: TradeStageKey, trade: TradeWorkspaceDTO, lifecycle: TradeLifecycle, facts?: TradeLifecycleFactsDTO): string {
  switch (stage) {
    case "idea":
      return [
        trade.entryModelName,
        trade.confluenceLabels.length ? `${trade.confluenceLabels.length} confluences` : null,
        trade.setupRating ? `setup ${trade.setupRating}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Logged";
    case "plan":
      return facts?.hasConfirmedPlan
        ? `${trade.plannedEntry ?? "—"} / ${trade.plannedStopLoss ?? "—"}${trade.targets[0] ? ` / ${trade.targets[0].label} ${trade.targets[0].targetPrice}` : ""}${
            trade.expectedRR != null ? ` · ${trade.expectedRR.toFixed(2)}R` : ""
          }${facts.planLocked ? " · locked" : ""}`
        : "No confirmed plan";
    case "execution":
      return trade.actualEntry != null
        ? `In @ ${trade.actualEntry}${lifecycle.openPercent != null && lifecycle.openPercent > 0 ? ` · ${lifecycle.openPercent}% open` : " · closed"}`
        : "Not entered";
    case "review":
      return trade.reviewedAt ? "Reviewed" : "Not reviewed";
  }
}

/**
 * Today V3 — one trade as a contained workspace: IDEA → PLAN → EXECUTION →
 * REVIEW. One stage is open at a time; the others collapse to a one-line
 * summary. Availability follows canonical facts (domain/trades/
 * trade-lifecycle.ts) — nothing is marked done to advance the interface.
 * Review temporarily reuses the existing review section (Phase 3).
 */
export function TradeLifecycleWorkspace({
  trade,
  lifecycle,
  facts,
  carried,
  loggedBeforeReady,
  initialStage,
  strategies,
  analysisFor,
  plan,
  usage,
  limits,
  propFirmAccounts,
  executions,
}: {
  trade: TradeWorkspaceDTO;
  lifecycle: TradeLifecycle;
  facts: TradeLifecycleFactsDTO | undefined;
  carried: boolean;
  loggedBeforeReady: boolean;
  initialStage?: TradeStageKey;
  strategies: { id: string; name: string; version: number }[];
  analysisFor: (symbol: string) => DailyAssetAnalysisDTO | null;
  plan: Pick<TodaysPlanDTO, "lookingFor" | "stayOutConditions">;
  usage: DayUsage;
  limits: { riskLimitPercent: number | null; maxTrades: number | null };
  propFirmAccounts: AccountAllocationSelectorDTO[];
  executions: ExecutionDTO[];
}) {
  const editable = useWorkspaceEditable();
  const router = useRouter();
  const requested = initialStage && lifecycle.stages[initialStage].available ? initialStage : lifecycle.primaryStage;
  const [open, setOpen] = useState<TradeStageKey>(requested);
  const active = lifecycle.stages[open].available ? open : lifecycle.primaryStage;
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [pending, start] = useTransition();

  function cancelIdea() {
    start(async () => {
      const r = await setReviewLifecycleStatusAction(trade.dateKey, trade.id, {
        status: "CANCELLED_NEVER_TRIGGERED",
        cancellationReason: cancelReason.trim() || null,
      });
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      toast.success("Idea cancelled — it stays in your record.");
      setCancelling(false);
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-card" aria-label={`Trade #${trade.tradeNumber}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-3">
        <span className="font-mono text-xs text-muted-foreground">#{trade.tradeNumber}</span>
        <span className="font-mono text-sm font-semibold">{trade.assetSymbol}</span>
        <span className={cn("text-sm font-medium", trade.direction === "LONG" ? "text-success" : "text-danger")}>
          {trade.direction === "LONG" ? "Long" : "Short"}
        </span>
        {trade.sessionName && <span className="text-xs text-muted-foreground">{trade.sessionName}</span>}
        {trade.strategyName && (
          <span className="text-xs text-muted-foreground">
            {trade.strategyName} v{trade.strategyVersion}
          </span>
        )}
        <span className={cn("rounded-md border px-1.5 py-0.5 font-mono text-[11px] tracking-wide uppercase", STATE_TONE[lifecycle.state])}>
          {STATE_LABEL[lifecycle.state]}
        </span>
        {carried && <Badge variant="outline">Carried from {formatDateKeyLong(trade.dateKey)}</Badge>}
        <div className="ml-auto flex items-center gap-1">
          {editable && trade.actualEntry == null && lifecycle.state !== "CANCELLED" && (
            <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setCancelling((v) => !v)}>
              <Ban className="size-3.5" />
              Cancel idea
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            nativeButton={false}
            render={<Link href={`/journal/${trade.dateKey}/trades/${trade.id}`} />}
          >
            <ExternalLink className="size-3.5" />
            Journal
          </Button>
        </div>
      </header>

      {cancelling && (
        <div className="space-y-2 border-b border-border bg-background/40 px-4 py-3">
          <p className="text-sm">Cancel this idea? It stays a trade in your record as &quot;cancelled / never triggered&quot;.</p>
          <Textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason (optional)" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setCancelling(false)} disabled={pending}>
              Keep idea
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={cancelIdea} disabled={pending}>
              Cancel idea
            </Button>
          </div>
        </div>
      )}

      <nav aria-label="Trade stages" className="overflow-x-auto border-b border-border">
        <ol className="flex min-w-max">
          {STAGES.map((s, i) => {
            const st = lifecycle.stages[s.key];
            const isActive = active === s.key;
            return (
              <li key={s.key} className="flex items-stretch">
                <button
                  type="button"
                  disabled={!st.available}
                  onClick={() => setOpen(s.key)}
                  aria-current={isActive ? "step" : undefined}
                  title={st.lockedReason ?? undefined}
                  className={cn(
                    "flex min-w-[150px] flex-col items-start gap-0.5 border-b-2 px-4 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    isActive ? "border-primary bg-primary/5" : "border-transparent hover:bg-accent",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                    {s.label}
                    {!st.available ? (
                      <Lock className="size-3" />
                    ) : st.done ? (
                      <Check className="size-3.5 text-success" />
                    ) : lifecycle.primaryStage === s.key ? (
                      <span className="size-1.5 rounded-full bg-primary" />
                    ) : null}
                  </span>
                  <span className="max-w-[200px] truncate text-[11px] text-muted-foreground">
                    {st.available ? stageSummary(s.key, trade, lifecycle, facts) : st.lockedReason}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <p className="flex items-center gap-2 px-4 pt-3 text-xs">
        <span className="font-mono tracking-wider text-muted-foreground uppercase">Waiting for</span>
        <span className="font-medium">{lifecycle.waitingFor}</span>
      </p>

      <div className="p-4">
        {active === "idea" && (
          <IdeaStage
            trade={trade}
            strategies={strategies}
            analysisFor={analysisFor}
            plan={plan}
            loggedBeforeReady={loggedBeforeReady}
            limitOverrideReason={facts?.limitOverrideReason ?? null}
          />
        )}
        {active === "plan" && <PlanStage trade={trade} analysis={analysisFor(trade.assetSymbol)} />}
        {active === "execution" && (
          <ExecutionStage
            trade={trade}
            facts={facts}
            usage={usage}
            limits={limits}
            propFirmAccounts={propFirmAccounts}
            executions={executions}
          />
        )}
        {active === "review" && <TradeReviewSection trade={trade} />}
      </div>
    </section>
  );
}
