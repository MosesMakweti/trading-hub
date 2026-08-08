// The Execution Engine — the single source of all Discrepancy-Gap math for TradeOS.
// Pure and framework-free: it takes each completed trade's strategy edge (expectancy),
// execution quality, and realized R, and produces the Expected vs Actual equity curves,
// the gap between them, and the derived efficiency / recoverable-edge / streak metrics.
//
// Every surface (Dashboard, Journal, Analytics, Psychology Lab) consumes this module —
// there is no duplicate discrepancy calculation anywhere else.
//
// Discipline lens, NOT a market prediction: "how much of a proven edge did execution
// actually capture?"

/** Optional planned-vs-actual deviation inputs. Populated in later phases (D5/D6);
 *  the engine already carries them so those phases don't reshape its contract. */
export interface ExecutionDeviations {
  entry?: number | null;
  exit?: number | null;
  risk?: number | null;
  session?: number | null;
  psychology?: number | null;
}

export interface ExecutionTradeInput {
  tradeNumber: number;
  dateKey: string; // YYYY-MM-DD
  /** The strategy's benchmark expected R per trade at full execution (its proven edge). */
  strategyExpectancyR: number | null;
  /** Composite execution quality 0–100 (adherence / setup / rule). null = unscored. */
  executionScore: number | null;
  /** Realized R multiple for the trade (actualRR). null = open / unrecorded. */
  actualR: number | null;
  deviations?: ExecutionDeviations;
}

export interface ExecutionTradeResult {
  tradeNumber: number;
  dateKey: string;
  executionScore: number | null;
  /** strategyExpectancyR × executionScore/100 — what this execution level should yield. */
  expectedR: number | null;
  actualR: number | null;
  /** expectedR − actualR (positive = under-captured vs your own execution level). */
  gapR: number | null;
  /** strategyExpectancyR − actualR — edge left on the table vs perfect execution. */
  recoverableR: number | null;
}

export interface DiscrepancyPoint {
  tradeNumber: number;
  dateKey: string;
  expectedEquity: number; // cumulative expectedR
  actualEquity: number; // cumulative actualR
  fullPotentialEquity: number; // cumulative strategyExpectancyR (100% execution)
  gap: number; // expectedEquity − actualEquity
  executionScore: number | null;
}

export type GapTrend = "shrinking" | "stable" | "growing";

export interface DiscrepancySummary {
  trades: number;
  expectedEquity: number;
  actualEquity: number;
  fullPotentialEquity: number;
  currentGap: number; // expectedEquity − actualEquity
  executionEfficiencyPercent: number | null; // actual / expected × 100
  edgeCapturePercent: number | null; // actual / full-potential × 100
  recoverableR: number; // fullPotentialEquity − actualEquity
  averageExecutionScore: number | null;
  bestExecutionStreak: number; // longest run of high-execution trades (≥ 80)
  worstExecutionStreak: number; // longest run of low-execution trades (< 65)
  gapTrend: GapTrend;
}

// Execution-quality bands for streaks (aligned with the setup-score rating bands).
const HIGH_EXECUTION = 80;
const LOW_EXECUTION = 65;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The single definition of a trade's composite execution quality (0–100), from its
 *  frozen scores. Used everywhere the engine is fed, so there is one source of truth. */
export function compositeExecutionScore(scores: {
  tradeQualityPercent: number | null;
  setupScore: number | null;
  confluencePercent: number | null;
}): number | null {
  return scores.tradeQualityPercent ?? scores.setupScore ?? scores.confluencePercent;
}

/** Per-trade expected / actual / gap. A trade with no strategy expectancy or no
 *  execution score can't be benchmarked → its expected/gap are null (excluded from
 *  the curves), though its actualR still counts on the Actual line. */
export function scoreTrade(input: ExecutionTradeInput): ExecutionTradeResult {
  const { strategyExpectancyR, executionScore, actualR } = input;
  const benchmarked = strategyExpectancyR != null && executionScore != null;
  const expectedR = benchmarked ? round2((strategyExpectancyR as number) * (executionScore! / 100)) : null;
  const gapR = expectedR != null && actualR != null ? round2(expectedR - actualR) : null;
  const recoverableR =
    strategyExpectancyR != null && actualR != null ? round2(strategyExpectancyR - actualR) : null;

  return {
    tradeNumber: input.tradeNumber,
    dateKey: input.dateKey,
    executionScore,
    expectedR,
    actualR,
    gapR,
    recoverableR,
  };
}

/** Cumulative Expected vs Actual equity, one point per trade (ordered by tradeNumber). */
export function buildDiscrepancyCurve(inputs: ExecutionTradeInput[]): DiscrepancyPoint[] {
  const ordered = [...inputs].sort((a, b) => a.tradeNumber - b.tradeNumber);
  let expectedEquity = 0;
  let actualEquity = 0;
  let fullPotentialEquity = 0;

  return ordered.map((input) => {
    const r = scoreTrade(input);
    if (r.expectedR != null) expectedEquity = round2(expectedEquity + r.expectedR);
    if (r.actualR != null) actualEquity = round2(actualEquity + r.actualR);
    if (input.strategyExpectancyR != null) {
      fullPotentialEquity = round2(fullPotentialEquity + input.strategyExpectancyR);
    }
    return {
      tradeNumber: input.tradeNumber,
      dateKey: input.dateKey,
      expectedEquity,
      actualEquity,
      fullPotentialEquity,
      gap: round2(expectedEquity - actualEquity),
      executionScore: r.executionScore,
    };
  });
}

function longestStreak(scores: (number | null)[], predicate: (s: number) => boolean): number {
  let best = 0;
  let run = 0;
  for (const s of scores) {
    if (s != null && predicate(s)) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

function gapTrend(points: DiscrepancyPoint[]): GapTrend {
  if (points.length < 4) return "stable";
  const mid = Math.floor(points.length / 2);
  // Average gap accrued per trade in the first half vs the second half.
  const firstHalfGap = points[mid - 1].gap;
  const secondHalfGap = points[points.length - 1].gap - firstHalfGap;
  const firstRate = firstHalfGap / mid;
  const secondRate = secondHalfGap / (points.length - mid);
  const delta = secondRate - firstRate;
  const epsilon = 0.05; // R per trade — below this the gap is holding steady
  if (delta < -epsilon) return "shrinking";
  if (delta > epsilon) return "growing";
  return "stable";
}

export function summarizeDiscrepancy(inputs: ExecutionTradeInput[]): DiscrepancySummary {
  const points = buildDiscrepancyCurve(inputs);
  const last = points[points.length - 1];

  const expectedEquity = last?.expectedEquity ?? 0;
  const actualEquity = last?.actualEquity ?? 0;
  const fullPotentialEquity = last?.fullPotentialEquity ?? 0;

  const execScores = inputs.map((i) => i.executionScore).filter((s): s is number => s != null);
  const averageExecutionScore = execScores.length
    ? round1(execScores.reduce((a, b) => a + b, 0) / execScores.length)
    : null;

  const orderedScores = [...inputs]
    .sort((a, b) => a.tradeNumber - b.tradeNumber)
    .map((i) => i.executionScore);

  return {
    trades: points.length,
    expectedEquity,
    actualEquity,
    fullPotentialEquity,
    currentGap: round2(expectedEquity - actualEquity),
    executionEfficiencyPercent:
      expectedEquity !== 0 ? round1((actualEquity / expectedEquity) * 100) : null,
    edgeCapturePercent:
      fullPotentialEquity !== 0 ? round1((actualEquity / fullPotentialEquity) * 100) : null,
    recoverableR: round2(fullPotentialEquity - actualEquity),
    averageExecutionScore,
    bestExecutionStreak: longestStreak(orderedScores, (s) => s >= HIGH_EXECUTION),
    worstExecutionStreak: longestStreak(orderedScores, (s) => s < LOW_EXECUTION),
    gapTrend: gapTrend(points),
  };
}
