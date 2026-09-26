/**
 * Backtesting (Stage 2) — has the Strategy Lab strategy changed since a
 * Backtest Run froze its snapshot?
 *
 * Purely informational: the run keeps using its frozen snapshot, and nothing
 * here ever rewrites it. Both sides are StrategyVersionSnapshot-shaped JSON
 * (the frozen one captured at run creation, the current one captured on the
 * fly with the same builder). The comparison is on canonical JSON (sorted
 * keys) because the frozen side has round-tripped through Postgres `jsonb`,
 * which does not preserve key order. `status` (Draft/Testing/Live/Archived)
 * is ignored — promoting a strategy isn't a change to its methodology.
 */

import { canonicalJson as canonicalJsonOf } from "@/lib/canonical-json";

export type StrategyDriftState =
  /** The run wasn't created against a strategy. */
  | "NO_STRATEGY"
  /** The live strategy still matches the frozen snapshot. */
  | "UNCHANGED"
  /** The live strategy's methodology differs from the frozen snapshot. */
  | "CHANGED"
  /** The strategy has since been deleted from Strategy Lab. */
  | "STRATEGY_REMOVED";

const IGNORED_KEYS = new Set(["status"]);

export function canonicalJson(value: unknown): string {
  return canonicalJsonOf(value, IGNORED_KEYS);
}

export function detectStrategyDrift(input: {
  /** Whether the run was created against a strategy at all. */
  hadStrategy: boolean;
  frozenSnapshot: unknown;
  /** Null when the strategy no longer exists (or no longer belongs to the user). */
  currentSnapshot: unknown | null;
}): StrategyDriftState {
  if (!input.hadStrategy || input.frozenSnapshot == null) return "NO_STRATEGY";
  if (input.currentSnapshot == null) return "STRATEGY_REMOVED";
  return canonicalJson(input.frozenSnapshot) === canonicalJson(input.currentSnapshot) ? "UNCHANGED" : "CHANGED";
}
