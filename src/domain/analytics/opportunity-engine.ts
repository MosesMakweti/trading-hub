// The Opportunity Engine — the discrepancy decomposition for the Trade Opportunity
// architecture. It sits ON TOP of the Execution Engine (it reuses `scoreTrade` for
// the executed branch — no duplicate discrepancy math) and adds the *missed* branch,
// so the total gap can be split into WHY it happened:
//
//   Total Discrepancy  =  Execution Leakage        (edge lost on trades you TOOK)
//                       + Missed Opportunity Cost   (edge forgone on valid setups you SKIPPED)
//
// (Risk-deviation cost is a further breakdown of Execution Leakage; it lives in the
// deviation-engine and is not re-derived here.)
//
// Rules baked in, straight from the spec:
//   • Only VALID setups (setupValid) affect the gap. Invalid setups are excluded.
//   • One opportunity → one outcome (EXECUTED xor MISSED). No double-counting: an
//     executed opportunity never also counts as missed.
//   • A missed LOSER is NOT a penalty — you correctly avoided a loss (cost 0).
//   • A missed UNDETERMINED (no trader-entered result) is tracked for behavior but
//     excluded from the R cost — outcomes are trader-entered, never fabricated.
//
// Pure and framework-free; every surface consumes this one module.

import { scoreTrade } from "./execution-engine";

export type OpportunityOutcome = "EXECUTED" | "MISSED";

export interface OpportunityInput {
  opportunityId: string;
  /** Ordering key (spotted order). */
  sequence: number;
  dateKey: string; // YYYY-MM-DD
  outcome: OpportunityOutcome;
  /** setupValid — only valid opportunities affect the gap. false/null → excluded. */
  valid: boolean;
  /** The strategy's proven edge per trade (expectancy), frozen at spot time. */
  strategyExpectancyR: number | null;

  // EXECUTED branch (ignored when outcome = MISSED):
  /** Composite execution quality 0–100 for the trade that was taken. */
  executionScore?: number | null;
  /** Realized R multiple of the executed trade. */
  actualR?: number | null;

  // MISSED branch (ignored when outcome = EXECUTED):
  /** Trader-entered realized-if-taken R (+3 missed win, −1 missed loss, 0 BE).
   *  null = UNDETERMINED → excluded from the R cost. */
  missedRealizedR?: number | null;
}

export interface OpportunityCurvePoint {
  sequence: number;
  dateKey: string;
  /** Cumulative realized R actually banked (executed trades only). */
  realizedEquity: number;
  /** Cumulative execution leakage (net expected − actual on executed valid trades). */
  leakageEquity: number;
  /** Cumulative missed opportunity cost (forgone R on valid missed winners). */
  missedCostEquity: number;
  /** realizedEquity + leakageEquity + missedCostEquity — disciplined full-capture line. */
  potentialEquity: number;
}

export interface OpportunitySummary {
  // ── Funnel ────────────────────────────────────────────────────────────────
  /** Valid setups (executed + missed) — the real opportunity denominator. */
  validOpportunities: number;
  /** Setups that failed their own rules (setupValid false) — excluded from the gap. */
  invalidOpportunities: number;
  executed: number; // valid & executed
  missed: number; // valid & missed
  /** executed / valid × 100 — how often a spotted valid setup was actually taken. */
  executionRatePercent: number | null;

  // ── R decomposition (the "why") ─────────────────────────────────────────────
  /** Σ (expectedR − actualR) over executed valid trades. +ve = under-captured. */
  executionLeakageR: number;
  /** Σ max(0, missedRealizedR) over valid missed trades — forgone winners only. */
  missedOpportunityCostR: number;
  /** executionLeakageR + missedOpportunityCostR. */
  totalDiscrepancyR: number;

  // ── Edge capture ────────────────────────────────────────────────────────────
  /** Σ actualR over executed valid trades — the R actually banked. */
  realizedR: number;
  /** realizedR + totalDiscrepancyR — R a disciplined full capture would have made. */
  potentialR: number;
  /** realizedR / potentialR × 100 — share of available edge actually captured. */
  edgeCapturePercent: number | null;

  // ── Missed-outcome breakdown (behavioral) ───────────────────────────────────
  missedWins: number;
  missedLosses: number;
  missedBreakeven: number;
  missedUndetermined: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Per-opportunity contribution to the decomposition. Invalid setups contribute
 *  nothing (excluded from the gap entirely). */
interface OpportunityContribution {
  realizedR: number; // banked R (executed only)
  leakageR: number; // execution gap (executed valid only)
  missedCostR: number; // forgone winner R (missed valid only)
}

function contribution(input: OpportunityInput): OpportunityContribution {
  const zero: OpportunityContribution = { realizedR: 0, leakageR: 0, missedCostR: 0 };
  if (!input.valid) return zero; // invalid setup — never affects the gap

  if (input.outcome === "EXECUTED") {
    // Reuse the Execution Engine — no duplicate discrepancy math.
    const r = scoreTrade({
      tradeNumber: input.sequence,
      dateKey: input.dateKey,
      strategyExpectancyR: input.strategyExpectancyR,
      executionScore: input.executionScore ?? null,
      actualR: input.actualR ?? null,
    });
    return {
      realizedR: r.actualR ?? 0,
      leakageR: r.gapR ?? 0, // expectedR − actualR (net; null when unbenchmarked → 0)
      missedCostR: 0,
    };
  }

  // MISSED: forgone R, winners only. Losers/BE/UNDETERMINED cost nothing.
  const forgone = input.missedRealizedR ?? null;
  return {
    realizedR: 0,
    leakageR: 0,
    missedCostR: forgone != null && forgone > 0 ? forgone : 0,
  };
}

/** Cumulative realized / leakage / missed-cost / potential, one point per opportunity
 *  (ordered by sequence). Invalid setups are dropped from the curve. */
export function buildOpportunityCurve(inputs: OpportunityInput[]): OpportunityCurvePoint[] {
  const ordered = [...inputs].filter((i) => i.valid).sort((a, b) => a.sequence - b.sequence);
  let realizedEquity = 0;
  let leakageEquity = 0;
  let missedCostEquity = 0;

  return ordered.map((input) => {
    const c = contribution(input);
    realizedEquity = round2(realizedEquity + c.realizedR);
    leakageEquity = round2(leakageEquity + c.leakageR);
    missedCostEquity = round2(missedCostEquity + c.missedCostR);
    return {
      sequence: input.sequence,
      dateKey: input.dateKey,
      realizedEquity,
      leakageEquity,
      missedCostEquity,
      potentialEquity: round2(realizedEquity + leakageEquity + missedCostEquity),
    };
  });
}

export function summarizeOpportunities(inputs: OpportunityInput[]): OpportunitySummary {
  let validOpportunities = 0;
  let invalidOpportunities = 0;
  let executed = 0;
  let missed = 0;
  let executionLeakageR = 0;
  let missedOpportunityCostR = 0;
  let realizedR = 0;
  let missedWins = 0;
  let missedLosses = 0;
  let missedBreakeven = 0;
  let missedUndetermined = 0;

  for (const input of inputs) {
    if (!input.valid) {
      invalidOpportunities += 1;
      continue;
    }
    validOpportunities += 1;
    const c = contribution(input);
    realizedR = round2(realizedR + c.realizedR);
    executionLeakageR = round2(executionLeakageR + c.leakageR);
    missedOpportunityCostR = round2(missedOpportunityCostR + c.missedCostR);

    if (input.outcome === "EXECUTED") {
      executed += 1;
    } else {
      missed += 1;
      const forgone = input.missedRealizedR ?? null;
      if (forgone == null) missedUndetermined += 1;
      else if (forgone > 0) missedWins += 1;
      else if (forgone < 0) missedLosses += 1;
      else missedBreakeven += 1;
    }
  }

  const totalDiscrepancyR = round2(executionLeakageR + missedOpportunityCostR);
  const potentialR = round2(realizedR + totalDiscrepancyR);

  return {
    validOpportunities,
    invalidOpportunities,
    executed,
    missed,
    executionRatePercent: validOpportunities > 0 ? round1((executed / validOpportunities) * 100) : null,
    executionLeakageR,
    missedOpportunityCostR,
    totalDiscrepancyR,
    realizedR,
    potentialR,
    edgeCapturePercent: potentialR !== 0 ? round1((realizedR / potentialR) * 100) : null,
    missedWins,
    missedLosses,
    missedBreakeven,
    missedUndetermined,
  };
}
