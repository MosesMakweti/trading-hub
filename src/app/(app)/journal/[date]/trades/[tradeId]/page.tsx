import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getTrade, getTradeOrdinal } from "@/server/services/trades.service";
import { isValidDateKey, utcDateToKey } from "@/lib/date";
import { FadeIn } from "@/components/shared/motion";
import { TradeWorkspace } from "@/components/journal/workspace/trade-workspace";
import type { TradeStatus, TradeWorkspaceDTO } from "@/types/trades";

export default async function TradeWorkspacePage({
  params,
}: {
  params: Promise<{ date: string; tradeId: string }>;
}) {
  const { date: dateKey, tradeId } = await params;
  if (!isValidDateKey(dateKey)) notFound();

  const user = await requireUser();
  const trade = await getTrade(user.id, tradeId);
  if (!trade) notFound();

  const tradeNumber = await getTradeOrdinal(user.id, trade.createdAt);

  const performance = trade.allocations.find((a) => a.tradingAccount.kind === "PERFORMANCE");
  const actualRR = trade.actualRR ? trade.actualRR.toNumber() : null;

  // Derived lifecycle status (no DB status column in Phase 1).
  const hasReview = Boolean(
    trade.psychPostTradeReflection || trade.psychLessonsLearned || trade.psychWhatToWorkOn,
  );
  const status: TradeStatus =
    actualRR != null ? (hasReview ? "REVIEWED" : "CLOSED") : "OPEN";

  const dto: TradeWorkspaceDTO = {
    id: trade.id,
    dateKey: utcDateToKey(trade.tradeDate),
    tradeNumber,
    assetSymbol: trade.asset.symbol,
    assetLabel: trade.asset.label,
    direction: trade.direction,
    executionMinutes: trade.executionMinutes,
    sessionName: trade.session?.name ?? null,
    higherTimeframeBias: trade.higherTimeframeBias,
    biasConfidencePercent: trade.biasConfidencePercent,
    expectedRR: trade.expectedRR.toNumber(),
    actualRR,
    hitTP1: trade.hitTP1,
    hitTP2: trade.hitTP2,
    hitTP3: trade.hitTP3,
    hitFullTP: trade.hitFullTP,
    entryModelNames: trade.entryModels.map((m) => m.entryModel.name),
    confluenceLabels: trade.checklistSelections
      .filter((c) => c.checklistItem.type === "CONFLUENCE")
      .map((c) => c.checklistItem.label),
    executionLabels: trade.checklistSelections
      .filter((c) => c.checklistItem.type === "EXECUTION_CONFIRMATION")
      .map((c) => c.checklistItem.label),
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
    psychology: trade.psychology
      ? {
          rawScore: trade.psychology.rawScore,
          percent: trade.psychology.psychologyPercent,
          grade: trade.psychology.grade,
        }
      : null,
    images: trade.images.map((img) => ({ id: img.id, category: img.category, url: img.url })),
    status,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
  };

  return (
    <FadeIn>
      <TradeWorkspace trade={dto} />
    </FadeIn>
  );
}
