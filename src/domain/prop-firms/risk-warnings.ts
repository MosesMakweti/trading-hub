/**
 * Pre-save Account Allocation warnings (spec §3). Never silently mutates the
 * trader's input — every finding is surfaced as a warning requiring
 * acknowledgement, except a small, explicit set of hard-block conditions
 * (clearly invalid account/stage state, or a rule configured as
 * HARD_BREACH_TERMINATE).
 */
import { Decimal } from "decimal.js";

import type { AccountStatusLike, StageStatusLike } from "@/domain/prop-firms/metrics";

export type WarningSeverity = "warn" | "hard_block";

export interface RiskWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
}

export type RuleBreachActionLike = "WARNING_ONLY" | "SOFT_BREACH" | "HARD_BREACH_FAIL" | "HARD_BREACH_TERMINATE" | "CUSTOM";

export interface RuleLimit {
  numericValue: Decimal.Value | null;
  breachAction?: RuleBreachActionLike | null;
}

export interface AllocationWarningInput {
  accountStatus: AccountStatusLike;
  stageStatus: StageStatusLike;
  plannedRiskAmount: Decimal.Value;
  riskBase: Decimal.Value;
  maxRiskPerTradeRule: RuleLimit | null;
  /** Sum of this account's OTHER open executions' plannedRiskAmount (excludes the one being saved). */
  combinedOpenRisk: Decimal.Value;
  maxRiskPerDayRule: RuleLimit | null;
  /** From rule-health.ts's MAX_DAILY_LOSS evaluator; null = not computable. */
  remainingDailyLossRoom: Decimal.Value | null;
  /** From rule-health.ts's drawdown evaluator; null = not computable. */
  remainingDrawdownRoom: Decimal.Value | null;
  proposedPositionSize: Decimal.Value | null;
  maxLotOrContractRule: RuleLimit | null;
}

const INACTIVE_ACCOUNT_STATUSES: AccountStatusLike[] = ["FAILED", "BREACHED", "ARCHIVED"];

function riskPercentOfBase(riskAmount: Decimal, base: Decimal): Decimal | null {
  if (!base.greaterThan(0)) return null;
  return riskAmount.dividedBy(base).times(100);
}

/** Evaluates every warning independently — callers render the full list
 *  inline and require explicit acknowledgement before the allocation is
 *  saved. Hard-blocks stop the save outright. */
export function evaluateAllocationWarnings(input: AllocationWarningInput): RiskWarning[] {
  const warnings: RiskWarning[] = [];
  const riskAmount = new Decimal(input.plannedRiskAmount);
  const riskBase = new Decimal(input.riskBase);

  if (INACTIVE_ACCOUNT_STATUSES.includes(input.accountStatus)) {
    warnings.push({
      code: "ACCOUNT_INACTIVE",
      severity: "hard_block",
      message: `This account is ${input.accountStatus.toLowerCase()} and can't take new allocations.`,
    });
  }
  if (input.stageStatus !== "ACTIVE") {
    warnings.push({
      code: "STAGE_NOT_ACTIVE",
      severity: "hard_block",
      message: "This account's current stage isn't active — allocations can only be made against the active stage.",
    });
  }

  if (input.maxRiskPerTradeRule?.numericValue != null) {
    const limit = new Decimal(input.maxRiskPerTradeRule.numericValue);
    const riskPercent = riskPercentOfBase(riskAmount, riskBase);
    if (riskPercent != null && riskPercent.greaterThan(limit)) {
      warnings.push({
        code: "MAX_RISK_PER_TRADE_EXCEEDED",
        severity: input.maxRiskPerTradeRule.breachAction === "HARD_BREACH_TERMINATE" ? "hard_block" : "warn",
        message: `Risk (${riskPercent.toFixed(2)}%) exceeds the stage's max risk per trade (${limit.toFixed(2)}%).`,
      });
    }
  }

  if (input.maxRiskPerDayRule?.numericValue != null) {
    const limit = new Decimal(input.maxRiskPerDayRule.numericValue);
    const combined = new Decimal(input.combinedOpenRisk).plus(riskAmount);
    const combinedPercent = riskPercentOfBase(combined, riskBase);
    if (combinedPercent != null && combinedPercent.greaterThan(limit)) {
      warnings.push({
        code: "MAX_RISK_PER_DAY_EXCEEDED",
        severity: input.maxRiskPerDayRule.breachAction === "HARD_BREACH_TERMINATE" ? "hard_block" : "warn",
        message: `Combined open risk today (${combinedPercent.toFixed(2)}%) would exceed the stage's max daily risk (${limit.toFixed(2)}%).`,
      });
    }
  }

  if (input.remainingDailyLossRoom != null) {
    const room = new Decimal(input.remainingDailyLossRoom);
    if (riskAmount.greaterThan(room)) {
      warnings.push({
        code: "DAILY_LOSS_ROOM_EXCEEDED",
        severity: "warn",
        message: `This allocation's planned risk exceeds the remaining daily loss room (${room.toFixed(2)}).`,
      });
    }
  }

  if (input.remainingDrawdownRoom != null) {
    const room = new Decimal(input.remainingDrawdownRoom);
    if (riskAmount.greaterThan(room)) {
      warnings.push({
        code: "DRAWDOWN_ROOM_EXCEEDED",
        severity: "warn",
        message: `This allocation's planned risk exceeds the remaining drawdown room (${room.toFixed(2)}).`,
      });
    }
  }

  if (input.maxLotOrContractRule?.numericValue != null && input.proposedPositionSize != null) {
    const limit = new Decimal(input.maxLotOrContractRule.numericValue);
    const size = new Decimal(input.proposedPositionSize);
    if (size.greaterThan(limit)) {
      warnings.push({
        code: "MAX_SIZE_EXCEEDED",
        severity: input.maxLotOrContractRule.breachAction === "HARD_BREACH_TERMINATE" ? "hard_block" : "warn",
        message: `Position size (${size.toFixed(4)}) exceeds the stage's max lot/contract size (${limit.toFixed(4)}).`,
      });
    }
  }

  return warnings;
}

export function hasHardBlock(warnings: RiskWarning[]): boolean {
  return warnings.some((w) => w.severity === "hard_block");
}
