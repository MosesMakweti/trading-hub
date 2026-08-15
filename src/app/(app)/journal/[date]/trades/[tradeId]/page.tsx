import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getTrade } from "@/server/services/trades.service";
import { getTradingDay } from "@/server/services/trading-day.service";
import { toTradeWorkspaceDTO } from "@/server/services/trade-workspace.mapper";
import { listActivePropFirmAccountsForSelector } from "@/server/services/prop-firms.service";
import { listExecutionsForTrade } from "@/server/services/trade-executions.service";
import { toAccountAllocationSelectorDTO, toExecutionDTO } from "@/server/services/prop-firms.mapper";
import { isValidDateKey } from "@/lib/date";
import { isDayEditable } from "@/domain/today/archive";
import { FadeIn } from "@/components/shared/motion";
import { TradeWorkspace } from "@/components/journal/workspace/trade-workspace";

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

  const [day, propFirmAccountsRaw, executionsRaw] = await Promise.all([
    getTradingDay(user.id, dateKey),
    listActivePropFirmAccountsForSelector(user.id),
    listExecutionsForTrade(user.id, tradeId),
  ]);

  return (
    <FadeIn>
      <TradeWorkspace
        trade={toTradeWorkspaceDTO(trade)}
        editable={isDayEditable(day)}
        propFirmAccounts={propFirmAccountsRaw.map(toAccountAllocationSelectorDTO)}
        executions={executionsRaw.map(toExecutionDTO)}
      />
    </FadeIn>
  );
}
