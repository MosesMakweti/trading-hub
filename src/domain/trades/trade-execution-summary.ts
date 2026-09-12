/**
 * Shared "how much of this trade is actually accounted for right now" logic
 * — used by both Trade Review (Stage 7, one trade in detail) and Close Day
 * (Stage 8, every trade for a day, cheaply). Pure and framework-free: no
 * Prisma types, just the plain values a caller already has on hand. Reuses
 * computeRealizedRProgress — no parallel R/PnL math.
 */
import { computeRealizedRProgress } from "@/domain/trades/realized-r-progress";
import type { DirectionLike } from "@/domain/prop-firms/risk";

export interface TradeExecutionSummaryInput {
  direction: DirectionLike;
  actualEntry: string | number | null;
  actualStopLoss: string | number | null;
  actualExit: string | number | null;
  /** The Performance Account snapshot's own resolved initial stop, if any —
   *  preferred over actualStopLoss since it's the frozen 1R-defining value. */
  resolvedInitialStop: string | number | null;
  partials: { exitPrice: string | number; percentClosed: string | number | null }[];
  /** True once the Performance Account has actually settled this trade. */
  settled: boolean;
  settledRealizedR: string | number | null;
  settledPnl: string | number | null;
}

export interface TradeExecutionSummaryResult {
  realizedRSoFar: number | null;
  proportionClosedPercent: number;
  remainingProportionPercent: number;
  isFullyClosed: boolean;
  /** Only ever non-null once `settled` — Performance PnL is never estimated
   *  for a still-open position. */
  pnl: number | null;
  settled: boolean;
}

function toNum(v: string | number | null): number | null {
  return v == null ? null : Number(v);
}

export function computeTradeExecutionSummary(input: TradeExecutionSummaryInput): TradeExecutionSummaryResult {
  if (input.settled) {
    return {
      realizedRSoFar: toNum(input.settledRealizedR),
      proportionClosedPercent: 100,
      remainingProportionPercent: 0,
      isFullyClosed: true,
      pnl: toNum(input.settledPnl),
      settled: true,
    };
  }

  const initialStop = input.resolvedInitialStop ?? input.actualStopLoss;
  if (input.actualEntry == null || initialStop == null) {
    return {
      realizedRSoFar: null,
      proportionClosedPercent: 0,
      remainingProportionPercent: 100,
      isFullyClosed: false,
      pnl: null,
      settled: false,
    };
  }

  const exits =
    input.partials.length > 0
      ? input.partials
          .filter((p) => p.percentClosed != null)
          .map((p) => ({ price: p.exitPrice, proportion: p.percentClosed! }))
      : input.actualExit != null
        ? [{ price: input.actualExit, proportion: 100 }]
        : [];

  const progress = computeRealizedRProgress(input.direction, input.actualEntry, initialStop, exits);
  return {
    realizedRSoFar: progress.realizedRSoFar?.toNumber() ?? null,
    proportionClosedPercent: progress.proportionClosed.toNumber(),
    remainingProportionPercent: progress.remainingProportion.toNumber(),
    isFullyClosed: progress.isFullyClosed,
    pnl: null,
    settled: false,
  };
}
