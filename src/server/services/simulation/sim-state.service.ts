/**
 * Read model for a simulation account: balance (verified from the ledger),
 * equity and floating PnL at the clock, open positions with their marks,
 * pending orders, recent history, and candles bounded by the clock.
 * Nothing here writes.
 */
import { prisma } from "@/server/db";
import { dec } from "@/domain/execution/precision";
import { effectiveSpread, markPrice } from "@/domain/simulation/market";
import { grossPnl, pointsToPrice, rMultiple } from "@/domain/simulation/money";
import { formatWallClock } from "@/domain/native-replay/wall-clock";
import { isReplayTimeframe, type ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { getHistoricalCandles, type CandlesResult } from "@/server/services/native-replay/historical-candles.service";
import { accountRules, requireSimAccount, SimError } from "./sim-account.service";
import { verifyLedger } from "./sim-ledger";
import { accountFeeds, latestBars, periodMinutes } from "./sim-market";
import type { SimAccountStateDTO, SimAccountSummaryDTO } from "@/types/simulation";

const price = (points: number | null, scale: number) => (points == null ? null : pointsToPrice(points, scale).toFixed(scale));

export async function getSimAccountState(userId: string, accountId: string): Promise<SimAccountStateDTO> {
  const account = await requireSimAccount(userId, accountId);
  const rules = accountRules(account);
  const [ledger, feeds, open, pending, closed] = await Promise.all([
    prisma.$transaction((tx) => verifyLedger(tx, account.id)),
    accountFeeds(prisma, account.id),
    prisma.simPosition.findMany({ where: { accountId: account.id, status: "OPEN" }, orderBy: { openedMinute: "asc" } }),
    prisma.simOrder.findMany({ where: { accountId: account.id, status: "PENDING" }, orderBy: { placedMinute: "asc" } }),
    prisma.simPosition.findMany({ where: { accountId: account.id, status: "CLOSED" }, orderBy: { closedMinute: "desc" }, take: 100 }),
  ]);
  const marks = account.currentMinute == null ? new Map() : await latestBars(prisma, feeds, account.currentMinute);

  let floating = dec(0);
  const positions = open.map((p) => {
    const bar = marks.get(p.symbol);
    const mark = bar ? markPrice(p.side, bar, effectiveSpread(bar, rules.costs.defaultSpreadPoints)) : null;
    const unrealized =
      mark == null
        ? dec(0)
        : grossPnl({ side: p.side, entry: pointsToPrice(p.entryPoints, p.priceScale), exit: pointsToPrice(mark, p.priceScale), quantity: p.remainingQuantity.toString(), valuePerPriceUnit: p.valuePerPriceUnit.toString() });
    floating = floating.plus(unrealized);
    return {
      id: p.id,
      symbol: p.symbol,
      side: p.side,
      quantity: p.quantity.toString(),
      remainingQuantity: p.remainingQuantity.toString(),
      entryPrice: price(p.entryPoints, p.priceScale)!,
      markPrice: price(mark, p.priceScale),
      stopLoss: price(p.stopLoss, p.priceScale),
      takeProfit: price(p.takeProfit, p.priceScale),
      unrealizedPnl: unrealized.toFixed(2),
      realizedPnl: p.realizedPnl.toString(),
      unrealizedR: rMultiple(unrealized.plus(p.realizedPnl.toString()), p.intendedRisk?.toString() ?? null)?.toFixed(2) ?? null,
      openedAt: formatWallClock(p.openedMinute),
      priceScale: p.priceScale,
    };
  });

  const quotes = feeds.map((f) => {
    const bar = marks.get(f.symbol);
    const spread = bar ? effectiveSpread(bar, rules.costs.defaultSpreadPoints) : 0;
    return {
      symbol: f.symbol,
      priceScale: f.priceScale,
      bid: bar ? price(bar.close, f.priceScale) : null,
      ask: bar ? price(bar.close + spread, f.priceScale) : null,
      barTime: bar ? formatWallClock(bar.minute) : null,
    };
  });

  const period = periodMinutes(account);
  return {
    id: account.id,
    name: account.name,
    product: account.product,
    kind: account.kind,
    status: account.status,
    statusReason: account.statusReason,
    currency: account.currency,
    assets: account.assets,
    period: { start: formatWallClock(period.from).slice(0, 10), end: formatWallClock(period.to).slice(0, 10) },
    clock: account.currentMinute == null ? null : { minute: account.currentMinute, time: formatWallClock(account.currentMinute), version: account.clockVersion, atPeriodEnd: account.currentMinute >= period.to },
    money: {
      startingBalance: account.startingBalance.toString(),
      balance: ledger.balance.toFixed(2),
      equity: ledger.balance.plus(floating).toFixed(2),
      floatingPnl: floating.toFixed(2),
      realizedPnl: ledger.realizedPnl.toFixed(2),
      commissions: ledger.commissions.toFixed(2),
      swaps: ledger.swaps.toFixed(2),
      withdrawals: ledger.withdrawals.toFixed(2),
    },
    quotes,
    positions,
    orders: pending.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      price: price(o.pricePoints, o.priceScale),
      quantity: o.quantity.toString(),
      stopLoss: price(o.stopLoss, o.priceScale),
      takeProfit: price(o.takeProfit, o.priceScale),
      placedAt: formatWallClock(o.placedMinute),
      expiresAt: o.expiresMinute == null ? null : formatWallClock(o.expiresMinute),
    })),
    history: closed.map((p) => {
      const net = dec(p.realizedPnl.toString()).plus(p.commissions.toString()).plus(p.swaps.toString());
      return {
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity.toString(),
        entryPrice: price(p.entryPoints, p.priceScale)!,
        openedAt: formatWallClock(p.openedMinute),
        closedAt: p.closedMinute == null ? null : formatWallClock(p.closedMinute),
        closeReason: p.closeReason,
        grossPnl: p.realizedPnl.toString(),
        netPnl: net.toFixed(2),
        r: rMultiple(net, p.intendedRisk?.toString() ?? null)?.toFixed(2) ?? null,
        ambiguousExit: p.ambiguousExit,
      };
    }),
  };
}

/**
 * One instrument's candles as of the account's stored clock. The caller picks
 * the instrument, timeframe and an earlier `to` for paging back — never the
 * cutoff.
 */
export async function getSimCandles(
  userId: string,
  accountId: string,
  query: { symbol: string; timeframe: ReplayTimeframe; limit?: number | null; to?: number | null; from?: number | null },
): Promise<CandlesResult & { clockMinute: number }> {
  if (!isReplayTimeframe(query.timeframe)) throw new SimError("Unknown timeframe.");
  const account = await requireSimAccount(userId, accountId);
  if (account.currentMinute == null) throw new SimError("Start the replay first.");
  const feeds = await accountFeeds(prisma, account.id);
  const feed = feeds.find((f) => f.symbol === query.symbol.toUpperCase());
  if (!feed) throw new SimError(`${query.symbol} isn't one of this account's instruments.`);
  const cutoff = account.currentMinute;
  const result = await getHistoricalCandles(userId, {
    datasetId: feed.datasetId,
    timeframe: query.timeframe,
    cutoff,
    to: query.to == null ? null : Math.min(query.to, cutoff),
    from: query.from ?? null,
    limit: query.limit ?? null,
  });
  return { ...result, clockMinute: cutoff };
}

/**
 * Card-level summaries for many accounts with a fixed number of queries:
 * latest ledger balance per account, closed-trade count and net result.
 */
export async function listSimAccountSummaries(userId: string, filter: { product?: SimAccountSummaryDTO["product"] } = {}): Promise<SimAccountSummaryDTO[]> {
  const accounts = await prisma.simAccount.findMany({
    where: { userId, ...(filter.product ? { product: filter.product } : {}) },
    orderBy: [{ updatedAt: "desc" }],
  });
  if (accounts.length === 0) return [];
  const ids = accounts.map((a) => a.id);
  const [balances, trades] = await Promise.all([
    prisma.$queryRaw<{ accountId: string; balance: string }[]>`
      SELECT DISTINCT ON ("accountId") "accountId", "balanceAfter"::text AS balance
      FROM "SimLedgerEntry" WHERE "accountId" = ANY(${ids}::text[]) AND "userId" = ${userId}
      ORDER BY "accountId", "sequence" DESC
    `,
    prisma.simPosition.groupBy({
      by: ["accountId", "status"],
      where: { accountId: { in: ids }, userId },
      _count: { _all: true },
    }),
  ]);
  const balanceBy = new Map(balances.map((b) => [b.accountId, b.balance]));
  return accounts.map((a) => {
    const counts = trades.filter((t) => t.accountId === a.id);
    const balance = balanceBy.get(a.id) ?? a.startingBalance.toString();
    const period = periodMinutes(a);
    return {
      id: a.id,
      name: a.name,
      product: a.product,
      kind: a.kind,
      status: a.status,
      currency: a.currency,
      assets: a.assets,
      period: { start: formatWallClock(period.from).slice(0, 10), end: formatWallClock(period.to).slice(0, 10) },
      clockTime: a.currentMinute == null ? null : formatWallClock(a.currentMinute),
      progressPercent: a.currentMinute == null ? 0 : Math.min(100, Math.max(0, ((a.currentMinute - period.from) / (period.to - period.from)) * 100)),
      startingBalance: a.startingBalance.toString(),
      balance,
      netResult: dec(balance).minus(a.startingBalance.toString()).toFixed(2),
      openPositions: counts.find((c) => c.status === "OPEN")?._count._all ?? 0,
      closedTrades: counts.find((c) => c.status === "CLOSED")?._count._all ?? 0,
      updatedAt: a.updatedAt.toISOString(),
    };
  });
}
