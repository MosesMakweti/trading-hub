import { requireUser } from "@/server/guards";
import {
  archivePastActiveDays,
  getOrCreateTradingDay,
  toTradingDayDTO,
} from "@/server/services/trading-day.service";
import { getTradeFormOptions, listTradesForDay } from "@/server/services/trades.service";
import { toTradeWorkspaceDTO } from "@/server/services/trade-workspace.mapper";
import { getOrCreateDayRoutine } from "@/server/services/today-routine.service";
import { getDailyAnalytics } from "@/server/services/analytics.service";
import { listOpportunityDtosForDay } from "@/server/services/opportunity.service";
import { listActivePropFirmAccountsForSelector } from "@/server/services/prop-firms.service";
import { listExecutionsForTrades } from "@/server/services/trade-executions.service";
import { toAccountAllocationSelectorDTO, toExecutionDTO } from "@/server/services/prop-firms.mapper";
import { localDateToKey } from "@/lib/date";
import { deriveWorkflowSteps, type WorkflowDoneState } from "@/domain/today/workflow";
import { FadeIn } from "@/components/shared/motion";
import { TodayWorkspace } from "@/components/today/today-workspace";
import type { DailyAnalyticsDTO, TodaysPlanDTO } from "@/types/today";

export default async function TodayPage() {
  const user = await requireUser();
  const todayKey = localDateToKey(new Date());

  // Auto-archive on date rollover: finalize any still-active past day before
  // opening today (so it lands in the Journal).
  await archivePastActiveDays(user.id, todayKey);

  // Create the day once, THEN load everything else — passing the day into the
  // routine service avoids a second concurrent upsert racing the (userId, date) unique.
  const day = await getOrCreateTradingDay(user.id, todayKey);
  const [trades, routine, dailyPerf, propFirmAccountsRaw, tradeFormOptions, opportunities] = await Promise.all([
    listTradesForDay(user.id, todayKey),
    getOrCreateDayRoutine(user.id, day),
    getDailyAnalytics(user.id, todayKey),
    listActivePropFirmAccountsForSelector(user.id),
    getTradeFormOptions(user.id),
    listOpportunityDtosForDay(user.id, todayKey),
  ]);
  const executionsRaw = await listExecutionsForTrades(user.id, trades.map((t) => t.id));
  const executionsByTradeId: Record<string, ReturnType<typeof toExecutionDTO>[]> = {};
  for (const row of executionsRaw) {
    const dto = toExecutionDTO(row);
    (executionsByTradeId[dto.tradeId] ??= []).push(dto);
  }

  const dailyAnalytics: DailyAnalyticsDTO = { ...dailyPerf, analyzed: day.analyzedAt != null };

  const todaysPlan: TodaysPlanDTO = {
    bias: (day.bias as TodaysPlanDTO["bias"]) ?? null,
    conviction: day.conviction,
    keyLevels: day.keyLevels,
    riskBudgetPercent: day.riskBudgetPercent ? day.riskBudgetPercent.toNumber() : null,
    // Risk limits used to come from the Trading Plan; that's gone (Strategy Lab
    // owns trade management now). No reference limit until a later phase wires one.
    planRiskLimit: null,
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
        routine={routine}
        todaysPlan={todaysPlan}
        trades={trades.map(toTradeWorkspaceDTO)}
        dailyAnalytics={dailyAnalytics}
        propFirmAccounts={propFirmAccountsRaw.map(toAccountAllocationSelectorDTO)}
        executionsByTradeId={executionsByTradeId}
        tradeFormAccounts={tradeFormOptions.accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind }))}
        tradeFormStrategies={tradeFormOptions.strategies.map((s) => ({ id: s.id, name: s.name, version: s.version }))}
        opportunities={opportunities}
        linkableTrades={trades
          .filter((t) => t.opportunityId == null)
          .map((t) => ({
            id: t.id,
            tradeNumber: t.tradeNumber,
            assetSymbol: t.assetSymbol,
            direction: t.direction,
          }))}
      />
    </FadeIn>
  );
}
