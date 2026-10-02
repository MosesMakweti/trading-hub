import { prisma } from "@/server/db";
import { tiptapToPlainText } from "@/lib/tiptap-text";
import { getPerformanceConfig } from "@/server/services/performance-account.service";
import type { TodaysRulesDTO, TodaysRulesStrategyDTO } from "@/types/today";

/**
 * Today V3 (Phase 1) — "Today's Rules" source data. Read-only: loads what
 * Strategy Lab and the Performance Account already know for today's active
 * strategies (DailyAssetAnalysis.activeStrategyId). It never writes the day;
 * suggestions are computed from this by domain/today/rule-suggestions.ts and
 * only an explicit confirm stores TradingDay.riskBudgetPercent /
 * maxTradesPerDay. Strategy rows are not workspace-scoped, so this is the
 * same in LIVE and BACKTEST.
 */
export async function getTodaysRules(userId: string, strategyIds: string[]): Promise<TodaysRulesDTO> {
  const ids = Array.from(new Set(strategyIds));
  const [strategies, performance] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : prisma.strategy.findMany({
          where: { id: { in: ids }, userId },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            name: true,
            sessions: {
              where: { deletedAt: null, enabled: true },
              orderBy: { sortOrder: "asc" },
              select: { name: true },
            },
            tradeManagement: {
              select: {
                maxDailyRiskPercent: true,
                maxTradesPerDay: true,
                maxRiskPercent: true,
                maxHoldingTime: true,
                initialStopPlacement: true,
                breakEvenRules: true,
                trailingStopRules: true,
                scalingInRules: true,
                scalingOutRules: true,
                partialTakeProfits: {
                  where: { deletedAt: null },
                  orderBy: { sortOrder: "asc" },
                  select: { trigger: true, percentToClose: true, reason: true },
                },
                customRules: {
                  where: { deletedAt: null },
                  orderBy: { sortOrder: "asc" },
                  select: { text: true },
                },
              },
            },
          },
        }),
    getPerformanceConfig(userId),
  ]);

  const text = (doc: unknown) => {
    const t = tiptapToPlainText(doc, 280).trim();
    return t === "" ? null : t;
  };

  return {
    strategies: strategies.map(
      (s): TodaysRulesStrategyDTO => ({
        id: s.id,
        name: s.name,
        sessions: s.sessions.map((x) => x.name),
        maxDailyRiskPercent: s.tradeManagement?.maxDailyRiskPercent ?? null,
        maxTradesPerDay: s.tradeManagement?.maxTradesPerDay ?? null,
        maxRiskPercent: s.tradeManagement?.maxRiskPercent ? s.tradeManagement.maxRiskPercent.toNumber() : null,
        management: {
          partialTakeProfits: (s.tradeManagement?.partialTakeProfits ?? []).map((p) => ({
            trigger: p.trigger,
            percentToClose: p.percentToClose ? p.percentToClose.toNumber() : null,
            reason: p.reason,
          })),
          initialStopPlacement: text(s.tradeManagement?.initialStopPlacement),
          breakEven: text(s.tradeManagement?.breakEvenRules),
          trailing: text(s.tradeManagement?.trailingStopRules),
          scalingIn: text(s.tradeManagement?.scalingInRules),
          scalingOut: text(s.tradeManagement?.scalingOutRules),
          maxHoldingTime: s.tradeManagement?.maxHoldingTime ?? null,
          customRules: (s.tradeManagement?.customRules ?? []).map((r) => r.text),
        },
      }),
    ),
    performance: {
      defaultRiskPercent: performance.defaultRiskPercent.toNumber(),
      maxRiskPercent: performance.maxRiskPercent ? performance.maxRiskPercent.toNumber() : null,
    },
  };
}

export interface PlanningReferenceDTO {
  entryModel: { name: string; stopPlacement: string | null; targetLogic: string | null; invalidation: string | null } | null;
  timeframes: string[];
  strategy: TodaysRulesStrategyDTO | null;
}

/**
 * Today V3 (Phase 2) — what the Plan stage shows beside the levels so the
 * trader never hunts through Strategy Lab: the chosen entry model's stop
 * placement / target logic / invalidation, the strategy's timeframes (as
 * suggestions), and its management rules + partial TPs. Read-only; nothing
 * is copied onto the trade.
 */
export async function getPlanningReference(
  userId: string,
  strategyId: string,
  entryModelName: string | null,
): Promise<PlanningReferenceDTO> {
  const [rules, entryModel, timeframes] = await Promise.all([
    getTodaysRules(userId, [strategyId]),
    entryModelName
      ? prisma.strategyEntryModel.findFirst({
          where: { name: entryModelName, deletedAt: null, strategy: { id: strategyId, userId } },
          select: { name: true, stopPlacement: true, targetLogic: true, invalidation: true },
        })
      : Promise.resolve(null),
    prisma.strategyTimeframe.findMany({
      where: { strategyId, deletedAt: null, strategy: { userId } },
      orderBy: { sortOrder: "asc" },
      select: { name: true },
    }),
  ]);
  const text = (doc: unknown) => {
    const t = tiptapToPlainText(doc, 400).trim();
    return t === "" ? null : t;
  };
  return {
    entryModel: entryModel
      ? {
          name: entryModel.name,
          stopPlacement: text(entryModel.stopPlacement),
          targetLogic: text(entryModel.targetLogic),
          invalidation: text(entryModel.invalidation),
        }
      : null,
    timeframes: timeframes.map((t) => t.name),
    strategy: rules.strategies[0] ?? null,
  };
}
