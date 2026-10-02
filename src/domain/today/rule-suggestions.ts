// Today V3 (Phase 1) — "Today's Rules". Pure and framework-free.
//
// Strategy Lab already knows a strategy's daily limits; the trader should
// CONFIRM them for today rather than retype them. These helpers turn the
// limits of today's active strategies (DailyAssetAnalysis.activeStrategyId)
// into a SUGGESTION and classify it against what the trader has CONFIRMED
// (TradingDay.riskBudgetPercent / maxTradesPerDay). A suggestion is never
// stored — only an explicit confirm writes the day column.

export interface StrategyLimitSource {
  strategyId: string;
  strategyName: string;
  maxDailyRiskPercent: number | null;
  maxTradesPerDay: number | null;
}

export interface LimitSuggestion {
  /** The strictest (lowest) configured value across today's strategies. */
  value: number;
  /** Every strategy that configures this limit, with its own value. */
  sources: { strategyId: string; strategyName: string; value: number }[];
  /** Names of the strategies whose value IS the strictest one. */
  strictestFrom: string[];
}

export type LimitKey = "maxDailyRiskPercent" | "maxTradesPerDay";

/** Strictest-wins: the lowest configured limit among the given strategies.
 *  Null when none of them configures it. Duplicate strategy ids are counted once. */
export function suggestLimit(strategies: StrategyLimitSource[], key: LimitKey): LimitSuggestion | null {
  const seen = new Set<string>();
  const sources: LimitSuggestion["sources"] = [];
  for (const s of strategies) {
    if (seen.has(s.strategyId)) continue;
    seen.add(s.strategyId);
    const value = s[key];
    if (value == null || !Number.isFinite(value)) continue;
    sources.push({ strategyId: s.strategyId, strategyName: s.strategyName, value });
  }
  if (sources.length === 0) return null;
  const value = Math.min(...sources.map((s) => s.value));
  return {
    value,
    sources,
    strictestFrom: sources.filter((s) => s.value === value).map((s) => s.strategyName),
  };
}

/**
 * How the confirmed day value relates to the suggestion:
 *  - NOT_SET:            nothing confirmed and nothing to suggest
 *  - SUGGESTED:          a suggestion exists but the trader hasn't confirmed anything
 *  - CONFIRMED:          confirmed, equal to the suggestion
 *  - CONFIRMED_DIFFERENT: confirmed, but not the suggested value (a deliberate choice)
 *  - CONFIRMED_MANUAL:   confirmed with no suggestion available
 */
export type ConfirmationState = "NOT_SET" | "SUGGESTED" | "CONFIRMED" | "CONFIRMED_DIFFERENT" | "CONFIRMED_MANUAL";

export function confirmationState(suggested: number | null, confirmed: number | null): ConfirmationState {
  if (confirmed == null) return suggested == null ? "NOT_SET" : "SUGGESTED";
  if (suggested == null) return "CONFIRMED_MANUAL";
  return nearlyEqual(confirmed, suggested) ? "CONFIRMED" : "CONFIRMED_DIFFERENT";
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

/** Session names from today's strategies that the day doesn't list yet
 *  (case-insensitive), in first-seen order. Never removes anything. */
export function suggestSessions(strategySessions: string[][], activeSessions: string[]): string[] {
  const have = new Set(activeSessions.map((s) => s.trim().toLowerCase()));
  const out: string[] = [];
  for (const list of strategySessions) {
    for (const raw of list) {
      const name = raw.trim();
      const key = name.toLowerCase();
      if (!name || have.has(key)) continue;
      have.add(key);
      out.push(name);
    }
  }
  return out;
}
