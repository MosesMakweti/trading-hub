import { requireUser } from "@/server/guards";
import { getOrCreateTradingDay, toTradingDayDTO } from "@/server/services/trading-day.service";
import { listTradesForDay } from "@/server/services/trades.service";
import { toTradeWorkspaceDTO } from "@/server/services/trade-workspace.mapper";
import { listChecklistItems } from "@/server/services/checklist-items.service";
import { listAssets } from "@/server/services/assets.service";
import { getTradingPlan } from "@/server/services/trading-plan.service";
import { getDailyAnalytics } from "@/server/services/analytics.service";
import { localDateToKey } from "@/lib/date";
import { deriveWorkflowSteps, type WorkflowDoneState } from "@/domain/today/workflow";
import { FadeIn } from "@/components/shared/motion";
import { TodayWorkspace } from "@/components/today/today-workspace";
import type { DailyAnalyticsDTO, MorningPrepDTO, TodaysPlanDTO } from "@/types/today";

export default async function TodayPage() {
  const user = await requireUser();
  const todayKey = localDateToKey(new Date());

  const [day, trades, routineItems, assets, plan, dailyPerf] = await Promise.all([
    getOrCreateTradingDay(user.id, todayKey),
    listTradesForDay(user.id, todayKey),
    listChecklistItems(user.id, "PRE_SESSION_ROUTINE"),
    listAssets(user.id),
    getTradingPlan(user.id),
    getDailyAnalytics(user.id, todayKey),
  ]);

  const dailyAnalytics: DailyAnalyticsDTO = { ...dailyPerf, analyzed: day.analyzedAt != null };

  const morningPrep: MorningPrepDTO = {
    routineItems: routineItems.map((i) => ({ id: i.id, label: i.label })),
    completedIds: (day.routineCompletion as string[] | null) ?? [],
    marketContext: day.marketContext,
    readiness: day.readiness,
    prepComplete: day.prepCompletedAt != null,
  };

  const todaysPlan: TodaysPlanDTO = {
    assets: assets.map((a) => ({ id: a.id, symbol: a.symbol, label: a.label })),
    bias: (day.bias as TodaysPlanDTO["bias"]) ?? null,
    conviction: day.conviction,
    watchlistFocus: (day.watchlistFocus as string[] | null) ?? [],
    keyLevels: day.keyLevels,
    riskBudgetPercent: day.riskBudgetPercent ? day.riskBudgetPercent.toNumber() : null,
    planRiskLimit: plan.maxDailyRiskPercent ? plan.maxDailyRiskPercent.toNumber() : null,
    planComplete: day.planCompletedAt != null,
  };

  // Prep/Plan/Analyze are owned by the TradingDay; Trade/Review are derived from
  // the day's trades. Feed both into the shared workflow state machine.
  const done: WorkflowDoneState = {
    prep: day.prepCompletedAt != null,
    plan: day.planCompletedAt != null,
    trade: trades.length > 0,
    review: trades.some((t) => t.reviewedAt != null),
    analyze: day.analyzedAt != null,
  };
  const stepStatuses = deriveWorkflowSteps(done);

  return (
    <FadeIn className="mx-auto max-w-5xl">
      <TodayWorkspace
        day={toTradingDayDTO(day)}
        stepStatuses={stepStatuses}
        morningPrep={morningPrep}
        todaysPlan={todaysPlan}
        trades={trades.map(toTradeWorkspaceDTO)}
        dailyAnalytics={dailyAnalytics}
      />
    </FadeIn>
  );
}
