import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getTrade } from "@/server/services/trades.service";
import { getTradingDay } from "@/server/services/trading-day.service";
import { toTradeWorkspaceDTO } from "@/server/services/trade-workspace.mapper";
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

  const day = await getTradingDay(user.id, dateKey);

  return (
    <FadeIn>
      <TradeWorkspace trade={toTradeWorkspaceDTO(trade)} editable={isDayEditable(day)} />
    </FadeIn>
  );
}
