import { resolveInitialStop } from "@/domain/performance/realized-r";
import { computeTradeExecutionSummary } from "@/domain/trades/trade-execution-summary";
import { prisma } from "@/server/db";
import { isBacktestScope } from "@/server/workspace/scope";

/**
 * Backtesting (Stage 3/4) — how a trade's result becomes FINAL.
 *
 *  - PERFORMANCE_ACCOUNT (LIVE, unchanged): final once the Performance Account
 *    has settled the trade (`performanceRiskSnapshot.settledAt`), using the
 *    snapshot's frozen initial stop / realized R / PnL — exactly the inputs
 *    every live reader already passed.
 *  - PRICE_DERIVED (BACKTEST): simulated trades never touch the Performance
 *    Account, so a result is final once the position is fully closed by its
 *    own recorded prices. The 1R unit uses the SAME initial-stop hierarchy as
 *    the Performance Account (domain/performance/realized-r.ts
 *    `resolveInitialStop`: actual stop → locked plan-version stop → planned
 *    stop). There is no money PnL (R only).
 *
 * The basis follows the ambient workspace scope, so shared readers (Day
 * Summary, canonical analytics, the day list) need no environment parameter.
 */
export type SettlementBasis = "PERFORMANCE_ACCOUNT" | "PRICE_DERIVED";

export function currentSettlementBasis(): SettlementBasis {
  return isBacktestScope() ? "PRICE_DERIVED" : "PERFORMANCE_ACCOUNT";
}

/** Prisma `include` fragment every settlement reader needs. */
export const settlementInclude = {
  performanceRiskSnapshot: { select: { initialStop: true, realizedR: true, performancePnl: true, settledAt: true } },
  planVersions: {
    where: { locked: true },
    orderBy: { versionNumber: "asc" as const },
    take: 1,
    select: { stopLoss: true },
  },
} as const;

type Num = { toString(): string } | null | undefined;

export interface SettlementTradeFields {
  direction: "LONG" | "SHORT";
  actualEntry: Num;
  actualStopLoss: Num;
  actualExit: Num;
  plannedStopLoss: Num;
  actualPartialExits: { exitPrice: Num; percentClosed: Num }[];
  performanceRiskSnapshot?: { initialStop: Num; realizedR: Num; performancePnl: Num; settledAt: Date | null } | null;
  planVersions?: { stopLoss: Num }[];
}

export interface SettlementInputs {
  resolvedInitialStop: number | null;
  settled: boolean;
  settledRealizedR: number | null;
  settledPnl: number | null;
}

const toNum = (v: Num): number | null => (v == null ? null : Number(v.toString()));
const toStr = (v: Num): string | null => (v == null ? null : v.toString());

/** The settlement inputs `computeTradeExecutionSummary` / the canonical row
 *  builder take, under the given basis. */
export function settlementInputs(trade: SettlementTradeFields, basis: SettlementBasis): SettlementInputs {
  if (basis === "PERFORMANCE_ACCOUNT") {
    const s = trade.performanceRiskSnapshot;
    return {
      resolvedInitialStop: toNum(s?.initialStop),
      settled: s?.settledAt != null,
      settledRealizedR: toNum(s?.realizedR),
      settledPnl: toNum(s?.performancePnl),
    };
  }

  const { stop } = resolveInitialStop(
    toStr(trade.actualStopLoss),
    toStr(trade.planVersions?.[0]?.stopLoss),
    toStr(trade.plannedStopLoss),
  );
  const resolvedInitialStop = stop == null ? null : stop.toNumber();
  const summary = computeTradeExecutionSummary({
    direction: trade.direction,
    actualEntry: toStr(trade.actualEntry),
    actualStopLoss: toStr(trade.actualStopLoss),
    actualExit: toStr(trade.actualExit),
    resolvedInitialStop: resolvedInitialStop == null ? null : String(resolvedInitialStop),
    partials: trade.actualPartialExits.map((p) => ({ exitPrice: toStr(p.exitPrice)!, percentClosed: toStr(p.percentClosed) })),
    settled: false,
    settledRealizedR: null,
    settledPnl: null,
  });
  const settled = summary.isFullyClosed && summary.realizedRSoFar != null;
  return {
    resolvedInitialStop,
    settled,
    settledRealizedR: settled ? summary.realizedRSoFar : null,
    settledPnl: null,
  };
}

/**
 * The backtest counterpart of the Performance Account's settlement side
 * effect on the trade itself: once a SIMULATED trade's own prices fully close
 * the position, its price-derived realized R becomes `Trade.actualRR` — the
 * same one-way sync `settlePerformanceTrade` performs for live trades (never
 * cleared back to null), so every reader of actualRR (Day Summary win/loss,
 * review, journal) works identically in a backtest. No money, no ledger, no
 * Performance snapshot. Only ever called inside a BACKTEST scope, and refuses
 * to touch a live trade.
 */
export async function settleBacktestTrade(userId: string, tradeId: string): Promise<number | null> {
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, userId },
    include: { actualPartialExits: { select: { exitPrice: true, percentClosed: true } }, ...settlementInclude },
  });
  if (!trade || trade.backtestRunId == null) return null;
  if (trade.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED" || trade.actualEntry == null) return null;

  const { settled, settledRealizedR } = settlementInputs(trade, "PRICE_DERIVED");
  if (!settled || settledRealizedR == null) return null;
  const rounded = Math.round(settledRealizedR * 100) / 100;
  if (trade.actualRR?.toNumber() !== rounded) {
    await prisma.trade.update({ where: { id: trade.id }, data: { actualRR: rounded } });
  }
  return rounded;
}
