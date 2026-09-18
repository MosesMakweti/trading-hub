import { prisma } from "@/server/db";
import { utcDateToKey } from "@/lib/date";
import type { BrokerageAccountInput, PropFirmAccountInput } from "@/lib/validation/accounts";

const PERFORMANCE_ACCOUNT_NAME = "Performance Account";
export const PERFORMANCE_ACCOUNT_STARTING_BALANCE = 100_000;

export async function getOrCreatePerformanceAccount(userId: string) {
  const existing = await prisma.tradingAccount.findFirst({
    where: { userId, kind: "PERFORMANCE" },
  });
  if (existing) return existing;

  return prisma.tradingAccount.create({
    data: {
      userId,
      kind: "PERFORMANCE",
      name: PERFORMANCE_ACCOUNT_NAME,
      status: "ACTIVE",
      startingBalance: PERFORMANCE_ACCOUNT_STARTING_BALANCE,
    },
  });
}

// Performance is the master ledger, not "one of the accounts" — kept out of
// the regular prop-firm/brokerage listing per the product spec.
export async function listTradingAccounts(userId: string) {
  return prisma.tradingAccount.findMany({
    where: { userId, kind: { in: ["PROP_FIRM", "PERSONAL_BROKERAGE"] } },
    orderBy: { createdAt: "asc" },
  });
}

function accountBaseline(account: {
  kind: string;
  accountSize: { toNumber(): number } | null;
  startingBalance: { toNumber(): number } | null;
}): number {
  const baseline = account.kind === "PROP_FIRM" ? account.accountSize : account.startingBalance;
  return baseline ? baseline.toNumber() : 0;
}

/**
 * currentBalance is never stored — it's baseline (accountSize for prop-firm,
 * startingBalance for brokerage/performance) plus the sum of this account's
 * trade allocation PnLs, so it can never drift from the trade history that's
 * supposed to be its source of truth. The soft-delete Prisma extension only
 * covers top-level queries, not nested `include`s, so deleted trades are
 * excluded explicitly here.
 *
 * Stage C: closingPnlNet is nullable (not settled / not calculable yet — see
 * TradeAccountAllocation's doc comment). A pending trade contributes 0 to
 * this aggregate balance — that's an arithmetic decision about the total,
 * distinct from that trade's own display, which must still show "Pending"
 * rather than $0.00 wherever it's shown per-trade (track record, recent
 * trades, etc.).
 */
export async function getAccountBalance(accountId: string, excludeTradeId?: string): Promise<number> {
  const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
  const allocations = await prisma.tradeAccountAllocation.findMany({
    where: {
      tradingAccountId: accountId,
      trade: { deletedAt: null },
      ...(excludeTradeId ? { tradeId: { not: excludeTradeId } } : {}),
    },
    select: { closingPnlNet: true },
  });
  const pnlSum = allocations.reduce((sum, a) => sum + (a.closingPnlNet?.toNumber() ?? 0), 0);
  return accountBaseline(account) + pnlSum;
}

export interface AccountTrackRecordEntry {
  tradeId: string;
  dateKey: string;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  riskInputType: "PERCENT" | "AMOUNT";
  riskValue: number;
  // Stage C: null = not settled / not calculable yet — never a fake 0.
  pnl: number | null;
  runningBalance: number;
}

/** Chronological trade-by-trade history for one account, with a running
 *  balance — never manually entered. A pending trade's own `pnl` is null
 *  (Stage C) but still contributes 0 to `runningBalance`/`currentBalance`,
 *  same "aggregate vs per-trade display" split as getAccountBalance above. */
export async function getAccountTrackRecord(accountId: string): Promise<{
  currentBalance: number;
  entries: AccountTrackRecordEntry[];
}> {
  const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
  const allocations = await prisma.tradeAccountAllocation.findMany({
    where: { tradingAccountId: accountId, trade: { deletedAt: null } },
    include: { trade: true },
    orderBy: [{ trade: { tradeDate: "asc" } }, { trade: { executionMinutes: "asc" } }],
  });

  let running = accountBaseline(account);
  const entries: AccountTrackRecordEntry[] = allocations.map((a) => {
    const pnl = a.closingPnlNet?.toNumber() ?? null;
    running += pnl ?? 0;
    return {
      tradeId: a.tradeId,
      dateKey: utcDateToKey(a.trade.tradeDate),
      assetSymbol: a.trade.assetSymbol,
      direction: a.trade.direction,
      riskInputType: a.riskInputType,
      riskValue: a.riskValue.toNumber(),
      pnl,
      runningBalance: running,
    };
  });

  return { currentBalance: running, entries };
}

export async function createPropFirmAccount(userId: string, data: PropFirmAccountInput) {
  return prisma.tradingAccount.create({
    data: { userId, kind: "PROP_FIRM", ...data },
  });
}

export async function updatePropFirmAccount(
  userId: string,
  id: string,
  data: PropFirmAccountInput,
) {
  return prisma.tradingAccount.update({
    where: { id, userId, kind: "PROP_FIRM" },
    data,
  });
}

export async function createBrokerageAccount(userId: string, data: BrokerageAccountInput) {
  return prisma.tradingAccount.create({
    data: { userId, kind: "PERSONAL_BROKERAGE", ...data },
  });
}

export async function updateBrokerageAccount(
  userId: string,
  id: string,
  data: BrokerageAccountInput,
) {
  return prisma.tradingAccount.update({
    where: { id, userId, kind: "PERSONAL_BROKERAGE" },
    data,
  });
}

export async function archiveTradingAccount(userId: string, id: string) {
  const account = await prisma.tradingAccount.findFirst({ where: { id, userId } });
  if (account?.kind === "PERFORMANCE") {
    throw new Error("The Performance Account can't be deleted.");
  }
  return prisma.tradingAccount.update({
    where: { id, userId },
    data: { deletedAt: new Date() },
  });
}

/**
 * The full "start fresh" operation: wipes every trade (which cascades to
 * delete every allocation/image/checklist-selection/entry-model/psychology
 * record with it) and every daily note. The Performance Account's balance
 * needs no explicit reset — with no allocations left, baseline + 0 = $100k
 * by construction. Other accounts keep their own fields (name, accountSize,
 * notes, etc.); only their trade track record empties out via the cascade.
 */
export async function resetPerformanceAccount(userId: string) {
  await prisma.$transaction([
    prisma.dailyNote.deleteMany({ where: { userId } }),
    prisma.trade.deleteMany({ where: { userId } }),
  ]);
}
