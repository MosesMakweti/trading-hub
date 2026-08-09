// Pure bridge from stored TradeOpportunity rows to the Opportunity Engine's inputs.
// Kept DB-agnostic (plain numbers, no Prisma Decimals) so it is unit-testable and
// carries the single rule for WHICH opportunities feed the discrepancy math:
//   • Only RESOLVED opportunities count — EXECUTED or MISSED.
//   • PENDING (still monitoring), INVALIDATED (broke its rules), and EXPIRED
//     (window passed, never triggered) are NOT misses and never feed the gap.
// Validity (setupValid) is passed through untouched — the engine excludes invalid
// setups from the R cost while still counting them in the funnel.

import { compositeExecutionScore } from "./execution-engine";
import type { OpportunityInput } from "./opportunity-engine";

export type OpportunityRowStatus =
  | "PENDING"
  | "EXECUTED"
  | "MISSED"
  | "INVALIDATED"
  | "EXPIRED";

export interface OpportunityRow {
  id: string;
  status: OpportunityRowStatus;
  /** Spotted day key (YYYY-MM-DD) — primary ordering. */
  spottedAtKey: string;
  /** Creation instant (ms) — stable tiebreak within a day. */
  createdAtMs: number;
  setupValid: boolean | null;
  /** Strategy's proven edge per trade, frozen at spot time. */
  expectedExpectancyR: number | null;
  /** Trader-entered realized-if-taken R for a MISSED setup (null = UNDETERMINED). */
  missedRealizedR: number | null;
  /** The linked executed trade's scores, when status = EXECUTED. */
  executedTrade: {
    actualR: number | null; // actualRR
    tradeQualityPercent: number | null;
    setupScore: number | null;
    confluencePercent: number | null;
  } | null;
}

/** Resolved opportunities → engine inputs, ordered by spotted day then creation,
 *  with a stable 1-based sequence. Unresolved statuses are dropped. */
export function toOpportunityInputs(rows: OpportunityRow[]): OpportunityInput[] {
  const resolved = rows
    .filter((r) => r.status === "EXECUTED" || r.status === "MISSED")
    .sort((a, b) =>
      a.spottedAtKey === b.spottedAtKey
        ? a.createdAtMs - b.createdAtMs
        : a.spottedAtKey < b.spottedAtKey
          ? -1
          : 1,
    );

  return resolved.map((r, i) => {
    const sequence = i + 1;
    if (r.status === "EXECUTED") {
      const t = r.executedTrade;
      return {
        opportunityId: r.id,
        sequence,
        dateKey: r.spottedAtKey,
        outcome: "EXECUTED",
        valid: r.setupValid === true,
        strategyExpectancyR: r.expectedExpectancyR,
        executionScore: t
          ? compositeExecutionScore({
              tradeQualityPercent: t.tradeQualityPercent,
              setupScore: t.setupScore,
              confluencePercent: t.confluencePercent,
            })
          : null,
        actualR: t?.actualR ?? null,
      } satisfies OpportunityInput;
    }
    return {
      opportunityId: r.id,
      sequence,
      dateKey: r.spottedAtKey,
      outcome: "MISSED",
      valid: r.setupValid === true,
      strategyExpectancyR: r.expectedExpectancyR,
      missedRealizedR: r.missedRealizedR,
    } satisfies OpportunityInput;
  });
}
