import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getTrade, getTradeFormOptions } from "@/server/services/trades.service";
import { isValidDateKey, formatDateKeyLong } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { TradeForm } from "@/components/journal/trade-form";
import type { TradeFormValues } from "@/lib/validation/trades";

export default async function EditTradePage({
  params,
}: {
  params: Promise<{ date: string; tradeId: string }>;
}) {
  const { date: dateKey, tradeId } = await params;
  if (!isValidDateKey(dateKey)) notFound();

  const user = await requireUser();
  const [trade, options] = await Promise.all([
    getTrade(user.id, tradeId),
    getTradeFormOptions(user.id),
  ]);
  if (!trade) notFound();

  const { accounts, assets, sessions, entryModels, confluenceItems, executionItems, strategies } =
    options;

  const performanceAllocation = trade.allocations.find(
    (a) => a.tradingAccount.kind === "PERFORMANCE",
  );
  const participatingAllocations = trade.allocations.filter(
    (a) => a.tradingAccount.kind !== "PERFORMANCE",
  );

  const defaultValues: TradeFormValues = {
    assetId: trade.assetId,
    executionMinutes: trade.executionMinutes,
    direction: trade.direction,
    higherTimeframeBias: trade.higherTimeframeBias,
    biasConfidencePercent: trade.biasConfidencePercent,
    sessionId: trade.sessionId,
    strategyId: trade.strategyId,
    expectedRR: trade.expectedRR.toNumber(),
    actualRR: trade.actualRR ? trade.actualRR.toNumber() : null,
    performanceClosingPnlGross: performanceAllocation?.closingPnlGross.toNumber() ?? 0,
    performanceClosingPnlNet: performanceAllocation?.closingPnlNet.toNumber() ?? 0,
    hitTP1: trade.hitTP1,
    hitTP2: trade.hitTP2,
    hitTP3: trade.hitTP3,
    hitFullTP: trade.hitFullTP,
    psychPreTradeMindset: trade.psychPreTradeMindset,
    psychPostTradeReflection: trade.psychPostTradeReflection,
    psychLessonsLearned: trade.psychLessonsLearned,
    psychWhatToWorkOn: trade.psychWhatToWorkOn,
    allocations: participatingAllocations.map((a) => ({
      tradingAccountId: a.tradingAccountId,
      riskInputType: a.riskInputType,
      riskValue: a.riskValue.toNumber(),
    })),
    checklistItemIds: trade.checklistSelections.map((c) => c.checklistItemId),
    entryModelIds: trade.entryModels.map((m) => m.entryModelId),
    psychologyAnswers: (trade.psychology?.answers as Record<string, string | number>) ?? {},
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to trade workspace"
          nativeButton={false}
          render={<Link href={`/journal/${dateKey}/trades/${tradeId}`} />}
        >
          <ChevronLeft />
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">
          Edit Trade — {formatDateKeyLong(dateKey)}
        </h1>
      </div>

      <TradeForm
        dateKey={dateKey}
        mode="edit"
        tradeId={tradeId}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind }))}
        assets={assets.map((a) => ({ id: a.id, symbol: a.symbol, label: a.label }))}
        sessions={sessions.map((s) => ({ id: s.id, name: s.name }))}
        entryModels={entryModels.map((m) => ({ id: m.id, name: m.name }))}
        confluenceItems={confluenceItems.map((c) => ({ id: c.id, label: c.label }))}
        executionItems={executionItems.map((c) => ({ id: c.id, label: c.label }))}
        strategies={strategies.map((s) => ({ id: s.id, name: s.name, version: s.version }))}
        defaultValues={defaultValues}
      />
    </div>
  );
}
