/**
 * Traditorium TradingView Extension — Step 5. Symbol parsing only — no
 * normalization/mapping database (§5: "Step 5 should not create a large
 * symbol-mapping database... preserve the TradingView value accurately
 * first"). TradingView's own public "EXCHANGE:SYMBOL" identifier
 * convention (confirmed against real examples: OANDA:XAUUSD, FX:EURUSD,
 * CME_MINI:ES1!, COMEX:GC1!) is a simple, documented, stable format — this
 * only splits on the first colon, it never guesses a provider for a bare
 * symbol.
 */
import type { TradingViewSymbol } from "./chart-context";

export function parseTradingViewSymbol(raw: string): TradingViewSymbol {
  const trimmed = raw.trim();
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex === -1) {
    return { raw: trimmed, display: trimmed, exchange: null };
  }
  const exchange = trimmed.slice(0, colonIndex);
  const display = trimmed.slice(colonIndex + 1);
  // A colon with nothing meaningful on one side isn't a real
  // EXCHANGE:SYMBOL pair — treat the whole string as the display symbol
  // rather than inventing an empty exchange.
  if (!exchange || !display) {
    return { raw: trimmed, display: trimmed, exchange: null };
  }
  return { raw: trimmed, display, exchange };
}
