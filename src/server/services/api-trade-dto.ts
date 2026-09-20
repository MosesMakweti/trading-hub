import { utcDateToKey } from "@/lib/date";
import type { TradeWithWorkspaceRelations } from "@/server/services/trades.service";

/**
 * TradingView Extension — Step 3 (docs/extension-api.md). A deliberately
 * minimal, explicit field selection for POST /api/v1/trades' response — not
 * the full Trade Workspace DTO the web app uses internally (which carries
 * psychology answers, snapshots, and other fields with no reason to leave
 * this system). Decimal fields are converted to numbers (matching the
 * convention `strategies.service.ts::getStrategyReference` already uses for
 * its own external-facing DTO).
 */
export function toApiTradeDTO(trade: TradeWithWorkspaceRelations) {
  return {
    id: trade.id,
    tradeNumber: trade.tradeNumber,
    dateKey: utcDateToKey(trade.tradeDate),
    assetSymbol: trade.assetSymbol,
    direction: trade.direction,
    timeframe: trade.timeframe,
    selectedSession: trade.selectedSession,
    strategyId: trade.strategyId,
    strategyName: trade.strategyNameSnapshot,
    selectedEntryModel: trade.selectedEntryModel,
    selectedConfluences: trade.selectedConfluences,
    selectedExecution: trade.selectedExecution,
    plannedEntry: trade.plannedEntry?.toNumber() ?? null,
    plannedStopLoss: trade.plannedStopLoss?.toNumber() ?? null,
    plannedTargets: trade.plannedTargets.map((t) => ({
      targetOrder: t.targetOrder,
      label: t.label,
      targetPrice: t.targetPrice.toNumber(),
      rMultiple: t.rMultiple?.toNumber() ?? null,
      plannedClosePercent: t.plannedClosePercent?.toNumber() ?? null,
    })),
    expectedRR: trade.expectedRR?.toNumber() ?? null,
    setupScore: trade.setupScore,
    setupRating: trade.setupRating,
    setupValid: trade.setupValid,
    confluencePercent: trade.confluencePercent,
    executionPercent: trade.executionPercent,
    hasPlanScreenshot: trade.planScreenshot != null,
    createdAt: trade.createdAt.toISOString(),
  };
}

export type ApiTradeDTO = ReturnType<typeof toApiTradeDTO>;
