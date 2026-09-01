import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { TodayRiskSummary } from "@/server/services/dashboard.service";

function riskBar(usedPercent: number, budgetPercent: number | null) {
  if (budgetPercent == null || budgetPercent <= 0) return 0;
  return Math.max(0, Math.min(100, (usedPercent / budgetPercent) * 100));
}

export function TodayPanel({
  todayKey,
  prepCompletedAt,
  routineReadyAt,
  strategyName,
  risk,
}: {
  todayKey: string;
  prepCompletedAt: Date | null;
  routineReadyAt: Date | null;
  strategyName: string | null;
  risk: TodayRiskSummary;
}) {
  const usedBarPercent = riskBar(risk.riskUsedTodayPercent, risk.riskBudgetPercent);
  const overBudget = risk.riskRemainingPercent != null && risk.riskRemainingPercent < 0;

  return (
    <div className="glass space-y-3 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Today</h3>
        <Link href="/today" className="text-xs font-medium text-primary hover:underline">
          Open Today workspace →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-2.5 py-2">
          {prepCompletedAt ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-success" />
          ) : (
            <Circle className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className={prepCompletedAt ? "text-foreground" : "text-muted-foreground"}>Routine done</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-2.5 py-2">
          {routineReadyAt ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-success" />
          ) : (
            <Circle className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className={routineReadyAt ? "text-foreground" : "text-muted-foreground"}>Ready to trade</span>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background/40 px-2.5 py-2 text-xs">
        <div className="text-muted-foreground">Strategy</div>
        {strategyName ? (
          <Badge variant="outline" className="mt-1">
            {strategyName}
          </Badge>
        ) : (
          <div className="mt-1 text-muted-foreground/70">Not selected yet</div>
        )}
      </div>

      <div className="space-y-1.5 rounded-lg border border-border bg-background/40 px-2.5 py-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Daily risk</span>
          <span className="tabular-nums font-medium">
            {risk.riskUsedTodayPercent.toFixed(2)}% / {risk.riskBudgetPercent == null ? "—" : `${risk.riskBudgetPercent.toFixed(2)}%`}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", overBudget ? "bg-danger" : "bg-primary")}
            style={{ width: `${usedBarPercent}%` }}
          />
        </div>
        <div className={cn("text-xs", overBudget ? "text-danger" : "text-muted-foreground")}>
          {risk.riskRemainingPercent == null
            ? "No daily budget set"
            : `${risk.riskRemainingPercent >= 0 ? risk.riskRemainingPercent.toFixed(2) : `−${Math.abs(risk.riskRemainingPercent).toFixed(2)}`}% remaining`}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-2.5 py-2 text-xs">
        <span className="text-muted-foreground">Open exposure</span>
        <span className="tabular-nums font-medium">
          {risk.openExposurePercent.toFixed(2)}%{" "}
          <span className="text-muted-foreground">
            ({risk.openTradeCount} trade{risk.openTradeCount === 1 ? "" : "s"})
          </span>
        </span>
      </div>

      <Link href={`/journal/${todayKey}`} className="block text-center text-xs font-medium text-primary hover:underline">
        Open today&apos;s journal →
      </Link>
    </div>
  );
}
