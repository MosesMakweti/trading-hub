/**
 * Traditorium TradingView Extension — Step 7, §5. Safe asset-compatibility
 * matching only — no symbol-mapping engine, no fuzzy matching, no guessing.
 *
 * IMPORTANT FINDING (documented because it isn't what the Step 7 brief
 * implies): the web app's OWN Add Trade form does not hard-enforce
 * `assetSymbol` against `strategy.applicableAssets` at all — it's used only
 * as autocomplete SUGGESTIONS (`components/journal/trade-form.tsx`'s
 * `strategyReference?.applicableAssets` feeding a datalist), and
 * `tradeSchema.assetSymbol` is just `z.string().trim().min(1)` — no
 * cross-check against the strategy server-side. This function is therefore
 * a NEW, extension-only UX guard, not a port of an existing server rule —
 * because the extension is acting mostly unsupervised (no human eyeballing
 * a suggestion list before typing), a harder guard here is the right
 * trade-off, matching §5's explicit instruction: "Do not silently submit an
 * incompatible asset."
 *
 * Matching rule: the chart's PARSED DISPLAY symbol (exchange prefix already
 * stripped by @shared/symbol-parser.ts — e.g. "OANDA:XAUUSD" -> "XAUUSD")
 * compared case-insensitively, trimmed, against each configured asset. No
 * partial/substring/fuzzy matching — an ambiguous or unrecognized asset is
 * never silently accepted; the trader must fix it themselves (in either the
 * chart or the strategy's configured assets).
 */
export function isAssetCompatible(displaySymbol: string, applicableAssets: readonly string[]): boolean {
  // An empty configured-assets list means the strategy places no
  // constraint at all (matches the web app's own permissive default —
  // "no assets configured" has never meant "no assets allowed").
  if (applicableAssets.length === 0) return true;

  const normalized = displaySymbol.trim().toUpperCase();
  return applicableAssets.some((asset) => asset.trim().toUpperCase() === normalized);
}
