import type { TradeFormValues } from "@/lib/validation/trades";
import type { TradeWithWorkspaceRelations } from "@/server/services/trades.service";

/**
 * A stored trade → the complete TradeInput-shaped values `updateTrade`
 * expects, carrying EVERY persisted field `updateTrade` rewrites. Shared by
 * the Journal "Edit trade" page and the Today V3 idea editor, so a re-save
 * can never silently clear a field the editing surface simply didn't show.
 *
 * (Before this existed, the Journal edit page omitted the Setup Validation
 * fields and the pre-trade mood, so saving that page wiped the mood snapshot
 * and — before entry — the setup validation.)
 *
 * `propFirmExecutions` is deliberately omitted: updateTrade treats an absent
 * (empty) list as "not provided", and those executions are managed only
 * through their own actions.
 */
export function tradeToFormValues(trade: TradeWithWorkspaceRelations): TradeFormValues {
  const performanceAllocation = trade.allocations.find((a) => a.tradingAccount.kind === "PERFORMANCE");
  const participatingAllocations = trade.allocations.filter((a) => a.tradingAccount.kind !== "PERFORMANCE");

  return {
    strategyId: trade.strategyId ?? "",
    assetSymbol: trade.assetSymbol,
    executionMinutes: trade.executionMinutes,
    direction: trade.direction,
    higherTimeframeBias: trade.higherTimeframeBias,
    biasConfidencePercent: trade.biasConfidencePercent,
    selectedSession: trade.selectedSession ?? null,
    expectedRR: trade.expectedRR ? trade.expectedRR.toNumber() : null,
    actualRR: trade.actualRR ? trade.actualRR.toNumber() : null,
    performanceRiskPercentOverride: performanceAllocation ? performanceAllocation.riskValue.toNumber() : null,
    psychPreTradeMindset: trade.psychPreTradeMindset,
    psychPostTradeReflection: trade.psychPostTradeReflection,
    psychLessonsLearned: trade.psychLessonsLearned,
    psychWhatToWorkOn: trade.psychWhatToWorkOn,
    allocations: participatingAllocations.map((a) => ({
      tradingAccountId: a.tradingAccountId,
      riskInputType: a.riskInputType,
      riskValue: a.riskValue.toNumber(),
      // Non-Performance allocations are always trader-entered — 0 is a safe
      // fallback (the Performance allocation is the only one with null PnL).
      closingPnlGross: a.closingPnlGross?.toNumber() ?? 0,
      closingPnlNet: a.closingPnlNet?.toNumber() ?? 0,
    })),
    // SOT: selections are stored by name (from the chosen strategy).
    selectedConfluences: (trade.selectedConfluences as string[] | null) ?? [],
    selectedExecution: (trade.selectedExecution as string[] | null) ?? [],
    selectedEntryModel: trade.selectedEntryModel,
    psychologyAnswers: (trade.psychology?.answers as Record<string, string | number>) ?? {},
    // Setup Validation shield — re-validated server-side on save until the
    // trade has an actual entry, then ignored (frozen).
    setupTypeId: trade.setupTypeId,
    selectedSetupConditions: (trade.selectedSetupConditions as string[] | null) ?? [],
    setupOverrideReason: trade.overrideReason,
    setupOverrideNote: trade.overrideNote,
    preTradeMoodTags: trade.preTradeMoodTags,
    preTradeMoodIntensity: trade.preTradeMoodIntensity,
    preTradeMoodNote: trade.preTradeMoodNote,
  };
}
