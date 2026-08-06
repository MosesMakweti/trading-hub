// Pure strategy-adherence / trade-quality scoring. Given the strategy's EXPECTED
// confluences + execution confirmations (frozen in the trade's snapshot) and what the
// trader actually selected, measure how closely the executed trade followed the
// predefined strategy. This is NOT a market-direction prediction — it's a discipline
// score. Count-based for now; `weight` is carried for future weighted scoring.

export interface AdherenceTag {
  name: string;
  color: string; // TagColor value, kept as a string here to stay framework/enum-free
  category?: string | null;
  weight?: number | null;
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
 * confluence% = (selected ∩ expected) / expected; same for execution. Trade quality
 * is the mean of whichever scores apply. All null when the strategy defined none.
 */
export function scoreStrategyAdherence(
  expected: Pick<StrategyExpectedSet, "confluences" | "execution"> | null,
  selectedConfluences: string[],
  selectedExecution: string[],
): AdherenceScores {
  const confluencePercent = ratio((expected?.confluences ?? []).map((c) => c.name), selectedConfluences);
  const executionPercent = ratio((expected?.execution ?? []).map((e) => e.name), selectedExecution);

  const parts = [confluencePercent, executionPercent].filter((x): x is number => x != null);
  const tradeQualityPercent = parts.length
    ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length)
    : null;

  return { confluencePercent, executionPercent, tradeQualityPercent };
}
