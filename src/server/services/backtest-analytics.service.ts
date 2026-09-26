import { prisma } from "@/server/db";
import { getCanonicalAnalyticsDataset } from "@/server/services/analytics-canonical.service";
import { runInBacktestRun } from "@/server/services/backtest-run.service";
import { summarizeBacktestRun, type BacktestAnalyticsSummary } from "@/domain/backtesting/backtest-analytics";

/**
 * Backtesting Analytics (Stage 6) — exactly one run's dataset, loaded with the
 * SAME canonical loader as live Analytics (one batched trade query + nested
 * includes, inside the run's scope, so the extension restricts it to the run),
 * plus one opportunities query. All math is the pure canonical engine
 * (domain/backtesting/backtest-analytics.ts). Ownership is verified by
 * runInBacktestRun; nothing is filtered client-side.
 */
export async function getBacktestAnalytics(userId: string, runId: string): Promise<BacktestAnalyticsSummary> {
  return runInBacktestRun(userId, runId, async (run) => {
    const [rows, opportunities] = await Promise.all([
      getCanonicalAnalyticsDataset(userId, {}),
      prisma.tradeOpportunity.findMany({
        where: { userId },
        select: { status: true, setupValid: true, missReason: true, missedOutcome: true, missedRealizedR: true },
      }),
    ]);
    return summarizeBacktestRun(
      rows,
      opportunities.map((o) => ({ ...o, missedRealizedR: o.missedRealizedR?.toNumber() ?? null })),
      {
        startingBalance: run.startingBalance?.toNumber() ?? null,
        riskPercentPerTrade: run.riskPercentPerTrade?.toNumber() ?? null,
        currency: run.currency,
      },
    );
  });
}
