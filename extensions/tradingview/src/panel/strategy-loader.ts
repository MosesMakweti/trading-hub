/**
 * Traditorium TradingView Extension — Step 6, §16. Race-protected strategy
 * reference loading.
 *
 * "Late response overwrites a newer selection" is a real, easy-to-hit bug
 * here: the trader can click Strategy A, then Strategy B before A's
 * `GET_STRATEGY_REFERENCE` round trip finishes. Without this guard, A's
 * response could land AFTER B's and silently repaint B's picker with A's
 * confluences/entry-models — controls that "appear valid but actually
 * belong to the previous strategy" (§16's own words for exactly this bug).
 *
 * Pure orchestration: `fetchReference` is injected (never imports
 * chrome.runtime.sendMessage itself), so this is fully unit-testable with
 * manually-resolved promises — no DOM, no chrome.* mock, no timers. See
 * strategy-loader.test.ts.
 */
import type { StrategyReference, StrategyReferenceResult } from "@shared/strategy";

export type StrategyReferenceFetcher = (strategyId: string) => Promise<StrategyReferenceResult>;

export type StrategyLoadState =
  | { status: "idle" }
  | { status: "loading"; strategyId: string }
  | { status: "loaded"; strategyId: string; strategy: StrategyReference }
  | { status: "error"; strategyId: string; message: string };

export interface StrategyLoader {
  /** `null` clears the selection back to "idle" without any fetch. */
  request(strategyId: string | null): void;
}

export function createStrategyLoader(
  fetchReference: StrategyReferenceFetcher,
  onChange: (state: StrategyLoadState) => void,
): StrategyLoader {
  let latestRequestedId: string | null = null;

  return {
    request(strategyId: string | null) {
      latestRequestedId = strategyId;

      if (strategyId == null) {
        onChange({ status: "idle" });
        return;
      }

      onChange({ status: "loading", strategyId });
      void fetchReference(strategyId).then((result) => {
        // A newer request superseded this one while it was in flight —
        // discard silently, never paint a stale strategy over a newer pick.
        if (latestRequestedId !== strategyId) return;

        onChange(
          result.ok
            ? { status: "loaded", strategyId, strategy: result.strategy }
            : { status: "error", strategyId, message: result.message },
        );
      });
    },
  };
}
