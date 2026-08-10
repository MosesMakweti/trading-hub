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

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Avoidable R charged to a trade the trader would NOT take again. */
export const WOULD_NOT_REPEAT_COST_R = 1;

// ── Per-trade classification ─────────────────────────────────────────────────

export type TradeClass =
  | "NORMAL_WIN"
  | "NORMAL_LOSS"
  | "NORMAL_BREAKEVEN"
  | "PROCESS_DISCREPANCY_WIN"
  | "PROCESS_DISCREPANCY_LOSS"
  | "UNVERIFIED"; // "Would I take this again?" not answered → can't judge

export interface TradeProcessInput {
  /** Realized R multiple of the trade (null = open/unrecorded). */
  actualR: number | null;
  /** The trader's retrospective judgment: "Would I take this trade again?" — the
   *  signal for avoidable discrepancy. A trade you would NOT repeat was an avoidable
   *  process error (worth WOULD_NOT_REPEAT_COST_R), whatever its result.
   *  true = worth repeating, false = would not repeat, null = not answered. */
  wouldTakeAgain: boolean | null;
}

export interface TradeProcess {
  classification: TradeClass;
  /** Trader-controlled leakage in R: WOULD_NOT_REPEAT_COST_R when the trader would
   *  not take the trade again, else 0. The trade's win/loss is irrelevant. */
  avoidableR: number;
  processDiscrepancy: boolean;
}

/**
 * Classify one trade from "Would I take this trade again?".
 *   • No  → PROCESS_DISCREPANCY_* + avoidableR = 1R (an avoidable mistake).
 *   • Yes → NORMAL_* + avoidableR = 0 (correct process — a losing "Yes" is a NORMAL
 *           loss, never penalised).
 *   • unanswered → UNVERIFIED + 0 (nothing to judge; no fabricated discrepancy).
 */
export function classifyTrade({ actualR, wouldTakeAgain }: TradeProcessInput): TradeProcess {
  if (wouldTakeAgain == null) {
    return { classification: "UNVERIFIED", avoidableR: 0, processDiscrepancy: false };
  }
  if (wouldTakeAgain === false) {
    return {
      classification: actualR != null && actualR > 0 ? "PROCESS_DISCREPANCY_WIN" : "PROCESS_DISCREPANCY_LOSS",
      avoidableR: WOULD_NOT_REPEAT_COST_R,
      processDiscrepancy: true,
    };
  }
  const classification: TradeClass =
    actualR == null || actualR === 0 ? "NORMAL_BREAKEVEN" : actualR > 0 ? "NORMAL_WIN" : "NORMAL_LOSS";
  return { classification, avoidableR: 0, processDiscrepancy: false };
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
  /** Cumulative avoidable discrepancy (Σ 1R per "would not take again" trade). */
  avoidableEquity: number;
  /** actualEquity + avoidableEquity — where equity would be without the avoidable
   *  trades. The GAP between this and Actual is the avoidable discrepancy (the graph). */
  discrepancyFreeEquity: number;
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
  let avoidableEquity = 0;
  let expectedStatisticalEquity = 0;
  return ordered.map((i) => {
    if (i.actualR != null) actualEquity = round2(actualEquity + i.actualR);
    avoidableEquity = round2(avoidableEquity + i.avoidableR);
    if (i.strategyExpectancyR != null) {
      expectedStatisticalEquity = round2(expectedStatisticalEquity + i.strategyExpectancyR);
    }
    return {
      sequence: i.sequence,
      dateKey: i.dateKey,
      actualEquity,
      avoidableEquity,
      discrepancyFreeEquity: round2(actualEquity + avoidableEquity),
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
