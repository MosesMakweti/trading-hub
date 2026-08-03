import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getTrade } from "@/server/services/trades.service";
import { toTradeWorkspaceDTO } from "@/server/services/trade-workspace.mapper";
import { isValidDateKey } from "@/lib/date";
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

  return (
    <FadeIn>
      <TradeWorkspace trade={toTradeWorkspaceDTO(trade)} />
    </FadeIn>
  );
}
