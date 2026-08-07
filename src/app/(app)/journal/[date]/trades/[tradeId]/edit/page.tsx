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

  const { accounts, entryModels, strategies } = options;

  // The options list is non-archived only; if this trade is still linked to a
  // strategy that's since been archived (or soft-deleted), add it back so the
  // selector shows the current link instead of appearing empty.
  const formStrategies: { id: string; name: string; version: number; archived?: boolean }[] =
    strategies.map((s) => ({ id: s.id, name: s.name, version: s.version }));
  if (trade.strategy && !formStrategies.some((s) => s.id === trade.strategy!.id)) {
    formStrategies.push({
      id: trade.strategy.id,
      name: trade.strategyNameSnapshot ?? trade.strategy.name,
      version: trade.strategyVersionSnapshot ?? trade.strategy.version,
      archived: true,
    });
  }

  const performanceAllocation = trade.allocations.find(
    (a) => a.tradingAccount.kind === "PERFORMANCE",
  );
  const participatingAllocations = trade.allocations.filter(
    (a) => a.tradingAccount.kind !== "PERFORMANCE",
  );

  const defaultValues: TradeFormValues = {
    // SOT: market + session come from the strategy; prefer the frozen values on the
    // trade, falling back to the legacy Asset/Session FKs for pre-SOT trades.
    strategyId: trade.strategyId ?? "",
    assetSymbol: trade.assetSymbol,
    executionMinutes: trade.executionMinutes,
    direction: trade.direction,
    higherTimeframeBias: trade.higherTimeframeBias,
    biasConfidencePercent: trade.biasConfidencePercent,
    selectedSession: trade.selectedSession ?? null,
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
    // SOT: selections are stored by name (from the chosen strategy). Old trades
    // predating the strategy-scoped model have no names yet — start empty; the
    // trader re-picks from the strategy's live confluences/execution on edit.
    selectedConfluences: (trade.selectedConfluences as string[] | null) ?? [],
    selectedExecution: (trade.selectedExecution as string[] | null) ?? [],
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
        entryModels={entryModels.map((m) => ({ id: m.id, name: m.name }))}
        strategies={formStrategies}
        defaultValues={defaultValues}
      />
    </div>
  );
}
