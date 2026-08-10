import { classifyTrade } from "@/domain/analytics/discrepancy-model";
import { computeDeviations } from "@/domain/analytics/deviation-engine";
import type { TradeDiscrepancyDTO } from "@/types/trades";

// One shared per-trade discrepancy mapper (Journal card, workspace, …) — the
// corrected model: classify the trade and surface only OBJECTIVE avoidable R.
type Dec = { toNumber(): number } | null; // Prisma Decimal | null

interface TradeLike {
  tradeNumber: number | null;
  tradeQualityPercent: number | null;
  wouldTakeAgain: boolean | null;
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

/** Per-trade classification + avoidable R (from "Would I take this again?") + the
 *  primary planned-vs-actual deviation (context). Null only when there's nothing to
 *  say (unanswered AND no expectancy context). */
export function toTradeDiscrepancy(trade: TradeLike): TradeDiscrepancyDTO | null {
  const expectancy = trade.strategy?.tradeManagement?.expectedExpectancy ?? null;
  const actualR = num(trade.actualRR);

  const { primary } = computeDeviations({
    direction: trade.direction,
    plannedEntry: num(trade.plannedEntry),
    plannedStopLoss: num(trade.plannedStopLoss),
    plannedTarget: num(trade.plannedTarget),
    actualEntry: num(trade.actualEntry),
    actualExit: num(trade.actualExit),
    actualRR: actualR,
  });

  const proc = classifyTrade({ actualR, wouldTakeAgain: trade.wouldTakeAgain });

  // Nothing to show: not judged and no expectancy benchmark either.
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
