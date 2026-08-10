// The corrected Discrepancy model — the heart of TradeOS's most important
// distinction: NORMAL STRATEGY VARIANCE vs AVOIDABLE (trader-controlled) LEAKAGE.
//
// The old model computed `expectedR − actualR` per trade and called it "discrepancy",
// which penalised a correctly-executed loss (a −1R loss under a +0.65R-expectancy
// strategy looked like ~1.65R of "gap"). That is wrong: a losing trade with correct
// execution is normal strategy variance, never trader error.
//
// This module splits the two concepts cleanly:
//
//   SYSTEM A — Performance Variance
//     Expected *Statistical* Equity (Σ the strategy's expectancy over qualified
//     trades — NOT scaled by execution, NOT the planned target) vs Actual Equity.
//     Their difference is Performance Variance, which is mostly normal variance.
//
//   SYSTEM B — Avoidable Discrepancy
//     Only trader-controlled leakage: the OBJECTIVE R-cost of deviations (entry/exit/
//     risk slips, from the deviation-engine) plus validated missed-winner cost. A
//     perfectly-executed trade contributes 0 here, win OR loss. Process violations
//     with no objective price evidence raise the process flag but their outcome R is
//     UNDETERMINED (never fabricated).
//
//   Normal Variance = Performance Variance − Avoidable Discrepancy   (the residual)
//
// Pure + framework-free; fully tested.

import type { Deviation } from "./deviation-engine";

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── Per-trade classification ─────────────────────────────────────────────────

export type TradeClass =
  | "NORMAL_WIN"
  | "NORMAL_LOSS"
  | "NORMAL_BREAKEVEN"
  | "PROCESS_DISCREPANCY_WIN"
  | "PROCESS_DISCREPANCY_LOSS"
  | "UNVERIFIED"; // not enough process info to judge execution

export interface TradeProcessInput {
  /** Realized R multiple of the trade (null = open/unrecorded). */
  actualR: number | null;
  /** Objective planned-vs-actual deviations (from computeDeviations). Their costs
   *  are measurable R (a price slip), so they are legitimate avoidable R. */
  deviations: Deviation[];
  /** Did the trade follow its mandatory process? true = yes, false = a rule was
   *  broken (e.g. invalid setup taken / missing mandatory confluence), null = no
   *  strategy/adherence data. A false here is a process discrepancy even with no
   *  price-level evidence — but it adds NO fabricated R (outcome UNDETERMINED). */
  adherenceFollowed: boolean | null;
  /** Whether planned+actual price data exists to judge execution deviations. */
  hasExecutionData: boolean;
}

export interface TradeProcess {
  classification: TradeClass;
  /** Trader-controlled leakage in R — OBJECTIVE deviation costs only (≥ 0). Rule-only
   *  violations don't inflate this (their outcome R is UNDETERMINED). */
  avoidableR: number;
  /** Whether the trader deviated from process at all (price slip OR rule break). */
  processDiscrepancy: boolean;
  /** Sum of objective deviation costs (== avoidableR; surfaced for clarity). */
  deviationCostR: number;
}

/**
 * Classify one trade. The invariant that must hold: a trade with NO deviations and
 * followed process is NORMAL (win/loss/breakeven) with avoidableR = 0 — regardless
 * of whether it won or lost.
 */
export function classifyTrade(input: TradeProcessInput): TradeProcess {
  const deviationCostR = round2(input.deviations.reduce((s, d) => s + d.costR, 0));

  // Can we judge process at all? Need either execution data or an adherence signal.
  const canJudge = input.hasExecutionData || input.adherenceFollowed != null;
  if (!canJudge) {
    return { classification: "UNVERIFIED", avoidableR: 0, processDiscrepancy: false, deviationCostR: 0 };
  }

  const ruleBroken = input.adherenceFollowed === false;
  const processDiscrepancy = deviationCostR > 0 || ruleBroken;

  const r = input.actualR;
  let classification: TradeClass;
  if (processDiscrepancy) {
    classification = r != null && r > 0 ? "PROCESS_DISCREPANCY_WIN" : "PROCESS_DISCREPANCY_LOSS";
  } else if (r == null || r === 0) {
    classification = "NORMAL_BREAKEVEN";
  } else {
    classification = r > 0 ? "NORMAL_WIN" : "NORMAL_LOSS";
  }

  return { classification, avoidableR: deviationCostR, processDiscrepancy, deviationCostR };
}

// ── Portfolio summary: the two systems ───────────────────────────────────────

export interface DiscrepancyTradeInput {
  sequence: number;
  dateKey: string;
  /** The strategy's PURE expectancy R for this trade (System A benchmark). null when
   *  the strategy has no sufficient/known expectancy → the trade is unbenchmarked. */
  strategyExpectancyR: number | null;
  /** Realized R (self-reported). Counts on the Actual line whether benchmarked or not. */
  actualR: number | null;
  /** Trader-controlled avoidable R for this trade (from classifyTrade). */
  avoidableR: number;
}

export interface DiscrepancyCurvePoint {
  sequence: number;
  dateKey: string;
  actualEquity: number; // cumulative actual R
  expectedStatisticalEquity: number; // cumulative pure expectancy (benchmarked trades)
  performanceVariance: number; // expected − actual
}

export interface DiscrepancySummary {
  actualEquity: number;
  /** Σ strategy expectancy over benchmarked trades — the statistical benchmark. */
  expectedStatisticalEquity: number;
  /** Expected − Actual. NOT trader error — mostly normal variance. */
  performanceVariance: number;
  /** Σ objective avoidable R (executed) + validated missed-opportunity cost. */
  avoidableDiscrepancyR: number;
  /** performanceVariance − avoidableDiscrepancyR — the part that is NOT the trader's fault. */
  normalVarianceR: number;
  /** actual / expectedStatistical × 100 (efficiency vs the benchmark). null when no benchmark. */
  edgeCapturePercent: number | null;
  benchmarkedTrades: number;
  /** False → the sample has no expectancy benchmark at all (INSUFFICIENT_SAMPLE). */
  hasBenchmark: boolean;
}

export function buildDiscrepancyCurve(inputs: DiscrepancyTradeInput[]): DiscrepancyCurvePoint[] {
  const ordered = [...inputs].sort((a, b) => a.sequence - b.sequence);
  let actualEquity = 0;
  let expectedStatisticalEquity = 0;
  return ordered.map((i) => {
    if (i.actualR != null) actualEquity = round2(actualEquity + i.actualR);
    if (i.strategyExpectancyR != null) {
      expectedStatisticalEquity = round2(expectedStatisticalEquity + i.strategyExpectancyR);
    }
    return {
      sequence: i.sequence,
      dateKey: i.dateKey,
      actualEquity,
      expectedStatisticalEquity,
      performanceVariance: round2(expectedStatisticalEquity - actualEquity),
    };
  });
}

/**
 * The corrected summary. `missedOpportunityCostR` (validated missed winners, from
 * the Opportunity Engine) is added to the avoidable total — it is genuinely
 * trader-controlled (a valid setup skipped), unlike normal variance.
 */
export function summarizeDiscrepancy(
  inputs: DiscrepancyTradeInput[],
  missedOpportunityCostR = 0,
): DiscrepancySummary {
  let actualEquity = 0;
  let expectedStatisticalEquity = 0;
  let avoidableExecuted = 0;
  let benchmarkedTrades = 0;

  for (const i of inputs) {
    if (i.actualR != null) actualEquity = round2(actualEquity + i.actualR);
    if (i.strategyExpectancyR != null) {
      expectedStatisticalEquity = round2(expectedStatisticalEquity + i.strategyExpectancyR);
      benchmarkedTrades += 1;
    }
    avoidableExecuted = round2(avoidableExecuted + i.avoidableR);
  }

  const performanceVariance = round2(expectedStatisticalEquity - actualEquity);
  const avoidableDiscrepancyR = round2(avoidableExecuted + Math.max(0, missedOpportunityCostR));
  const hasBenchmark = benchmarkedTrades > 0;

  return {
    actualEquity,
    expectedStatisticalEquity,
    performanceVariance,
    avoidableDiscrepancyR,
    normalVarianceR: round2(performanceVariance - avoidableDiscrepancyR),
    edgeCapturePercent:
      hasBenchmark && expectedStatisticalEquity !== 0
        ? round2((actualEquity / expectedStatisticalEquity) * 100)
        : null,
    benchmarkedTrades,
    hasBenchmark,
  };
}
