import { classifyTrade } from "@/domain/analytics/discrepancy-model";
import { computeDeviations } from "@/domain/analytics/deviation-engine";
import type { TradeDiscrepancyDTO } from "@/types/trades";

// One shared per-trade discrepancy mapper (Journal card, workspace, …) — the
// corrected model: classify the trade and surface only OBJECTIVE avoidable R.
type Dec = { toNumber(): number } | null; // Prisma Decimal | null

interface TradeLike {
  tradeNumber: number | null;
  tradeQualityPercent: number | null;
  setupValid: boolean | null;
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

/** Per-trade classification + avoidable R + primary deviation. Null only when there
 *  is nothing to say (no process signal AND no expectancy context). */
export function toTradeDiscrepancy(trade: TradeLike): TradeDiscrepancyDTO | null {
  const expectancy = trade.strategy?.tradeManagement?.expectedExpectancy ?? null;
  const actualR = num(trade.actualRR);

  const { deviations, primary } = computeDeviations({
    direction: trade.direction,
    plannedEntry: num(trade.plannedEntry),
    plannedStopLoss: num(trade.plannedStopLoss),
    plannedTarget: num(trade.plannedTarget),
    actualEntry: num(trade.actualEntry),
    actualExit: num(trade.actualExit),
    actualRR: actualR,
  });

  const proc = classifyTrade({
    actualR,
    deviations,
    adherenceFollowed: trade.setupValid,
    hasExecutionData: trade.plannedEntry != null && trade.actualEntry != null,
  });

  // Nothing to show: can't judge process and no expectancy benchmark either.
  if (proc.classification === "UNVERIFIED" && expectancy == null) return null;

  return {
    classification: proc.classification,
    processDiscrepancy: proc.processDiscrepancy,
    avoidableR: proc.avoidableR,
    expectedStatisticalR: expectancy,
    actualR,
    strategyAdherence: trade.tradeQualityPercent,
    primaryDeviation: primary,
  };
}
