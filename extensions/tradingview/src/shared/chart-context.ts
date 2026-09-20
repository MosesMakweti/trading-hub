/**
 * Traditorium TradingView Extension — Step 5. The chart-context model.
 * Deliberately independent of Traditorium's Trade model (§3 — "chart
 * context is browser-derived context, not yet a trade"). Nothing here maps
 * to a Prisma model or the tradeSchema; it exists purely to describe what
 * the browser can currently see on a TradingView page.
 */

export type DetectionSource = "url" | "title" | "dom" | null;

export interface TradingViewSymbol {
  /** Exactly as detected, e.g. "OANDA:XAUUSD" or "XAUUSD" — never altered. */
  raw: string;
  /** `raw` with an "EXCHANGE:" prefix stripped, e.g. "XAUUSD". Equals `raw`
   *  when there was no prefix. A continuous-futures suffix like "ES1!" is
   *  part of the symbol itself, not the exchange, and is preserved as-is
   *  (§4 — these are the canonical values Traditorium wants, unchanged). */
  display: string;
  /** The "EXCHANGE" portion of an "EXCHANGE:SYMBOL" identifier, or null when
   *  `raw` had no such prefix. Never invented — a bare "XAUUSD" with no
   *  colon produces `exchange: null`, not a guessed provider (§4: "Do not
   *  invent exchange/provider information"). */
  exchange: string | null;
}

export interface TradingViewChartContext {
  symbol: TradingViewSymbol | null;
  /** Canonical display form only, e.g. "5m", "1h", "1D", "1W", "1M" — see
   *  shared/timeframe-parser.ts for the exact conversion rules. */
  timeframe: string | null;
  /** True when EITHER symbol or timeframe is known. */
  detected: boolean;
  symbolSource: DetectionSource;
  timeframeSource: DetectionSource;
  updatedAt: number;
}

export const EMPTY_CHART_CONTEXT: TradingViewChartContext = {
  symbol: null,
  timeframe: null,
  detected: false,
  symbolSource: null,
  timeframeSource: null,
  updatedAt: 0,
};

/** Value-equality for the fields that matter to the UI/messaging — used to
 *  suppress redundant CHART_CONTEXT_CHANGED sends (§18: "duplicate context
 *  does not cause unnecessary message spam"). `updatedAt` is deliberately
 *  excluded from the comparison — it always differs. */
export function chartContextsEqual(a: TradingViewChartContext, b: TradingViewChartContext): boolean {
  return (
    a.symbol?.raw === b.symbol?.raw &&
    a.timeframe === b.timeframe &&
    a.detected === b.detected &&
    a.symbolSource === b.symbolSource &&
    a.timeframeSource === b.timeframeSource
  );
}
