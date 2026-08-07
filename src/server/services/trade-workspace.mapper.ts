import { utcDateToKey } from "@/lib/date";
import { executedAtFromTrade } from "@/domain/trades/lifecycle";
import { executionSnapshot, resolveSelectedTags } from "@/server/services/selected-tags";
import type { TradeWithWorkspaceRelations } from "@/server/services/trades.service";
import type { TradeWorkspaceDTO } from "@/types/trades";

/**
 * Maps a fully-included Trade row to the Trade Workspace DTO. Shared by the trade
 * workspace page and the Today workspace so both render the exact same case-file
 * sections. `tradeNumber` and `status` are persisted columns (no derivation).
 */
export function toTradeWorkspaceDTO(trade: TradeWithWorkspaceRelations): TradeWorkspaceDTO {
  const performance = trade.allocations.find((a) => a.tradingAccount.kind === "PERFORMANCE");

  // SOT: selections are stored by name on the trade and colored from the frozen
  // strategy snapshot; pre-SOT trades fall back to the legacy global-checklist join.
  const snapshot = executionSnapshot(trade.strategyExecutionSnapshot);
  const sessionName = trade.selectedSession ?? trade.session?.name ?? null;
  const sessionColor =
    (sessionName &&
      (snapshot.sessions?.find((s) => s.name.toLowerCase() === sessionName.toLowerCase())
        ?.color as TradeWorkspaceDTO["sessionColor"])) ||
    null;

  // Of the confluences that were missing at save time, which were mandatory (for
  // the "Invalid Setup" state) — derived from the frozen snapshot's core flags.
  const missing = (trade.missingConfluences as string[] | null) ?? [];
  const mandatoryNames = new Set(
    (snapshot.confluences ?? []).filter((c) => c.mandatory).map((c) => c.name.toLowerCase()),
  );
  const missingMandatory = missing.filter((n) => mandatoryNames.has(n.toLowerCase()));

  return {
    id: trade.id,
    dateKey: utcDateToKey(trade.tradeDate),
    tradeNumber: trade.tradeNumber ?? 0,
    // SOT: prefer the market symbol / session name frozen on the trade; fall back
    // to the legacy Asset/Session FKs for pre-SOT trades.
    assetSymbol: trade.assetSymbol ?? trade.asset.symbol,
    assetLabel: trade.asset.label,
    direction: trade.direction,
    executionMinutes: trade.executionMinutes,
    sessionName,
    sessionColor,
    higherTimeframeBias: trade.higherTimeframeBias,
    biasConfidencePercent: trade.biasConfidencePercent,
    expectedRR: trade.expectedRR.toNumber(),
    actualRR: trade.actualRR ? trade.actualRR.toNumber() : null,
    hitTP1: trade.hitTP1,
    hitTP2: trade.hitTP2,
    hitTP3: trade.hitTP3,
    hitFullTP: trade.hitFullTP,
    entryModelNames: trade.entryModels.map((m) => m.entryModel.name),
    // Only link to the strategy while it still exists (not soft-deleted); the
    // name/version always come from the snapshot.
    strategyId: trade.strategy && !trade.strategy.deletedAt ? trade.strategy.id : null,
    strategyName: trade.strategyNameSnapshot,
    strategyVersion: trade.strategyVersionSnapshot,
    confluenceLabels: resolveSelectedTags(
      trade.selectedConfluences,
      snapshot.confluences,
      trade.checklistSelections
        .filter((c) => c.checklistItem.type === "CONFLUENCE")
        .map((c) => c.checklistItem.label),
    ),
    executionLabels: resolveSelectedTags(
      trade.selectedExecution,
      snapshot.execution,
      trade.checklistSelections
        .filter((c) => c.checklistItem.type === "EXECUTION_CONFIRMATION")
        .map((c) => c.checklistItem.label),
    ),
    confluencePercent: trade.confluencePercent,
    executionPercent: trade.executionPercent,
    tradeQualityPercent: trade.tradeQualityPercent,
    setupScore: trade.setupScore,
    setupRating: trade.setupRating as TradeWorkspaceDTO["setupRating"],
    setupValid: trade.setupValid,
    missingMandatory,
    accounts: trade.allocations.map((a) => ({
      name: a.tradingAccount.name,
      kind: a.tradingAccount.kind as TradeWorkspaceDTO["accounts"][number]["kind"],
      riskInputType: a.riskInputType,
      riskValue: a.riskValue.toNumber(),
      closingPnlGross: a.closingPnlGross.toNumber(),
      closingPnlNet: a.closingPnlNet.toNumber(),
    })),
    performancePnlGross: performance?.closingPnlGross.toNumber() ?? 0,
    performancePnlNet: performance?.closingPnlNet.toNumber() ?? 0,
    preTradeNotes: trade.psychPreTradeMindset,
    postTradeReflection: trade.psychPostTradeReflection,
    lessonsLearned: trade.psychLessonsLearned,
    whatToWorkOn: trade.psychWhatToWorkOn,
    plannedEntry: trade.plannedEntry ? trade.plannedEntry.toNumber() : null,
    plannedStopLoss: trade.plannedStopLoss ? trade.plannedStopLoss.toNumber() : null,
    plannedTarget: trade.plannedTarget ? trade.plannedTarget.toNumber() : null,
    marketContext: trade.marketContext,
    areasOfInterest: trade.areasOfInterest,
    reasonForTrade: trade.reasonForTrade,
    actualEntry: trade.actualEntry ? trade.actualEntry.toNumber() : null,
    actualExit: trade.actualExit ? trade.actualExit.toNumber() : null,
    executionNotes: trade.executionNotes,
    whatWentWell: trade.whatWentWell,
    whatWentWrong: trade.whatWentWrong,
    whatSurprisedMe: trade.whatSurprisedMe,
    wouldTakeAgain: trade.wouldTakeAgain,
    psychology: trade.psychology
      ? {
          rawScore: trade.psychology.rawScore,
          percent: trade.psychology.psychologyPercent,
          grade: trade.psychology.grade,
        }
      : null,
    images: trade.images.map((img) => ({ id: img.id, category: img.category, url: img.url })),
    adherenceAnswers: (trade.adherenceAnswers as Record<string, boolean> | null) ?? {},
    adherencePercent: trade.adherencePercent,
    status: trade.status,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
    executedAt: executedAtFromTrade(trade.tradeDate, trade.executionMinutes).toISOString(),
    closedAt: trade.closedAt?.toISOString() ?? null,
    reviewedAt: trade.reviewedAt?.toISOString() ?? null,
  };
}
