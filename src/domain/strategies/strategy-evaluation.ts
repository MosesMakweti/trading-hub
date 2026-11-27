import { findHistoricalScenario, toReplayResolvedConditions } from "@/domain/replay/replay-validation";
import { toScorableConfluences } from "@/domain/strategies/setup-type-scoring";
import { scoreConfluences, type ScorableConfluence, type SetupRating } from "@/domain/trades/confluence-score";
import type { StrategyVersionSnapshot } from "@/types/strategies";

/**
 * Strategy evaluation for a trade decision in the Backtesting terminal (pure).
 *
 * What a Strategy Lab strategy CAN and CAN'T evaluate is explicit (see
 * STRATEGY_CAPABILITIES): most of a strategy is descriptive text, and nothing
 * here ever invents trading logic from it.
 *
 *  - SCORABLE (manual input, automatic scoring): confluences, execution
 *    confirmations and setup-type scenarios. The TRADER confirms which
 *    conditions are present on the chart; scoring uses the existing engine
 *    (scoreConfluences / setup-type resolution) on the session's FROZEN
 *    snapshot — the same rules a live trade is validated with.
 *  - EXECUTABLE (fully automatic): session windows, trades per day, risk per
 *    trade, daily risk and the minimum execution score. They use only
 *    server-side state at the replay clock (the clock minute, positions
 *    already opened), so they can't look ahead.
 *  - DESCRIPTIVE (never auto-evaluated): framework, entry models,
 *    timeframes, arsenal and rich-text trade-management rules — listed as
 *    manual so the trader sees they weren't checked.
 *
 * The evaluation never blocks an order: a backtest exists to measure what
 * happens when rules are followed or broken. It is frozen on the order and
 * the position, so later strategy edits never change it.
 */

export type CheckStatus = "PASS" | "FAIL" | "NOT_EVALUATED";
export type CheckRule =
  | "MANDATORY_CONDITIONS"
  | "SESSION"
  | "MAX_TRADES_PER_DAY"
  | "MAX_RISK_PER_TRADE"
  | "MAX_DAILY_RISK"
  | "MIN_EXECUTION_SCORE";

export interface EvaluationCheck {
  rule: CheckRule;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface StrategyEvaluation {
  version: 1;
  direction: "LONG" | "SHORT";
  setupType: { name: string; scenario: string } | null;
  /** 0–100 weighted score of the confirmed conditions (null = nothing to score). */
  score: number | null;
  rating: SetupRating | null;
  checked: string[];
  missingMandatory: string[];
  /** Confirmed conditions that don't apply to this direction (not scored). */
  ineligibleChecked: string[];
  /** The enabled strategy session the replay time falls in. */
  session: string | null;
  checks: EvaluationCheck[];
  /** Every evaluated check passed (NOT_EVALUATED checks don't count either way). */
  followedRules: boolean;
  /** Descriptive sections present in the strategy that were NOT auto-evaluated. */
  manualOnly: string[];
}

export interface EvaluationContext {
  /** Replay time as minutes after midnight in the trader's timezone (null = unknown). */
  localMinuteOfDay: number | null;
  timezoneLabel: string;
  /** Positions already opened on this broker day before this one. */
  tradesTodayBefore: number;
  /** Risk of THIS trade as % of balance (null = no stop → unknown). */
  riskPercent: number | null;
  /** Risk already taken today (sum of intended risk / balance × 100). */
  dayRiskPercentBefore: number;
}

export interface EvaluationInput {
  snapshot: StrategyVersionSnapshot;
  direction: "LONG" | "SHORT";
  setupTypeName?: string | null;
  /** Names of the conditions the trader confirmed on the chart. */
  checkedNames: string[];
  context: EvaluationContext;
}

export const STRATEGY_CAPABILITIES = {
  scorable: ["Confluences", "Execution confirmations", "Setup types"],
  executable: ["Sessions", "Max trades per day", "Max risk per trade", "Max daily risk", "Min execution score"],
  descriptive: ["Framework", "Entry models", "Timeframes", "Arsenal", "Trade-management rules (text)"],
} as const;

const fmtTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

/** A window [start, end) in minutes-of-day; end ≤ start wraps past midnight. */
export function inWindow(minute: number, start: number, end: number): boolean {
  if (start === end) return true;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** The conditions a trader can confirm for this direction / setup type. */
export function evaluationCandidates(snapshot: StrategyVersionSnapshot, direction: "LONG" | "SHORT", setupTypeName?: string | null) {
  if (setupTypeName) {
    const found = findHistoricalScenario(snapshot.setupTypes ?? [], setupTypeName, direction);
    if (!found) return { scenario: null, confluences: [] as ScorableConfluence[], execution: [] as ScorableConfluence[] };
    const scorable = toScorableConfluences(toReplayResolvedConditions(found.scenario));
    return { scenario: found.scenario.name || found.scenario.direction, confluences: scorable, execution: [] as ScorableConfluence[] };
  }
  const toScorable = (c: NonNullable<StrategyVersionSnapshot["confluences"]>[number]): ScorableConfluence => ({
    id: c.id ?? c.name,
    name: c.name,
    weight: c.weight,
    mandatory: c.mandatory,
    directionApplicability: c.directionApplicability ?? "BOTH",
  });
  return {
    scenario: null,
    confluences: (snapshot.confluences ?? []).filter((c) => c.enabled).map(toScorable),
    execution: (snapshot.execution ?? []).filter((c) => c.enabled).map(toScorable),
  };
}

export function evaluateStrategyDecision(input: EvaluationInput): StrategyEvaluation {
  const { snapshot, direction, context } = input;
  const candidates = evaluationCandidates(snapshot, direction, input.setupTypeName);
  const setupType =
    input.setupTypeName && candidates.scenario != null ? { name: input.setupTypeName, scenario: candidates.scenario } : null;

  const scored = scoreConfluences({ confluences: candidates.confluences, selectedNames: input.checkedNames, direction });
  // Execution confirmations (no setup type): mandatory ones gate the decision
  // too; they don't change the confluence probability score.
  const checkedSet = new Set(input.checkedNames.map((n) => n.trim().toLowerCase()));
  const missingExecution = candidates.execution.filter((e) => e.mandatory && !checkedSet.has(e.name.trim().toLowerCase())).map((e) => e.name);
  const missingMandatory = [...scored.missingMandatoryConfluenceNames, ...missingExecution];
  const anyConditions = candidates.confluences.length + candidates.execution.length > 0;

  const checks: EvaluationCheck[] = [];
  if (input.setupTypeName && !setupType) {
    checks.push({ rule: "MANDATORY_CONDITIONS", label: "Setup type", status: "FAIL", detail: `"${input.setupTypeName}" has no scenario for a ${direction === "LONG" ? "long" : "short"} trade.` });
  } else {
    checks.push({
      rule: "MANDATORY_CONDITIONS",
      label: "Mandatory conditions",
      status: !anyConditions ? "NOT_EVALUATED" : missingMandatory.length ? "FAIL" : "PASS",
      detail: !anyConditions ? "No conditions defined." : missingMandatory.length ? `Missing: ${missingMandatory.join(", ")}` : "All confirmed.",
    });
  }

  // Sessions (automatic).
  const windows = (snapshot.sessions ?? []).filter((s) => s.enabled && s.startMinutes != null && s.endMinutes != null);
  let session: string | null = null;
  if (windows.length === 0) {
    checks.push({ rule: "SESSION", label: "Trading session", status: "NOT_EVALUATED", detail: "No session windows with times are defined." });
  } else if (context.localMinuteOfDay == null) {
    checks.push({ rule: "SESSION", label: "Trading session", status: "NOT_EVALUATED", detail: "Replay time couldn't be placed in your timezone." });
  } else {
    const m = context.localMinuteOfDay;
    session = windows.find((w) => inWindow(m, w.startMinutes!, w.endMinutes!))?.name ?? null;
    checks.push({
      rule: "SESSION",
      label: "Trading session",
      status: session ? "PASS" : "FAIL",
      detail: session
        ? `${fmtTime(m)} ${context.timezoneLabel} is inside ${session}.`
        : `${fmtTime(m)} ${context.timezoneLabel} is outside ${windows.map((w) => `${w.name} ${fmtTime(w.startMinutes!)}–${fmtTime(w.endMinutes!)}`).join(", ")}.`,
    });
  }

  const tm = snapshot.tradeManagement;
  if (tm?.maxTradesPerDay != null) {
    const n = context.tradesTodayBefore + 1;
    checks.push({
      rule: "MAX_TRADES_PER_DAY",
      label: "Trades per day",
      status: n <= tm.maxTradesPerDay ? "PASS" : "FAIL",
      detail: `Trade ${n} today (limit ${tm.maxTradesPerDay}).`,
    });
  }
  if (tm?.maxRiskPercent != null) {
    checks.push(
      context.riskPercent == null
        ? { rule: "MAX_RISK_PER_TRADE", label: "Risk per trade", status: "NOT_EVALUATED", detail: "No stop loss — risk unknown." }
        : {
            rule: "MAX_RISK_PER_TRADE",
            label: "Risk per trade",
            status: context.riskPercent <= tm.maxRiskPercent + 1e-9 ? "PASS" : "FAIL",
            detail: `${pct(context.riskPercent)} (limit ${pct(tm.maxRiskPercent)}).`,
          },
    );
  }
  if (tm?.maxDailyRiskPercent != null) {
    const total = context.dayRiskPercentBefore + (context.riskPercent ?? 0);
    checks.push({
      rule: "MAX_DAILY_RISK",
      label: "Daily risk",
      status: context.riskPercent == null ? "NOT_EVALUATED" : total <= tm.maxDailyRiskPercent + 1e-9 ? "PASS" : "FAIL",
      detail: context.riskPercent == null ? "No stop loss — risk unknown." : `${pct(total)} today (limit ${pct(tm.maxDailyRiskPercent)}).`,
    });
  }
  if (tm?.minExecutionScore != null) {
    checks.push({
      rule: "MIN_EXECUTION_SCORE",
      label: "Minimum score",
      status: scored.score == null ? "NOT_EVALUATED" : scored.score >= tm.minExecutionScore ? "PASS" : "FAIL",
      detail: scored.score == null ? "Nothing to score." : `Score ${scored.score} (minimum ${tm.minExecutionScore}).`,
    });
  }

  const manualOnly = [
    snapshot.frameworkSteps?.length ? "Framework" : null,
    snapshot.entryModels?.length ? "Entry models" : null,
    snapshot.timeframes?.length ? "Timeframes" : null,
    snapshot.arsenalConcepts?.length ? "Arsenal" : null,
  ].filter((x): x is string => x != null);

  return {
    version: 1,
    direction,
    setupType,
    score: scored.score,
    rating: scored.rating,
    checked: input.checkedNames,
    missingMandatory,
    ineligibleChecked: scored.ineligibleSelectedConfluenceNames,
    session,
    checks,
    followedRules: checks.every((c) => c.status !== "FAIL"),
    manualOnly,
  };
}
