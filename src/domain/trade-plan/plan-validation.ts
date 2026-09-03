/**
 * Trade-plan validation (spec §9/§11). Every check is a WARNING the trader
 * can see and correct — this module never reorders or silently "fixes"
 * values (spec: "do not silently reorder values"). Pure and decimal-safe.
 */
import { Decimal } from "decimal.js";
import type { DirectionLike } from "@/domain/prop-firms/risk";

export interface PlanValidationIssue {
  code: string;
  message: string;
  severity: "warning" | "error";
}

export interface PlanValidationInput {
  direction: DirectionLike | null;
  entry: Decimal.Value | null;
  stopLoss: Decimal.Value | null;
  targets: { targetOrder: number; targetPrice: Decimal.Value; plannedClosePercent: Decimal.Value | null }[];
  requireTarget?: boolean;
  /** Max decimal places a confirmed price is expected to have for this instrument (from the resolved InstrumentSpec), when known. */
  maxDecimalPrecision?: number | null;
}

function decimalPlaces(value: Decimal.Value): number {
  return new Decimal(value).decimalPlaces();
}

/** Full validation pass — direction/level relationships, required fields,
 *  distances > 0, duplicate targets, close-percent totals, and unreasonable
 *  precision. Returns every issue found; the caller decides how to render
 *  severity (warnings never block saving a plan — errors block confirmation). */
export function validatePlan(input: PlanValidationInput): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];
  const { direction, entry, stopLoss, targets } = input;

  if (entry == null) {
    issues.push({ code: "ENTRY_MISSING", message: "Planned entry is required.", severity: "error" });
  }
  if (stopLoss == null) {
    issues.push({ code: "STOP_MISSING", message: "Planned stop-loss is required.", severity: "error" });
  }
  if ((input.requireTarget ?? true) && targets.length === 0) {
    issues.push({ code: "TARGET_MISSING", message: "At least one profit target is required.", severity: "error" });
  }

  const entryDecimal = entry == null ? null : new Decimal(entry);
  const stopDecimal = stopLoss == null ? null : new Decimal(stopLoss);

  if (entryDecimal != null && stopDecimal != null) {
    if (entryDecimal.equals(stopDecimal)) {
      issues.push({ code: "STOP_EQUALS_ENTRY", message: "Stop-loss cannot be the same price as entry — stop distance must be greater than zero.", severity: "error" });
    } else if (direction === "LONG" && stopDecimal.greaterThan(entryDecimal)) {
      issues.push({ code: "STOP_WRONG_SIDE", message: "For a long trade, the stop is normally below entry. Check the direction or the stop price.", severity: "warning" });
    } else if (direction === "SHORT" && stopDecimal.lessThan(entryDecimal)) {
      issues.push({ code: "STOP_WRONG_SIDE", message: "For a short trade, the stop is normally above entry. Check the direction or the stop price.", severity: "warning" });
    }
  }

  if (entryDecimal != null) {
    for (const target of targets) {
      const targetDecimal = new Decimal(target.targetPrice);
      if (targetDecimal.equals(entryDecimal)) {
        issues.push({ code: "TARGET_EQUALS_ENTRY", message: `${targetLabel(target.targetOrder)} cannot be the same price as entry — reward distance must be greater than zero.`, severity: "error" });
        continue;
      }
      if (direction === "LONG" && targetDecimal.lessThan(entryDecimal)) {
        issues.push({ code: "TARGET_WRONG_SIDE", message: `For a long trade, ${targetLabel(target.targetOrder)} is normally above entry. Check the direction or the target price.`, severity: "warning" });
      } else if (direction === "SHORT" && targetDecimal.greaterThan(entryDecimal)) {
        issues.push({ code: "TARGET_WRONG_SIDE", message: `For a short trade, ${targetLabel(target.targetOrder)} is normally below entry. Check the direction or the target price.`, severity: "warning" });
      }
    }
  }

  const seenPrices = new Map<string, number[]>();
  for (const target of targets) {
    const key = new Decimal(target.targetPrice).toString();
    const orders = seenPrices.get(key) ?? [];
    orders.push(target.targetOrder);
    seenPrices.set(key, orders);
  }
  for (const [, orders] of seenPrices) {
    if (orders.length > 1) {
      issues.push({ code: "DUPLICATE_TARGET", message: `${orders.map(targetLabel).join(" and ")} have the same price — each target should be distinct.`, severity: "warning" });
    }
  }

  const totalPercent = targets.reduce((sum, t) => sum.plus(t.plannedClosePercent ?? 0), new Decimal(0));
  if (totalPercent.greaterThan(100)) {
    issues.push({ code: "CLOSE_PERCENT_EXCEEDS_100", message: `Planned close percentages total ${totalPercent.toFixed(0)}%, which is more than 100%.`, severity: "error" });
  }

  if (input.maxDecimalPrecision != null) {
    const tooPrecise = [entryDecimal, stopDecimal, ...targets.map((t) => new Decimal(t.targetPrice))]
      .filter((v): v is Decimal => v != null)
      .some((v) => decimalPlaces(v) > input.maxDecimalPrecision!);
    if (tooPrecise) {
      issues.push({ code: "UNREASONABLE_PRECISION", message: `A price has more decimal places than this instrument normally quotes (max ${input.maxDecimalPrecision}).`, severity: "warning" });
    }
  }

  return issues;
}

function targetLabel(order: number): string {
  return `TP${order}`;
}

export function hasBlockingIssues(issues: PlanValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
