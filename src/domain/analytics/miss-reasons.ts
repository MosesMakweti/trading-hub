// Behavioral aggregation of WHY valid setups were missed. Pure and framework-free.
// Turns each missed opportunity's reason + trader-entered forgone R into a ranked
// breakdown, and separates disciplined passes (a conscious, correct stand-aside)
// from lapses (fear, hesitation, distraction, …) — the discipline signal the
// Psychology Lab surfaces. Only missed WINNERS carry an R cost (avoiding a loss is
// free), consistent with the Opportunity Engine.

export type MissReasonKey =
  | "FEAR"
  | "HESITATION"
  | "FOMO_ELSEWHERE"
  | "DISTRACTED"
  | "MISSED_ALERT"
  | "LATE_CONFIRMATION"
  | "RISK_CONCERNS"
  | "TECHNICAL_ISSUE"
  | "RULE_UNCERTAINTY"
  | "INTENTIONAL_SKIP"
  | "OTHER";

// A missed setup is only a "good miss" when the trader consciously and correctly
// stood aside — a disciplined pass, not a behavioral lapse.
const DISCIPLINED: ReadonlySet<MissReasonKey> = new Set(["INTENTIONAL_SKIP", "RISK_CONCERNS"]);

export interface MissReasonRow {
  reason: MissReasonKey | null;
  /** Trader-entered forgone R (null = UNDETERMINED). Only positive = missed winner. */
  missedRealizedR: number | null;
}

export interface MissReasonStat {
  reason: MissReasonKey;
  count: number;
  /** Σ forgone R on missed winners for this reason (cost of the lapse). */
  missedCostR: number;
  disciplined: boolean;
}

export interface MissReasonAggregate {
  byReason: MissReasonStat[]; // ranked: most costly first, then most frequent
  totalMissed: number;
  /** Missed via a behavioral lapse (fear/hesitation/…). */
  lapseCount: number;
  lapseCostR: number;
  /** Missed via a disciplined, intentional pass. */
  disciplinedCount: number;
  /** The single most expensive lapse category, if any winner was forgone. */
  costliestLapse: MissReasonStat | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function aggregateMissReasons(rows: MissReasonRow[]): MissReasonAggregate {
  const map = new Map<MissReasonKey, MissReasonStat>();
  let totalMissed = 0;
  let lapseCount = 0;
  let lapseCostR = 0;
  let disciplinedCount = 0;

  for (const row of rows) {
    const reason: MissReasonKey = row.reason ?? "OTHER";
    const disciplined = DISCIPLINED.has(reason);
    const cost = row.missedRealizedR != null && row.missedRealizedR > 0 ? row.missedRealizedR : 0;

    totalMissed += 1;
    if (disciplined) disciplinedCount += 1;
    else {
      lapseCount += 1;
      lapseCostR = round2(lapseCostR + cost);
    }

    const existing = map.get(reason);
    if (existing) {
      existing.count += 1;
      existing.missedCostR = round2(existing.missedCostR + cost);
    } else {
      map.set(reason, { reason, count: 1, missedCostR: cost, disciplined });
    }
  }

  const byReason = [...map.values()].sort(
    (a, b) => b.missedCostR - a.missedCostR || b.count - a.count,
  );

  const costliestLapse =
    byReason.find((r) => !r.disciplined && r.missedCostR > 0) ?? null;

  return {
    byReason,
    totalMissed,
    lapseCount,
    lapseCostR,
    disciplinedCount,
    costliestLapse,
  };
}
