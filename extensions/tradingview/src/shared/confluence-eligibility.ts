/**
 * Traditorium TradingView Extension — Step 6. Direction-aware confluence
 * eligibility (§6/§22).
 *
 * This is a deliberate, minimal PORT — not a reuse-by-import — of
 * `src/domain/trades/confluence-score.ts::isConfluenceEligible` in the main
 * Next.js app. It is not imported directly because this extension package
 * has no build-time path to the app's `src/` (see README.md's "Why this
 * lives outside src/" — the extension has its own isolated tsconfig/build,
 * on purpose, so it can never accidentally pull in a server-only module).
 *
 * §21/§23 draw a line between "genuinely shared pure logic" (fine to reuse)
 * and "scoring formulas" (never duplicate — skip the feature instead). This
 * one three-line eligibility PREDICATE is the former, not the latter: it is
 * not a weighting/scoring formula, just "is this confluence even a candidate
 * for this direction," and Step 6 cannot filter its confluence checklist at
 * all without some copy of this exact rule living in the extension.
 *
 * CONTRACT DRIFT (§20): if the server's rule ever changes, this file will
 * NOT know automatically. The only current safeguard is
 * `confluence-eligibility.test.ts`'s truth table, which intentionally
 * mirrors the exact cases documented in the server's own
 * `confluence-score.ts` doc comment and `docs/extension-api.md`'s
 * "Direction-aware eligibility" section — a future change to either side
 * without updating the other will not be caught automatically. See
 * README.md's "Strategy contract drift" section.
 */
import type { ConfluenceDirection, TradeDirection } from "./strategy";

/** null direction = "no direction chosen yet" -> nothing is eligible yet,
 *  matching the server's own `isConfluenceEligible(applicability, null)`. */
export function isConfluenceEligible(
  applicability: ConfluenceDirection | null | undefined,
  direction: TradeDirection | null,
): boolean {
  if (direction == null) return false;
  const a = applicability ?? "BOTH";
  return a === "BOTH" || (direction === "LONG" && a === "BULLISH") || (direction === "SHORT" && a === "BEARISH");
}
