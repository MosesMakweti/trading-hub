import { computeDeviations } from "@/domain/analytics/deviation-engine";
import { reconstructEvent, type LeakageEvent } from "@/domain/analytics/counterfactual-engine";
import type { TradeDiscrepancyDTO } from "@/types/trades";

// One shared per-trade discrepancy mapper (Journal card, workspace, …) — now the
// Counterfactual model: reconstruct what a disciplined execution of THIS trade would
// have produced and surface only the attributable, avoidable R.
type Dec = { toNumber(): number } | null; // Prisma Decimal | null

interface TradeLike {
  tradeNumber: number | null;
  actualRR: Dec;
  direction: "LONG" | "SHORT";
  plannedEntry: Dec;
  plannedStopLoss: Dec;
  plannedTarget: Dec;
  actualEntry: Dec;
  actualExit: Dec;
  setupValid: boolean | null;
  missingConfluences: unknown; // Json string[]
  wouldTakeAgain: boolean | null;
  tradeIntent: "PLANNED" | "FOMO" | "REVENGE" | "BOREDOM" | "IMPULSE" | "MANUAL_OVERRIDE" | null;
  executionPercent: number | null;
  psychology: { psychologyPercent: number | null } | null;
}

const num = (d: Dec): number | null => (d ? d.toNumber() : null);

/** Pick the badge leakage: the largest measured cost, else the first flagged breach. */
function primaryLeakage(leakages: LeakageEvent[]): LeakageEvent | null {
  const measured = leakages.filter((l) => l.rImpact != null);
  if (measured.length > 0) {
    return measured.reduce((a, b) => ((b.rImpact ?? 0) > (a.rImpact ?? 0) ? b : a));
  }
  return leakages[0] ?? null;
}

/** Per-trade counterfactual. Null only when there is nothing to say (no realized R and
 *  no process signal at all). */
export function toTradeDiscrepancy(trade: TradeLike): TradeDiscrepancyDTO | null {
  const actualR = num(trade.actualRR);

  const { deviations } = computeDeviations({
    direction: trade.direction,
    plannedEntry: num(trade.plannedEntry),
    plannedStopLoss: num(trade.plannedStopLoss),
    plannedTarget: num(trade.plannedTarget),
    actualEntry: num(trade.actualEntry),
    actualExit: num(trade.actualExit),
    actualRR: actualR,
  });

  const e = reconstructEvent({
    kind: "EXECUTED",
    eventId: String(trade.tradeNumber ?? ""),
    sequence: trade.tradeNumber ?? 0,
    dateKey: "",
    actualR,
    validSetup: trade.setupValid,
    missingConfluences: (trade.missingConfluences as string[] | null) ?? [],
    deviations,
    wouldTakeAgain: trade.wouldTakeAgain,
    behaviorTag: trade.tradeIntent,
    psychologyPercent: trade.psychology?.psychologyPercent ?? null,
    missingExecutionConfirmations:
      trade.executionPercent != null && trade.executionPercent < 100 ? 1 : 0,
  });

  // Nothing to show: no realized result and a clean, unflagged process.
  if (actualR == null && !e.processBreach) return null;

  return {
    actualR,
    processPerfectR: e.processPerfectR,
    avoidableR: e.avoidableR,
    unearnedR: e.unearnedR,
    processBreach: e.processBreach,
    validSetup: e.validSetup,
    leakages: e.leakages,
    primary: primaryLeakage(e.leakages),
  };
}
