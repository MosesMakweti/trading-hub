import { compositeExecutionScore, scoreTrade } from "@/domain/analytics/execution-engine";
import type { TradeDiscrepancyDTO } from "@/types/trades";

// One shared per-trade Discrepancy-Gap mapper (Journal card, workspace, …) — routes
// through the same Execution Engine as the dashboard, so nothing recomputes it.
interface TradeLike {
  tradeNumber: number | null;
  tradeQualityPercent: number | null;
  setupScore: number | null;
  confluencePercent: number | null;
  actualRR: { toNumber(): number } | null; // Prisma Decimal | null
  strategy: { tradeManagement: { expectedExpectancy: number | null } | null } | null;
}

/** Per-trade expected/actual/gap breakdown, or null when the trade's strategy has no
 *  expectancy benchmark (nothing to compare against). */
export function toTradeDiscrepancy(trade: TradeLike): TradeDiscrepancyDTO | null {
  const expectancy = trade.strategy?.tradeManagement?.expectedExpectancy ?? null;
  if (expectancy == null) return null;

  const executionScore = compositeExecutionScore(trade);
  const scored = scoreTrade({
    tradeNumber: trade.tradeNumber ?? 0,
    dateKey: "",
    strategyExpectancyR: expectancy,
    executionScore,
    actualR: trade.actualRR ? trade.actualRR.toNumber() : null,
  });

  return {
    executionScore,
    strategyAdherence: trade.tradeQualityPercent,
    expectedR: scored.expectedR,
    actualR: scored.actualR,
    gapR: scored.gapR,
    recoverableR: scored.recoverableR,
  };
}
