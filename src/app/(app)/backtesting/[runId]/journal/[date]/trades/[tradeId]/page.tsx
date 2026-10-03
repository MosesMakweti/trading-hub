import { notFound } from "next/navigation";

import { loadOwnedRun } from "../../../../load-run";
import { isValidDateKey, utcDateToKey } from "@/lib/date";
import { runInBacktestRun } from "@/server/services/backtest-run.service";
import { getTrade } from "@/server/services/trades.service";
import { getDailyMarketContextForAsset } from "@/server/services/daily-asset-analysis.service";
import { toTradeWorkspaceDTO } from "@/server/services/trade-workspace.mapper";
import { FadeIn } from "@/components/shared/motion";
import { TradeWorkspace } from "@/components/journal/workspace/trade-workspace";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";

/** A simulated trade's full record (idea, plan + screenshots, execution,
 *  review) — the live Trade Workspace, read-only, inside the run's scope. A
 *  trade from another run, a live trade or another user's id is simply not
 *  found in this scope. */
export default async function BacktestJournalTradePage({
  params,
}: {
  params: Promise<{ runId: string; date: string; tradeId: string }>;
}) {
  const { runId, date: dateKey, tradeId } = await params;
  if (!isValidDateKey(dateKey)) notFound();
  const { user, run } = await loadOwnedRun(runId);

  const loaded = await runInBacktestRun(user.id, run.id, async () => {
    const trade = await getTrade(user.id, tradeId);
    if (!trade || utcDateToKey(trade.tradeDate) !== dateKey) return null;
    const dailyMarketContext = await getDailyMarketContextForAsset(user.id, dateKey, trade.assetSymbol);
    return { trade: toTradeWorkspaceDTO(trade), dailyMarketContext };
  });
  if (!loaded) notFound();

  return (
    <FadeIn>
      <WorkspaceProvider value={{ environment: "BACKTEST", runId: run.id }}>
        <TradeWorkspace
          trade={loaded.trade}
          editable={false}
          dailyMarketContext={loaded.dailyMarketContext}
          backHref={`/backtesting/${run.id}/journal/${dateKey}`}
          editHref={null}
          reviewVariant="legacy"
        />
      </WorkspaceProvider>
    </FadeIn>
  );
}
