import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getTrade, getTradeFormOptions } from "@/server/services/trades.service";
import { isValidDateKey, formatDateKeyLong } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { TradeForm } from "@/components/journal/trade-form";
import type { TradeFormValues } from "@/lib/validation/trades";
import { tradeToFormValues } from "@/server/services/trade-input.mapper";

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

  const { accounts, strategies } = options;

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

  // Shared mapper — carries every persisted field updateTrade rewrites (incl.
  // Setup Validation + pre-trade mood), so saving here never clears them.
  const defaultValues: TradeFormValues = tradeToFormValues(trade);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 gap-1.5 text-muted-foreground"
          nativeButton={false}
          render={<Link href={`/journal/${dateKey}/trades/${tradeId}`} />}
        >
          <ChevronLeft className="size-3.5" />
          Back to trade
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
        strategies={formStrategies}
        defaultValues={defaultValues}
        performanceRiskLocked={trade.actualEntry != null}
      />
    </div>
  );
}
