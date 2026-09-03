// Pure strategy-adherence / trade-quality scoring. Given the strategy's EXPECTED
// confluences + execution confirmations (frozen in the trade's snapshot) and what the
// trader actually selected, measure how closely the executed trade followed the
// predefined strategy. This is NOT a market-direction prediction — it's a discipline
// score. Count-based for now; `weight` is carried for future weighted scoring.
//
// Direction-aware: confluences that don't apply to the trade's direction are
// filtered out BEFORE the ratio, so a long trade is never marked "non-adherent"
// for skipping a bearish-only confluence (and vice-versa). This mirrors the
// eligibility rule in the weighted engine (domain/trades/confluence-score.ts) —
// there is still only one notion of "eligible".

import {
  isConfluenceEligible,
  type ConfluenceDirectionValue,
  type TradeDirectionValue,
} from "./confluence-score";

export interface AdherenceTag {
  name: string;
  color: string; // TagColor value, kept as a string here to stay framework/enum-free
  category?: string | null;
  weight?: number | null;
  /** CONFLUENCE only. Absent → BOTH (legacy snapshots). */
  directionApplicability?: ConfluenceDirectionValue | null;
}

export interface StrategyExpectedSet {
  sessions: AdherenceTag[];
  confluences: AdherenceTag[];
  execution: AdherenceTag[];
}

export interface AdherenceScores {
  confluencePercent: number | null;
  executionPercent: number | null;
  tradeQualityPercent: number | null;
}

function ratio(expectedNames: string[], selected: string[]): number | null {
  if (expectedNames.length === 0) return null;
  const expected = new Set(expectedNames.map((n) => n.toLowerCase()));
  const matched = new Set(
    selected.map((s) => s.toLowerCase()).filter((s) => expected.has(s)),
  ).size;
  return Math.round((matched / expectedNames.length) * 100);
}

/**
 * confluence% = (selected ∩ eligible expected) / eligible expected; same for
 * execution (execution confirmations are never direction-filtered). Trade quality
 * is the mean of whichever scores apply. All null when the strategy defined none.
 *
 * @param direction  LONG / SHORT restricts the expected confluence set to
 *   `<dir> + BOTH` before the ratio. Omit to keep the legacy behaviour (every
 *   expected confluence counts). `null` behaves like "no direction" → legacy.
 */
export function scoreStrategyAdherence(
  expected: Pick<StrategyExpectedSet, "confluences" | "execution"> | null,
  selectedConfluences: string[],
  selectedExecution: string[],
  direction?: TradeDirectionValue | null,
): AdherenceScores {
  const eligibleConfluences =
    direction == null
      ? (expected?.confluences ?? [])
      : (expected?.confluences ?? []).filter((c) =>
          isConfluenceEligible(c.directionApplicability, direction),
        );
  const confluencePercent = ratio(eligibleConfluences.map((c) => c.name), selectedConfluences);
  const executionPercent = ratio((expected?.execution ?? []).map((e) => e.name), selectedExecution);

  const parts = [confluencePercent, executionPercent].filter((x): x is number => x != null);
  const tradeQualityPercent = parts.length
    ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length)
    : null;

  return { confluencePercent, executionPercent, tradeQualityPercent };
}
