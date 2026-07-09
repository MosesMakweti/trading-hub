import { getTradingPlan } from "@/server/services/trading-plan.service";
import { getDailyNote } from "@/server/services/journal.service";
import { listRecentTrades, listTradesForDay } from "@/server/services/trades.service";
import { getAnalyticsData } from "@/server/services/analytics.service";
import {
  getAccountBalance,
  listTradingAccounts,
} from "@/server/services/accounts.service";
import { listTradingSessions } from "@/server/services/trading-sessions.service";
import { computeBrokerageMetrics, computePropFirmRoi } from "@/domain/accounts/derived";
import { localDateToKey } from "@/lib/date";

// Practically "the beginning of the app's history" — used as the lower
// bound for an all-time analytics window on the dashboard.
const EPOCH_DATE_KEY = "2000-01-01";

export interface BestAccountSummary {
  name: string;
  kind: "PROP_FIRM" | "PERSONAL_BROKERAGE";
  returnPercent: number;
}

export async function getDashboardData(userId: string) {
  const todayKey = localDateToKey(new Date());

  const [plan, todayNote, todayTrades, recentTrades, sessions, otherAccounts] = await Promise.all([
    getTradingPlan(userId),
    getDailyNote(userId, todayKey),
    listTradesForDay(userId, todayKey),
    listRecentTrades(userId, 5),
    listTradingSessions(userId),
    listTradingAccounts(userId),
  ]);

  const analytics = await getAnalyticsData(userId, EPOCH_DATE_KEY, todayKey);

  let bestAccount: BestAccountSummary | null = null;
  for (const account of otherAccounts) {
    let returnPercent: number | null = null;
    if (account.kind === "PROP_FIRM") {
      returnPercent = computePropFirmRoi(
        account.purchaseCost?.toNumber() ?? null,
        account.totalPayouts?.toNumber() ?? null,
      );
    } else {
      const currentBalance = await getAccountBalance(account.id);
      returnPercent = computeBrokerageMetrics({
        startingBalance: account.startingBalance?.toNumber() ?? null,
        currentBalance,
        totalWithdrawals: account.totalWithdrawals?.toNumber() ?? null,
        totalDeposits: account.totalDeposits?.toNumber() ?? null,
      }).totalReturnPercent;
    }
    if (returnPercent !== null && (!bestAccount || returnPercent > bestAccount.returnPercent)) {
      bestAccount = {
        name: account.name,
        kind: account.kind as "PROP_FIRM" | "PERSONAL_BROKERAGE",
        returnPercent,
      };
    }
  }

  const bestAsset = analytics.trading.statsByAsset[0] ?? null;

  return {
    todayKey,
    plan,
    todayNote,
    todayTrades,
    recentTrades,
    sessions,
    bestAccount,
    bestAsset,
    winRate: analytics.trading.winRate,
    equityCurve: analytics.trading.equityCurve,
    totalTrades: analytics.trading.totalTrades,
  };
}
