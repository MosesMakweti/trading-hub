/**
 * Instrument metadata for the TradingView Screenshot Trade Plan feature
 * (spec §5/§6) — a code-defined catalog, same convention as
 * domain/psychology/questions.ts and data/prop-firm-directory.ts: fixed
 * reference data that changes by developer edit, not by a CRUD UI. Extending
 * it to a real database table is a reasonable future step if the trader
 * needs custom/broker-specific specs, but every value here is public,
 * well-known contract information (pip/tick/point size), not user data, so a
 * static catalog is the right-sized start.
 *
 * Deliberately does NOT assume a symbol it can't confidently map — an unknown
 * or ambiguous screenshot symbol resolves to `canonical: null` and the caller
 * (recognition confirmation UI) must ask the trader to pick or type the
 * instrument's distance unit/size directly (see PlannedTarget.unitType /
 * unitDistance, which are stored per-plan, not re-derived from this catalog
 * after confirmation — spec §1: "do not assume that similarly named
 * instruments from different brokers have identical contract specifications").
 */
import { Decimal } from "decimal.js";

export type AssetClassLike = "FOREX" | "METALS" | "INDEX" | "FUTURES" | "CRYPTO" | "STOCK" | "OTHER";
export type DistanceUnitLike = "PIP" | "POINT" | "TICK" | "PRICE" | "PERCENT";

export interface InstrumentSpec {
  /** The canonical Traditorium symbol — what gets stored once confirmed. This
   *  is the EXACT traded/market-data identity (Stage 17B.1 §3): a micro
   *  future (MES/MNQ/MGC) is its own `canonicalSymbol`, never collapsed onto
   *  its full-size counterpart — they are separate exchange-listed
   *  instruments with separate order books/contract economics, even though
   *  their price series track the same underlying. */
  canonicalSymbol: string;
  displayName: string;
  assetClass: AssetClassLike;
  quoteCurrency: string | null;
  decimalPrecision: number;
  /** Forex only — null for every other asset class (spec §6: don't force pips onto non-forex instruments). */
  pipSize: string | null;
  tickSize: string | null;
  pointSize: string | null;
  /** Monetary value of one tick move, when publicly standardized (mainly futures). */
  tickValue: string | null;
  contractSize: string | null;
  preferredUnit: DistanceUnitLike;
  /**
   * Stage 17B.1 §8 — GROUPING ONLY, never market-data identity. Instruments
   * that track the same underlying (e.g. MES and ES both track the S&P 500
   * e-mini) share an `instrumentFamily`. Analytics/UI comparison across a
   * family is fine; fetching Replay candles or resolving a Databento
   * contract must always use `canonicalSymbol`, never this field — a family
   * match does NOT mean the instruments are interchangeable (different tick
   * value, contract multiplier, and separate exchange order book). Null for
   * instruments with no sibling contract in the catalog.
   */
  instrumentFamily: string | null;
}

// Values are the standard, publicly-documented contract specs for each
// instrument (e.g. CME's published tick sizes/values). A specific broker's
// account may differ in fine print (e.g. a CFD provider's own point value) —
// that's exactly why the confirmed unit/distance freeze onto the plan rather
// than staying a live lookup against this table.
const CATALOG: Record<string, InstrumentSpec> = {
  EURUSD: { canonicalSymbol: "EURUSD", displayName: "Euro / US Dollar", assetClass: "FOREX", quoteCurrency: "USD", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP", instrumentFamily: null },
  GBPUSD: { canonicalSymbol: "GBPUSD", displayName: "British Pound / US Dollar", assetClass: "FOREX", quoteCurrency: "USD", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP", instrumentFamily: null },
  AUDUSD: { canonicalSymbol: "AUDUSD", displayName: "Australian Dollar / US Dollar", assetClass: "FOREX", quoteCurrency: "USD", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP", instrumentFamily: null },
  NZDUSD: { canonicalSymbol: "NZDUSD", displayName: "New Zealand Dollar / US Dollar", assetClass: "FOREX", quoteCurrency: "USD", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP", instrumentFamily: null },
  USDCAD: { canonicalSymbol: "USDCAD", displayName: "US Dollar / Canadian Dollar", assetClass: "FOREX", quoteCurrency: "CAD", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP", instrumentFamily: null },
  USDCHF: { canonicalSymbol: "USDCHF", displayName: "US Dollar / Swiss Franc", assetClass: "FOREX", quoteCurrency: "CHF", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP", instrumentFamily: null },
  USDJPY: { canonicalSymbol: "USDJPY", displayName: "US Dollar / Japanese Yen", assetClass: "FOREX", quoteCurrency: "JPY", decimalPrecision: 3, pipSize: "0.01", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP", instrumentFamily: null },
  EURJPY: { canonicalSymbol: "EURJPY", displayName: "Euro / Japanese Yen", assetClass: "FOREX", quoteCurrency: "JPY", decimalPrecision: 3, pipSize: "0.01", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP", instrumentFamily: null },
  GBPJPY: { canonicalSymbol: "GBPJPY", displayName: "British Pound / Japanese Yen", assetClass: "FOREX", quoteCurrency: "JPY", decimalPrecision: 3, pipSize: "0.01", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP", instrumentFamily: null },
  EURGBP: { canonicalSymbol: "EURGBP", displayName: "Euro / British Pound", assetClass: "FOREX", quoteCurrency: "GBP", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP", instrumentFamily: null },

  XAUUSD: { canonicalSymbol: "XAUUSD", displayName: "Gold / US Dollar", assetClass: "METALS", quoteCurrency: "USD", decimalPrecision: 2, pipSize: null, tickSize: "0.01", pointSize: "1", tickValue: null, contractSize: "100", preferredUnit: "POINT", instrumentFamily: null },
  XAGUSD: { canonicalSymbol: "XAGUSD", displayName: "Silver / US Dollar", assetClass: "METALS", quoteCurrency: "USD", decimalPrecision: 3, pipSize: null, tickSize: "0.001", pointSize: "1", tickValue: null, contractSize: "5000", preferredUnit: "POINT", instrumentFamily: null },

  NAS100: { canonicalSymbol: "NAS100", displayName: "Nasdaq 100 Index (CFD)", assetClass: "INDEX", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: null, pointSize: "1", tickValue: null, contractSize: null, preferredUnit: "POINT", instrumentFamily: null },
  US30: { canonicalSymbol: "US30", displayName: "Dow Jones 30 Index (CFD)", assetClass: "INDEX", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: null, pointSize: "1", tickValue: null, contractSize: null, preferredUnit: "POINT", instrumentFamily: null },
  US500: { canonicalSymbol: "US500", displayName: "S&P 500 Index (CFD)", assetClass: "INDEX", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: null, pointSize: "1", tickValue: null, contractSize: null, preferredUnit: "POINT", instrumentFamily: null },
  GER40: { canonicalSymbol: "GER40", displayName: "DAX 40 Index (CFD)", assetClass: "INDEX", quoteCurrency: "EUR", decimalPrecision: 1, pipSize: null, tickSize: null, pointSize: "1", tickValue: null, contractSize: null, preferredUnit: "POINT", instrumentFamily: null },
  UK100: { canonicalSymbol: "UK100", displayName: "FTSE 100 Index (CFD)", assetClass: "INDEX", quoteCurrency: "GBP", decimalPrecision: 1, pipSize: null, tickSize: null, pointSize: "1", tickValue: null, contractSize: null, preferredUnit: "POINT", instrumentFamily: null },

  // ── Futures (Stage 17B.1 §1-3/§5/§8) ───────────────────────────────────
  // Each root AND its micro contract are separate `canonicalSymbol`s with
  // their own publicly-documented CME contract specs — never collapsed into
  // one another. `instrumentFamily` links siblings for grouping/analytics
  // ONLY (§8) — it must never be used to resolve market data (see
  // `databento-provider.ts`'s FUTURES_ROOT_BY_CANONICAL, which is keyed by
  // `canonicalSymbol`, not `instrumentFamily`).
  NQ: { canonicalSymbol: "NQ", displayName: "E-mini Nasdaq-100 Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 2, pipSize: null, tickSize: "0.25", pointSize: "1", tickValue: "5", contractSize: null, preferredUnit: "TICK", instrumentFamily: "NQ" },
  MNQ: { canonicalSymbol: "MNQ", displayName: "Micro E-mini Nasdaq-100 Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 2, pipSize: null, tickSize: "0.25", pointSize: "1", tickValue: "0.5", contractSize: null, preferredUnit: "TICK", instrumentFamily: "NQ" },
  ES: { canonicalSymbol: "ES", displayName: "E-mini S&P 500 Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 2, pipSize: null, tickSize: "0.25", pointSize: "1", tickValue: "12.5", contractSize: null, preferredUnit: "TICK", instrumentFamily: "ES" },
  MES: { canonicalSymbol: "MES", displayName: "Micro E-mini S&P 500 Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 2, pipSize: null, tickSize: "0.25", pointSize: "1", tickValue: "1.25", contractSize: null, preferredUnit: "TICK", instrumentFamily: "ES" },
  YM: { canonicalSymbol: "YM", displayName: "E-mini Dow Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 0, pipSize: null, tickSize: "1", pointSize: "1", tickValue: "5", contractSize: null, preferredUnit: "TICK", instrumentFamily: "YM" },
  RTY: { canonicalSymbol: "RTY", displayName: "E-mini Russell 2000 Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: "0.1", pointSize: "1", tickValue: "5", contractSize: null, preferredUnit: "TICK", instrumentFamily: "RTY" },
  GC: { canonicalSymbol: "GC", displayName: "Gold Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: "0.1", pointSize: "1", tickValue: "10", contractSize: null, preferredUnit: "TICK", instrumentFamily: "GC" },
  MGC: { canonicalSymbol: "MGC", displayName: "Micro Gold Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: "0.1", pointSize: "1", tickValue: "1", contractSize: null, preferredUnit: "TICK", instrumentFamily: "GC" },
  CL: { canonicalSymbol: "CL", displayName: "Crude Oil Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 2, pipSize: null, tickSize: "0.01", pointSize: "1", tickValue: "10", contractSize: null, preferredUnit: "TICK", instrumentFamily: "CL" },

  BTCUSD: { canonicalSymbol: "BTCUSD", displayName: "Bitcoin / US Dollar", assetClass: "CRYPTO", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: null, pointSize: "1", tickValue: null, contractSize: null, preferredUnit: "PRICE", instrumentFamily: null },
  ETHUSD: { canonicalSymbol: "ETHUSD", displayName: "Ethereum / US Dollar", assetClass: "CRYPTO", quoteCurrency: "USD", decimalPrecision: 2, pipSize: null, tickSize: null, pointSize: "0.01", tickValue: null, contractSize: null, preferredUnit: "PRICE", instrumentFamily: null },
};

/**
 * Aliases and continuous-contract roots resolve to a catalog key above.
 * Stage 17B.1 §1/§2: MES/MNQ/MGC are NOT aliased to ES/NQ/GC here — they are
 * distinct `canonicalSymbol`s in CATALOG above with their own contract
 * specs. Only their OWN TradingView continuous-contract suffix
 * ("MES1!" -> MES) is aliased, exactly like every other root's "N1!" form.
 */
const ALIASES: Record<string, string> = {
  GOLD: "XAUUSD",
  SILVER: "XAGUSD",
  US100: "NAS100",
  USTEC: "NAS100",
  NASDAQ: "NAS100",
  DJI: "US30",
  DOW: "US30",
  US30USD: "US30",
  SPX: "US500",
  SPX500: "US500",
  SP500: "US500",
  US500USD: "US500",
  DAX: "GER40",
  DE40: "GER40",
  FTSE: "UK100",
  NQ1: "NQ",
  MNQ1: "MNQ",
  ES1: "ES",
  MES1: "MES",
  YM1: "YM",
  RTY1: "RTY",
  GC1: "GC",
  MGC1: "MGC",
  CL1: "CL",
  BTC: "BTCUSD",
  XBTUSD: "BTCUSD",
  ETH: "ETHUSD",
};

export interface SymbolParseResult {
  /** The exact string detected/typed, unmodified — always preserved even when unmapped. */
  originalSymbol: string;
  /** Broker/exchange prefix before the ':', when present (e.g. "OANDA", "CAPITALCOM", "CME_MINI"). */
  dataSource: string | null;
  /** The cleaned, uppercased root symbol after stripping prefix/suffixes — used to look up the catalog. */
  cleanedSymbol: string;
  spec: InstrumentSpec | null;
}

/** Strips a TradingView continuous-futures suffix ("1!", "2!", …) or a
 *  perpetual-swap suffix (".P") from the root symbol. */
function stripTradingViewSuffix(symbol: string): string {
  return symbol.replace(/\d*!$/, "").replace(/\.P$/i, "");
}

/**
 * Stage 17C.2 §9/§10 — deterministic broker suffix/prefix normalization for
 * OTC symbols. Many forex/CFD brokers append a cosmetic account-type or
 * pricing-tier marker to the raw symbol they display (e.g. Alpari-style
 * "XAUUSD.a", "EURUSD.raw", or Exness-style "XAUUSDm", "EURUSDm" for a
 * micro-lot account) — these markers carry NO instrument-identity meaning:
 * "XAUUSD.a" and "XAUUSD" are the exact same instrument, just a different
 * broker's cosmetic account-tier label. This is unlike a micro FUTURES
 * contract (MES vs ES), which IS a genuinely different exchange-listed
 * instrument (Stage 17B.1 §1) — never conflate the two kinds of "suffix."
 *
 * Deliberately NOT a fuzzy matcher: each pattern below is only consulted as
 * a FALLBACK after a direct catalog/alias lookup has already failed, and is
 * only accepted when stripping it reveals an EXACT, already-known catalog
 * key. It can never invent a mapping to an instrument that wasn't already
 * in the catalog, and it can never override an already-successful direct
 * match — so it cannot incorrectly map one real, distinct instrument onto
 * another.
 */
const BROKER_SUFFIX_PATTERNS: RegExp[] = [
  /\.(a|b|c|raw|pro|ecn|micro|std|classic|m)$/i, // dot-delimited account-tier suffix: "XAUUSD.a", "EURUSD.raw"
  /m$/i, // bare trailing micro-account marker: "XAUUSDm", "EURUSDm" (Exness-style)
];

/** Returns a catalog spec found by stripping a recognized broker suffix
 *  from `cleaned`, or null if no pattern applies or the stripped form
 *  isn't already a known symbol. */
function resolveBrokerSuffixedSymbol(cleaned: string): InstrumentSpec | null {
  for (const pattern of BROKER_SUFFIX_PATTERNS) {
    if (!pattern.test(cleaned)) continue;
    const stripped = cleaned.replace(pattern, "");
    if (stripped.length < 3) continue; // too short to be a real root — avoid over-eager stripping
    const spec = CATALOG[ALIASES[stripped] ?? stripped];
    if (spec) return spec;
  }
  return null;
}

/**
 * Parses a TradingView-style symbol (spec §5 examples: "OANDA:EURUSD",
 * "FX:EURUSD", "EURUSD.P", "CAPITALCOM:GOLD", "XAUUSD", "NAS100", "US100",
 * "NQ1!", "CME_MINI:NQ1!") into a data source + cleaned root, then resolves
 * that root against the catalog (through the alias table first). Never
 * throws — an unrecognized symbol returns `spec: null` so the caller can
 * prompt the trader instead of guessing.
 */
export function parseSymbol(rawSymbol: string): SymbolParseResult {
  const trimmed = rawSymbol.trim();
  const colonIndex = trimmed.indexOf(":");
  const dataSource = colonIndex > 0 ? trimmed.slice(0, colonIndex).toUpperCase() : null;
  const rest = colonIndex > 0 ? trimmed.slice(colonIndex + 1) : trimmed;
  const cleaned = stripTradingViewSuffix(rest).toUpperCase();

  const resolvedKey = ALIASES[cleaned] ?? cleaned;
  const spec = CATALOG[resolvedKey] ?? resolveBrokerSuffixedSymbol(cleaned);

  return { originalSymbol: rawSymbol, dataSource, cleanedSymbol: cleaned, spec };
}

/** Direct catalog lookup by an already-canonical symbol (e.g. re-resolving a stored `canonicalInstrumentSymbol`). */
export function lookupInstrument(canonicalSymbol: string): InstrumentSpec | null {
  const key = canonicalSymbol.trim().toUpperCase();
  return CATALOG[ALIASES[key] ?? key] ?? null;
}

export function listKnownInstruments(): InstrumentSpec[] {
  return Object.values(CATALOG);
}

/** Decimal helper — null-safe conversion of a catalog's string size fields. */
export function specDecimal(value: string | null): Decimal | null {
  return value == null ? null : new Decimal(value);
}

/** Entry/stop/target values are instrument PRICES, never dollar amounts —
 *  formatCurrency (a 2-decimal $ formatter meant for account balances/PnL)
 *  would silently round an FX price like 1.08500 to "$1.09" and prepend a
 *  meaningless $ sign. Respects the resolved instrument's own quote
 *  precision when known, falling back to a magnitude-based guess otherwise. */
export function formatTargetPrice(value: number, precision: number | null): string {
  const digits = precision ?? (Math.abs(value) >= 100 ? 2 : 5);
  return value.toFixed(digits);
}
