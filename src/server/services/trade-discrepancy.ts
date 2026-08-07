import { compositeExecutionScore, scoreTrade } from "@/domain/analytics/execution-engine";
import { computeDeviations } from "@/domain/analytics/deviation-engine";
import type { TradeDiscrepancyDTO } from "@/types/trades";

// One shared per-trade Discrepancy-Gap mapper (Journal card, workspace, …) — routes
// through the same Execution + Deviation engines as the dashboard, so nothing recomputes.
type Dec = { toNumber(): number } | null; // Prisma Decimal | null

interface TradeLike {
  tradeNumber: number | null;
  tradeQualityPercent: number | null;
  setupScore: number | null;
  confluencePercent: number | null;
  actualRR: Dec;
  direction: "LONG" | "SHORT";
  plannedEntry: Dec;
  plannedStopLoss: Dec;
  plannedTarget: Dec;
  actualEntry: Dec;
  actualExit: Dec;
  strategy: { tradeManagement: { expectedExpectancy: number | null } | null } | null;
}

const num = (d: Dec): number | null => (d ? d.toNumber() : null);

/** Per-trade expected/actual/gap + primary deviation, or null when the trade's
 *  strategy has no expectancy benchmark (nothing to compare against). */
export function toTradeDiscrepancy(trade: TradeLike): TradeDiscrepancyDTO | null {
  const expectancy = trade.strategy?.tradeManagement?.expectedExpectancy ?? null;
  if (expectancy == null) return null;

  const executionScore = compositeExecutionScore(trade);
  const actualR = num(trade.actualRR);
  const scored = scoreTrade({
    tradeNumber: trade.tradeNumber ?? 0,
    dateKey: "",
    strategyExpectancyR: expectancy,
    executionScore,
    actualR,
  });

  const { primary } = computeDeviations({
    direction: trade.direction,
    plannedEntry: num(trade.plannedEntry),
    plannedStopLoss: num(trade.plannedStopLoss),
    plannedTarget: num(trade.plannedTarget),
    actualEntry: num(trade.actualEntry),
    actualExit: num(trade.actualExit),
    actualRR: actualR,
  });

  return {
    executionScore,
    strategyAdherence: trade.tradeQualityPercent,
    expectedR: scored.expectedR,
    actualR: scored.actualR,
    gapR: scored.gapR,
    recoverableR: scored.recoverableR,
    primaryDeviation: primary,
  };
}
