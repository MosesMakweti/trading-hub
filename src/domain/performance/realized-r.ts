/**
 * Decimal-safe realized-R and Performance Account PnL math for the
 * automatic virtual benchmark. Reuses domain/prop-firms/risk.ts's
 * `computePlannedR` for the direction-aware distance/ratio formula (it
 * already computes exactly `(reward distance) / (risk distance)`, direction
 * aware — realized R is that same ratio with the actual exit price standing
 * in for the target) — no parallel distance formula.
 */
import { Decimal } from "decimal.js";
import { computePlannedR, type DirectionLike } from "@/domain/prop-firms/risk";

export type InitialStopSourceLike = "ACTUAL" | "PLANNED" | "PLANNED_FALLBACK";

/**
 * Original-risk resolution hierarchy (Stage C.1) — "strongest historical
 * evidence available," never a guess, and never the CURRENT/moved stop:
 *   1. ACTUAL — an explicit actual execution stop (Trade.actualStopLoss).
 *   2. PLANNED — the locked TradePlanVersion's stop (the confirmed
 *      TradingView screenshot plan), when no actual stop was given.
 *   3. PLANNED_FALLBACK — the simple case-file `Trade.plannedStopLoss`
 *      field, when neither of the above exists (a freeform trade with no
 *      screenshot plan). Lowest priority — an explicit or locked-plan stop
 *      always wins when present.
 * Resolve once; the caller must not call this again after a stop has
 * already been resolved and frozen on the snapshot (spec §8: moving the
 * stop to break-even/trailing later must never redefine the original 1R
 * unit — see ensureInitialStopResolved's write-once guard, and its own doc
 * comment for the residual ambiguity this hierarchy does NOT fully close). */
export function resolveInitialStop(
  actualStopLoss: Decimal.Value | null,
  lockedPlannedStop: Decimal.Value | null,
  canonicalPlannedStop: Decimal.Value | null,
): { stop: Decimal | null; source: InitialStopSourceLike | null } {
  if (actualStopLoss != null) return { stop: new Decimal(actualStopLoss), source: "ACTUAL" };
  if (lockedPlannedStop != null) return { stop: new Decimal(lockedPlannedStop), source: "PLANNED" };
  if (canonicalPlannedStop != null) return { stop: new Decimal(canonicalPlannedStop), source: "PLANNED_FALLBACK" };
  return { stop: null, source: null };
}

/** Initial Risk Distance = |Entry − Stop|, direction-aware (must be on the
 *  correct side to be meaningful — a non-positive result means the stop is
 *  on the wrong side of entry, or equal to it). */
export function computeInitialRiskDistance(direction: DirectionLike, entry: Decimal.Value, stop: Decimal.Value): Decimal {
  const entryDec = new Decimal(entry);
  const stopDec = new Decimal(stop);
  return direction === "LONG" ? entryDec.minus(stopDec) : stopDec.minus(entryDec);
}

export interface ExitInput {
  price: Decimal.Value;
  /** 0–100. */
  proportion: Decimal.Value;
}

export interface RealizedRResult {
  /** Null until the position is fully closed (spec §9: never settle while
   *  exposure remains) or the risk distance is invalid. */
  realizedR: Decimal | null;
  fullyClosed: boolean;
  totalProportionClosed: Decimal;
  reason?: string;
}

/** Realized R across one or more exits, weighted by each exit's proportion
 *  of the position (spec §9). A single 100%-proportion exit is the "single
 *  exit" case; several exits summing to 100% is the "partial exits" case —
 *  same formula, no special-casing needed. Returns fullyClosed:false (and a
 *  null realizedR) whenever exposure remains open or the risk distance is
 *  invalid — this is what prevents ever settling a trade prematurely. */
export function computeRealizedR(
  direction: DirectionLike,
  entry: Decimal.Value,
  initialStop: Decimal.Value,
  exits: ExitInput[],
): RealizedRResult {
  const riskDistance = computeInitialRiskDistance(direction, entry, initialStop);
  if (!riskDistance.greaterThan(0)) {
    return {
      realizedR: null,
      fullyClosed: false,
      totalProportionClosed: new Decimal(0),
      reason: "Initial risk distance must be greater than zero.",
    };
  }
  if (exits.length === 0) {
    return { realizedR: null, fullyClosed: false, totalProportionClosed: new Decimal(0), reason: "No exit recorded yet." };
  }

  const totalProportion = exits.reduce((sum, e) => sum.plus(e.proportion), new Decimal(0));
  if (totalProportion.greaterThan(100.001)) {
    return {
      realizedR: null,
      fullyClosed: false,
      totalProportionClosed: totalProportion,
      reason: `Closed percentages total ${totalProportion.toFixed(1)}%, which exceeds 100%.`,
    };
  }
  if (totalProportion.lessThan(99.99)) {
    return {
      realizedR: null,
      fullyClosed: false,
      totalProportionClosed: totalProportion,
      reason: "Part of the trade remains open.",
    };
  }

  const entryDec = new Decimal(entry);
  const stopDec = new Decimal(initialStop);
  let weighted = new Decimal(0);
  for (const exit of exits) {
    const exitR = computePlannedR(direction, entryDec, stopDec, new Decimal(exit.price)).plannedR ?? new Decimal(0);
    weighted = weighted.plus(exitR.times(exit.proportion).dividedBy(100));
  }
  return { realizedR: weighted, fullyClosed: true, totalProportionClosed: totalProportion };
}

/** Performance Risk Amount = Balance Before Trade × Risk% ÷ 100 (spec §4). */
export function computePerformanceRiskAmount(balanceBefore: Decimal.Value, riskPercent: Decimal.Value): Decimal {
  return new Decimal(balanceBefore).times(riskPercent).dividedBy(100);
}

/** Performance PnL = Snapshotted Risk Amount × Realized R (spec §10). No
 *  fees/commission/swap are ever subtracted here — those belong to real
 *  account executions, never the virtual benchmark. */
export function computePerformancePnl(riskAmount: Decimal.Value, realizedR: Decimal.Value): Decimal {
  return new Decimal(riskAmount).times(realizedR);
}

/**
 * Stage C.1, Part 2 — the ONE canonical rule for whether a trade's
 * Performance result is eligible for outcome-based analytics (win rate,
 * profit factor, average R, equity curve, discrepancy, psychology-outcome
 * correlation, ...). A trade is eligible only once it has genuinely
 * settled — never inferred from a $0/0R value, and never scattered as
 * ad-hoc `?? 0` checks through analytics code. Every settled-outcome field
 * in this codebase (TradeAccountAllocation.closingPnlNet,
 * PerformanceRiskSnapshot.realizedR/performancePnl) is nullable with
 * exactly this meaning, so the rule is intentionally just "not null" — see
 * schema.prisma's TradeAccountAllocation doc comment for the full
 * null/zero contract this enforces.
 */
export function isPerformanceSettled(value: Decimal.Value | null | undefined): boolean {
  return value != null;
}

/** Performance Balance After = Balance Before + Calculated PnL (spec §11,
 *  compounding enabled). When compounding is disabled the caller simply
 *  never uses this for the NEXT trade's balance-before — it always resolves
 *  to the fixed starting balance instead (see performance-account.service.ts). */
export function computeCompoundedBalance(balanceBefore: Decimal.Value, pnl: Decimal.Value): Decimal {
  return new Decimal(balanceBefore).plus(pnl);
}

/**
 * Today V2 Final Phase §2 — closes the residual Stage C.1 "late stop entry"
 * ambiguity for NORMAL LIVE TRADING, without a stop-event system. The
 * problem: once execution begins with no trustworthy planned/locked stop to
 * inherit, `resolveInitialStop`'s ACTUAL tier freezes whatever value first
 * appears in actualStopLoss — the backend has no way to tell "the trader is
 * recording their original stop right now" from "the trader is recording a
 * stop that already moved, much later." Rather than inventing timestamp
 * heuristics or a movement log, Traditorium makes establishing the initial
 * stop an explicit, unmissable interaction exactly in this one case: true
 * only when execution has started, no trustworthy plan exists to inherit
 * from, and no initial stop has been resolved yet. Never true once a plan
 * exists (§2: "Do not require this extra interaction when a trustworthy
 * locked planned stop already exists and is being inherited") — inheriting
 * the plan's stop already resolves the ACTUAL tier atomically with entry,
 * so the ambiguity window never opens in that case at all.
 */
export function needsExplicitInitialStopConfirmation(input: {
  hasActualEntry: boolean;
  hasTrustworthyPlannedStop: boolean;
  initialStopResolved: boolean;
}): boolean {
  return input.hasActualEntry && !input.hasTrustworthyPlannedStop && !input.initialStopResolved;
}
