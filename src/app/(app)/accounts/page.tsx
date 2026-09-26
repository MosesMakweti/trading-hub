import { requireUser } from "@/server/guards";
import {
  getAccountTrackRecord,
  getOrCreatePerformanceAccount,
  listTradingAccounts,
  PERFORMANCE_ACCOUNT_STARTING_BALANCE,
} from "@/server/services/accounts.service";
import { buildEquityCurve, dailyPercentsFromBalanceHistory } from "@/domain/performance/rr";
import { winRate as computeWinRate, profitFactor as computeProfitFactor } from "@/domain/performance/metrics";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { PerformanceAccountSection } from "@/components/accounts/performance-account-section";
import { AccountsView } from "@/components/accounts/accounts-view";
import { FadeIn } from "@/components/shared/motion";
import type { AccountTrackRecordEntryDTO, PerformanceAccountDTO, TradingAccountDTO } from "@/types/accounts";

function toNumber(value: { toNumber(): number } | null): number | null {
  return value ? value.toNumber() : null;
}

export default async function AccountsPage() {
  const user = await requireUser();

  const [performanceAccount, accountRows] = await Promise.all([
    getOrCreatePerformanceAccount(user.id),
    listTradingAccounts(user.id),
  ]);

  const [performanceTrackRecord, otherTrackRecords] = await Promise.all([
    getAccountTrackRecord(user.id, performanceAccount.id),
    Promise.all(accountRows.map((row) => getAccountTrackRecord(user.id, row.id))),
  ]);

  // Performance Account: equity curve + lightweight core stats. A pending
  // (Stage C: null) trade contributes 0 to the day's realized PnL — same
  // "aggregate vs per-trade display" split as accounts.service.ts.
  const perfByDay = new Map<string, number>();
  for (const e of performanceTrackRecord.entries) {
    perfByDay.set(e.dateKey, (perfByDay.get(e.dateKey) ?? 0) + (e.pnl ?? 0));
  }
  const perfDailyPercents = dailyPercentsFromBalanceHistory(
    PERFORMANCE_ACCOUNT_STARTING_BALANCE,
    Array.from(perfByDay.entries()).map(([dateKey, pnl]) => ({ dateKey, pnl })),
  );
  const equityCurve = buildEquityCurve(perfDailyPercents);

  // winRate/profitFactor are unit-agnostic ratios (sign + magnitude ratio),
  // so real dollar PnL plugs directly into the same tested domain functions
  // used for the R-multiple-based analytics elsewhere.
  const perfMetricInputs = performanceTrackRecord.entries.map((e) => ({
    dateKey: e.dateKey,
    assetSymbol: e.assetSymbol,
    actualRR: e.pnl,
  }));

  const netProfit = performanceTrackRecord.currentBalance - PERFORMANCE_ACCOUNT_STARTING_BALANCE;
  const performanceAccountDTO: PerformanceAccountDTO = {
    id: performanceAccount.id,
    name: performanceAccount.name,
    startingBalance: PERFORMANCE_ACCOUNT_STARTING_BALANCE,
    currentBalance: performanceTrackRecord.currentBalance,
    netProfit,
    totalReturnPercent: (netProfit / PERFORMANCE_ACCOUNT_STARTING_BALANCE) * 100,
    trackRecord: performanceTrackRecord.entries as AccountTrackRecordEntryDTO[],
  };

  const accounts: TradingAccountDTO[] = accountRows.map((row, i) => ({
    id: row.id,
    kind: row.kind as "PROP_FIRM" | "PERSONAL_BROKERAGE",
    name: row.name,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    currentBalance: otherTrackRecords[i].currentBalance,
    propFirmName: row.propFirmName,
    accountSize: toNumber(row.accountSize),
    phase: row.phase,
    purchaseCost: toNumber(row.purchaseCost),
    totalPayouts: toNumber(row.totalPayouts),
    brokerName: row.brokerName,
    startingBalance: toNumber(row.startingBalance),
    totalWithdrawals: toNumber(row.totalWithdrawals),
    totalDeposits: toNumber(row.totalDeposits),
    trackRecord: otherTrackRecords[i].entries as AccountTrackRecordEntryDTO[],
  }));

  const propFirmAccounts = accounts.filter((a) => a.kind === "PROP_FIRM");
  const brokerageAccounts = accounts.filter((a) => a.kind === "PERSONAL_BROKERAGE");

  return (
    <FadeIn className="mx-auto max-w-6xl space-y-10">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">My Accounts</h1>
        <Link
          href="/prop-firms"
          className="glass flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm transition-colors hover:bg-accent"
        >
          <span>
            Prop firm accounts are moving to a richer <span className="font-medium">Prop Firms</span> module —
            stages, rules, and payouts, not just a balance.
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      </div>

      <PerformanceAccountSection
        account={performanceAccountDTO}
        equityCurve={equityCurve}
        winRate={computeWinRate(perfMetricInputs)}
        profitFactor={computeProfitFactor(perfMetricInputs)}
      />

      <AccountsView propFirmAccounts={propFirmAccounts} brokerageAccounts={brokerageAccounts} />
    </FadeIn>
  );
}
