/**
 * Planned-versus-actual comparison (checkpoint 2 §4/§5). Pure and
 * decimal-safe — every value is computed only when its required inputs
 * exist; nothing here infers a fact the data doesn't support (spec: "do not
 * infer an actual stop from the final exit", "do not claim a target was
 * reached merely because an exit price appears beyond it").
 *
 * This measures EXECUTION ALIGNMENT, not whether the trade won. A
 * correctly-executed loss produces "at planned level" / "risk respected"
 * flags just like a win would — nothing here scores outcome.
 */
import { Decimal } from "decimal.js";
import type { DirectionLike } from "@/domain/prop-firms/risk";
import { computeDistance, type DistanceResult } from "@/domain/trade-plan/distance";
import type { InstrumentSpec } from "@/domain/trade-plan/instrument-catalog";

export type AlignmentLabel = "BETTER_THAN_PLANNED" | "AT_PLANNED_LEVEL" | "WORSE_THAN_PLANNED" | "NOT_ENOUGH_DATA";
export type RiskChangeLabel = "WIDENED" | "TIGHTENED" | "RESPECTED" | "NOT_ENOUGH_DATA";

/** Half a pip/tick/point of tolerance (or a tiny epsilon with no spec) —
 *  differences smaller than this are noise, not a meaningful slip. */
function toleranceFor(spec: InstrumentSpec | null): Decimal {
  if (!spec) return new Decimal("0.00001");
  const size = spec.preferredUnit === "PIP" ? spec.pipSize : spec.preferredUnit === "TICK" ? spec.tickSize : spec.pointSize;
  return size ? new Decimal(size).dividedBy(2) : new Decimal("0.00001");
}

export interface EntryComparison {
  plannedEntry: Decimal | null;
  actualEntry: Decimal | null;
  absoluteDifference: Decimal | null;
  distance: DistanceResult | null;
  /** Signed, direction-aware: positive = adverse (worse), negative = favorable (better). */
  signedSlippage: Decimal | null;
  slippageR: Decimal | null;
  label: AlignmentLabel;
}

/** For a long, entering above plan is adverse; for a short, entering below
 *  plan is adverse (spec §4). `plannedRiskDistance` (|plannedEntry −
 *  plannedStop|) is optional — slippageR is null without it. */
export function compareEntry(
  direction: DirectionLike,
  plannedEntry: Decimal.Value | null,
  actualEntry: Decimal.Value | null,
  spec: InstrumentSpec | null,
  plannedRiskDistance: Decimal.Value | null,
): EntryComparison {
  if (plannedEntry == null || actualEntry == null) {
    return { plannedEntry: plannedEntry == null ? null : new Decimal(plannedEntry), actualEntry: actualEntry == null ? null : new Decimal(actualEntry), absoluteDifference: null, distance: null, signedSlippage: null, slippageR: null, label: "NOT_ENOUGH_DATA" };
  }
  const planned = new Decimal(plannedEntry);
  const actual = new Decimal(actualEntry);
  const signedSlippage = direction === "LONG" ? actual.minus(planned) : planned.minus(actual);
  const tolerance = toleranceFor(spec);
  const label: AlignmentLabel = signedSlippage.abs().lessThanOrEqualTo(tolerance) ? "AT_PLANNED_LEVEL" : signedSlippage.greaterThan(0) ? "WORSE_THAN_PLANNED" : "BETTER_THAN_PLANNED";
  const slippageR = plannedRiskDistance != null && new Decimal(plannedRiskDistance).greaterThan(0) ? signedSlippage.dividedBy(plannedRiskDistance) : null;

  return {
    plannedEntry: planned,
    actualEntry: actual,
    absoluteDifference: actual.minus(planned).abs(),
    distance: computeDistance(planned, actual, spec),
    signedSlippage,
    slippageR,
    label,
  };
}

export interface StopComparison {
  plannedStop: Decimal | null;
  actualStopUsed: Decimal | null;
  plannedRiskDistance: DistanceResult | null;
  actualRiskDistance: DistanceResult | null;
  /** actualRiskDistance ÷ plannedRiskDistance — 1.0 = identical risk taken. */
  riskRatio: Decimal | null;
  change: RiskChangeLabel;
}

/** Actual risk distance uses the ACTUAL entry (the real risk taken), not the
 *  planned one — an entry slip changes the real distance to the stop even if
 *  the stop price itself didn't move. Requires actualStopUsed to be
 *  explicitly recorded (never inferred from actualExit). */
export function compareStop(
  plannedEntry: Decimal.Value | null,
  plannedStop: Decimal.Value | null,
  actualEntry: Decimal.Value | null,
  actualStopUsed: Decimal.Value | null,
  spec: InstrumentSpec | null,
): StopComparison {
  const plannedRiskDistance = plannedEntry != null && plannedStop != null ? computeDistance(plannedEntry, plannedStop, spec) : null;
  const actualRiskDistance = actualEntry != null && actualStopUsed != null ? computeDistance(actualEntry, actualStopUsed, spec) : null;

  let riskRatio: Decimal | null = null;
  let change: RiskChangeLabel = "NOT_ENOUGH_DATA";
  if (plannedRiskDistance && actualRiskDistance && plannedRiskDistance.distance.greaterThan(0)) {
    riskRatio = actualRiskDistance.distance.dividedBy(plannedRiskDistance.distance);
    const tolerance = new Decimal("0.02"); // 2% ratio tolerance — avoids flagging rounding noise as "widened"
    if (riskRatio.minus(1).abs().lessThanOrEqualTo(tolerance)) change = "RESPECTED";
    else change = riskRatio.greaterThan(1) ? "WIDENED" : "TIGHTENED";
  }

  return {
    plannedStop: plannedStop == null ? null : new Decimal(plannedStop),
    actualStopUsed: actualStopUsed == null ? null : new Decimal(actualStopUsed),
    plannedRiskDistance,
    actualRiskDistance,
    riskRatio,
    change,
  };
}

export interface PlannedTargetForComparison {
  targetOrder: number;
  label: string;
  targetPrice: Decimal.Value;
  rMultiple: Decimal.Value | null;
}

export interface TargetComparisonRow {
  targetOrder: number;
  label: string;
  targetPrice: Decimal;
  plannedR: Decimal | null;
  /** True only when the final actual exit price is within tolerance of THIS
   *  target's price — never inferred from "beyond" reasoning (spec §4). */
  matchedFinalExit: boolean;
}

export interface TargetsComparison {
  rows: TargetComparisonRow[];
  /** The one target the final exit price closely matches, if any — null
   *  when ambiguous or no match (ambiguity is reported, not guessed at). */
  matchedTarget: TargetComparisonRow | null;
  capturedDistance: DistanceResult | null;
  realizedR: Decimal | null;
}

/** Compares planned targets against the trade's FINAL actual exit only
 *  (partial-exit-aware comparison is a separate function — see
 *  domain/trade-plan/partial-matching.ts). realizedR here is computed from
 *  price when not otherwise supplied — pass a confirmed realizedR from
 *  TradeAccountExecution.actualR when one exists, since that's the more
 *  authoritative source (spec §4 priority: confirmed > estimated). */
export function compareTargets(
  direction: DirectionLike,
  actualEntry: Decimal.Value | null,
  actualExit: Decimal.Value | null,
  plannedRiskDistance: Decimal.Value | null,
  targets: PlannedTargetForComparison[],
  spec: InstrumentSpec | null,
  confirmedRealizedR: Decimal.Value | null = null,
): TargetsComparison {
  const tolerance = toleranceFor(spec);
  const rows: TargetComparisonRow[] = targets.map((t) => {
    const targetPrice = new Decimal(t.targetPrice);
    const matchedFinalExit = actualExit != null && new Decimal(actualExit).minus(targetPrice).abs().lessThanOrEqualTo(tolerance);
    return {
      targetOrder: t.targetOrder,
      label: t.label,
      targetPrice,
      plannedR: t.rMultiple == null ? null : new Decimal(t.rMultiple),
      matchedFinalExit,
    };
  });
  const matches = rows.filter((r) => r.matchedFinalExit);

  const capturedDistance = actualEntry != null && actualExit != null ? computeDistance(actualEntry, actualExit, spec) : null;

  let realizedR: Decimal | null = confirmedRealizedR != null ? new Decimal(confirmedRealizedR) : null;
  if (realizedR == null && actualEntry != null && actualExit != null && plannedRiskDistance != null) {
    const risk = new Decimal(plannedRiskDistance);
    if (risk.greaterThan(0)) {
      const entry = new Decimal(actualEntry);
      const exit = new Decimal(actualExit);
      const signedCapture = direction === "LONG" ? exit.minus(entry) : entry.minus(exit);
      realizedR = signedCapture.dividedBy(risk);
    }
  }

  return { rows, matchedTarget: matches.length === 1 ? matches[0] : null, capturedDistance, realizedR };
}

export interface RiskResultComparison {
  plannedRiskAmount: Decimal | null;
  actualRiskAmount: Decimal | null;
  plannedRiskPercent: Decimal | null;
  actualRiskPercent: Decimal | null;
  plannedWeightedR: Decimal | null;
  realizedR: Decimal | null;
  expectedTargetPnl: Decimal | null;
  actualNetPnl: Decimal | null;
}

export function compareRiskAndResult(input: {
  plannedRiskAmount?: Decimal.Value | null;
  actualRiskAmount?: Decimal.Value | null;
  plannedRiskPercent?: Decimal.Value | null;
  actualRiskPercent?: Decimal.Value | null;
  plannedWeightedR?: Decimal.Value | null;
  realizedR?: Decimal.Value | null;
  expectedTargetPnl?: Decimal.Value | null;
  actualNetPnl?: Decimal.Value | null;
}): RiskResultComparison {
  const d = (v: Decimal.Value | null | undefined) => (v == null ? null : new Decimal(v));
  return {
    plannedRiskAmount: d(input.plannedRiskAmount),
    actualRiskAmount: d(input.actualRiskAmount),
    plannedRiskPercent: d(input.plannedRiskPercent),
    actualRiskPercent: d(input.actualRiskPercent),
    plannedWeightedR: d(input.plannedWeightedR),
    realizedR: d(input.realizedR),
    expectedTargetPnl: d(input.expectedTargetPnl),
    actualNetPnl: d(input.actualNetPnl),
  };
}

export interface ExecutionAlignmentFlag {
  code: string;
  message: string;
}

/** Descriptive, evidence-only observations (spec §5/§6) — never a "trader
 *  error" verdict, never derived from Planned-Target-R minus Actual-R (spec
 *  explicitly forbids that as an execution-quality formula). */
export function buildAlignmentFlags(entry: EntryComparison, stop: StopComparison): ExecutionAlignmentFlag[] {
  const flags: ExecutionAlignmentFlag[] = [];

  if (entry.label === "NOT_ENOUGH_DATA") {
    flags.push({ code: "ENTRY_DATA_MISSING", message: "Actual entry is missing — entry alignment can't be assessed." });
  } else if (entry.label === "AT_PLANNED_LEVEL") {
    flags.push({ code: "ENTRY_ALIGNED", message: "Entry was filled at the planned level." });
  } else if (entry.label === "WORSE_THAN_PLANNED") {
    flags.push({ code: "ENTRY_ADVERSE_SLIPPAGE", message: entry.distance ? `Entry was ${entry.distance.distance.toFixed(2)} ${entry.distance.unit.toLowerCase()} worse than planned.` : "Entry was worse than planned." });
  } else {
    flags.push({ code: "ENTRY_FAVORABLE_SLIPPAGE", message: entry.distance ? `Entry was ${entry.distance.distance.toFixed(2)} ${entry.distance.unit.toLowerCase()} better than planned.` : "Entry was better than planned." });
  }

  if (stop.change === "NOT_ENOUGH_DATA") {
    flags.push({ code: "STOP_DATA_MISSING", message: "Actual stop used is missing — risk alignment can't be assessed." });
  } else if (stop.change === "RESPECTED") {
    flags.push({ code: "PLANNED_RISK_RESPECTED", message: "Actual risk distance matched the plan." });
  } else if (stop.change === "WIDENED") {
    flags.push({ code: "STOP_WIDENED", message: stop.riskRatio ? `Actual risk distance was ${stop.riskRatio.minus(1).times(100).toFixed(0)}% larger than planned.` : "Actual risk distance was larger than planned." });
  } else {
    flags.push({ code: "STOP_TIGHTENED", message: stop.riskRatio ? `Actual risk distance was ${new Decimal(1).minus(stop.riskRatio).times(100).toFixed(0)}% smaller than planned.` : "Actual risk distance was smaller than planned." });
  }

  return flags;
}
