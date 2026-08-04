"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpenCheck,
  CandlestickChart,
  ClipboardList,
  FlagOff,
  Lightbulb,
  Loader2,
  Lock,
  Sunrise,
  Zap,
} from "lucide-react";

import { formatDateKeyLong } from "@/lib/date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { endDay, reopenDay } from "@/actions/today.actions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { MorningPrepSection } from "@/components/today/morning-prep-section";
import { TodaysPlanSection } from "@/components/today/todays-plan-section";
import { DailyAnalyticsSection } from "@/components/today/daily-analytics-section";
import { TodayTradeBar } from "@/components/today/today-trade-bar";
import { TradeIdeaSection } from "@/components/journal/workspace/trade-idea-section";
import { TradeExecutionSection } from "@/components/journal/workspace/trade-execution-section";
import { TradeReviewSection } from "@/components/journal/workspace/trade-review-section";
import {
  WorkflowProgress,
  WORKFLOW_STEP_META,
  type WorkflowStep,
} from "@/components/dashboard/workflow-progress";
import type { WorkflowStepKey, WorkflowStepStatus } from "@/domain/today/workflow";
import type { DailyAnalyticsDTO, MorningPrepDTO, TodaysPlanDTO, TradingDayDTO } from "@/types/today";
import type { TradeWorkspaceDTO } from "@/types/trades";

// The Today workflow section tabs. All are live as of Phase 5 — each tab's real
// component is rendered in its TabsContent below.
const SECTIONS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "morning-prep", label: "Morning Prep", icon: Sunrise },
  { value: "todays-plan", label: "Today's Plan", icon: ClipboardList },
  { value: "trade-idea", label: "Trade Idea", icon: Lightbulb },
  { value: "trade-execution", label: "Trade Execution", icon: Zap },
  { value: "trade-review", label: "Trade Review", icon: BookOpenCheck },
  { value: "daily-analytics", label: "Daily Analytics", icon: BarChart3 },
];

export function TodayWorkspace({
  day,
  stepStatuses,
  morningPrep,
  todaysPlan,
  trades,
  dailyAnalytics,
}: {
  day: TradingDayDTO;
  // Only serializable data crosses the server→client boundary; the icon-bearing
  // steps are rebuilt here from WORKFLOW_STEP_META (imported client-side).
  stepStatuses: { key: WorkflowStepKey; status: WorkflowStepStatus }[];
  morningPrep: MorningPrepDTO;
  todaysPlan: TodaysPlanDTO;
  trades: TradeWorkspaceDTO[];
  dailyAnalytics: DailyAnalyticsDTO;
}) {
  const router = useRouter();
  const [focusedId, setFocusedId] = useState<string | null>(trades[0]?.id ?? null);
  const focusedTrade = trades.find((t) => t.id === focusedId) ?? null;

  const isArchived = day.status === "ARCHIVED";
  const [archiving, startArchive] = useTransition();
  function toggleArchive() {
    startArchive(async () => {
      const result = isArchived ? await reopenDay(day.dateKey) : await endDay(day.dateKey);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(isArchived ? "Day reopened." : "Day ended — archived to your journal.");
      router.refresh();
    });
  }

  // The three trade tabs share one focused trade and render the *existing* Trade
  // Workspace sections for it — create/continue today's trades in-context.
  function tradeTab(section: "idea" | "execution" | "review") {
    return (
      <div className="space-y-4">
        <TodayTradeBar
          trades={trades}
          focusedId={focusedId}
          onFocus={setFocusedId}
          todayKey={day.dateKey}
        />
        {focusedTrade ? (
          section === "idea" ? (
            <TradeIdeaSection trade={focusedTrade} />
          ) : section === "execution" ? (
            <TradeExecutionSection trade={focusedTrade} />
          ) : (
            <TradeReviewSection trade={focusedTrade} />
          )
        ) : (
          <EmptyState
            icon={CandlestickChart}
            title="No trades logged today yet"
            description="Add a trade to plan it, record how it played out, and review it — all in today's flow."
          />
        )}
      </div>
    );
  }
  const statusByKey = new Map(stepStatuses.map((s) => [s.key, s.status]));
  const steps: WorkflowStep[] = WORKFLOW_STEP_META.map((m) => ({
    ...m,
    status: statusByKey.get(m.key) ?? "upcoming",
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Today</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatDateKeyLong(day.dateKey)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isArchived ? "secondary" : "success"}>
            {isArchived ? "Archived" : "Active"}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={toggleArchive}
            disabled={archiving}
          >
            {archiving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : isArchived ? (
              <FlagOff className="size-3.5" />
            ) : (
              <Lock className="size-3.5" />
            )}
            {isArchived ? "Reopen day" : "End day"}
          </Button>
        </div>
      </div>

      <WorkflowProgress steps={steps} title="Workflow" />

      <Tabs defaultValue={SECTIONS[0].value}>
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            {SECTIONS.map((s) => (
              <TabsTrigger key={s.value} value={s.value} className="gap-1.5">
                <s.icon className="size-3.5" />
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {SECTIONS.map((s) => (
          <TabsContent key={s.value} value={s.value} className="mt-4">
            {s.value === "morning-prep" ? (
              <MorningPrepSection dateKey={day.dateKey} prep={morningPrep} />
            ) : s.value === "todays-plan" ? (
              <TodaysPlanSection dateKey={day.dateKey} plan={todaysPlan} />
            ) : s.value === "trade-idea" ? (
              tradeTab("idea")
            ) : s.value === "trade-execution" ? (
              tradeTab("execution")
            ) : s.value === "trade-review" ? (
              tradeTab("review")
            ) : (
              <DailyAnalyticsSection dateKey={day.dateKey} analytics={dailyAnalytics} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
