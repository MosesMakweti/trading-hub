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
  /** The canonical Traditorium symbol — what gets stored once confirmed. */
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
}

// Values are the standard, publicly-documented contract specs for each
// instrument (e.g. CME's published tick sizes/values). A specific broker's
// account may differ in fine print (e.g. a CFD provider's own point value) —
// that's exactly why the confirmed unit/distance freeze onto the plan rather
// than staying a live lookup against this table.
const CATALOG: Record<string, InstrumentSpec> = {
  EURUSD: { canonicalSymbol: "EURUSD", displayName: "Euro / US Dollar", assetClass: "FOREX", quoteCurrency: "USD", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP" },
  GBPUSD: { canonicalSymbol: "GBPUSD", displayName: "British Pound / US Dollar", assetClass: "FOREX", quoteCurrency: "USD", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP" },
  AUDUSD: { canonicalSymbol: "AUDUSD", displayName: "Australian Dollar / US Dollar", assetClass: "FOREX", quoteCurrency: "USD", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP" },
  NZDUSD: { canonicalSymbol: "NZDUSD", displayName: "New Zealand Dollar / US Dollar", assetClass: "FOREX", quoteCurrency: "USD", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP" },
  USDCAD: { canonicalSymbol: "USDCAD", displayName: "US Dollar / Canadian Dollar", assetClass: "FOREX", quoteCurrency: "CAD", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP" },
  USDCHF: { canonicalSymbol: "USDCHF", displayName: "US Dollar / Swiss Franc", assetClass: "FOREX", quoteCurrency: "CHF", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP" },
  USDJPY: { canonicalSymbol: "USDJPY", displayName: "US Dollar / Japanese Yen", assetClass: "FOREX", quoteCurrency: "JPY", decimalPrecision: 3, pipSize: "0.01", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP" },
  EURJPY: { canonicalSymbol: "EURJPY", displayName: "Euro / Japanese Yen", assetClass: "FOREX", quoteCurrency: "JPY", decimalPrecision: 3, pipSize: "0.01", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP" },
  GBPJPY: { canonicalSymbol: "GBPJPY", displayName: "British Pound / Japanese Yen", assetClass: "FOREX", quoteCurrency: "JPY", decimalPrecision: 3, pipSize: "0.01", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP" },
  EURGBP: { canonicalSymbol: "EURGBP", displayName: "Euro / British Pound", assetClass: "FOREX", quoteCurrency: "GBP", decimalPrecision: 5, pipSize: "0.0001", tickSize: null, pointSize: null, tickValue: null, contractSize: "100000", preferredUnit: "PIP" },

  XAUUSD: { canonicalSymbol: "XAUUSD", displayName: "Gold / US Dollar", assetClass: "METALS", quoteCurrency: "USD", decimalPrecision: 2, pipSize: null, tickSize: "0.01", pointSize: "1", tickValue: null, contractSize: "100", preferredUnit: "POINT" },
  XAGUSD: { canonicalSymbol: "XAGUSD", displayName: "Silver / US Dollar", assetClass: "METALS", quoteCurrency: "USD", decimalPrecision: 3, pipSize: null, tickSize: "0.001", pointSize: "1", tickValue: null, contractSize: "5000", preferredUnit: "POINT" },

  NAS100: { canonicalSymbol: "NAS100", displayName: "Nasdaq 100 Index (CFD)", assetClass: "INDEX", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: null, pointSize: "1", tickValue: null, contractSize: null, preferredUnit: "POINT" },
  US30: { canonicalSymbol: "US30", displayName: "Dow Jones 30 Index (CFD)", assetClass: "INDEX", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: null, pointSize: "1", tickValue: null, contractSize: null, preferredUnit: "POINT" },
  US500: { canonicalSymbol: "US500", displayName: "S&P 500 Index (CFD)", assetClass: "INDEX", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: null, pointSize: "1", tickValue: null, contractSize: null, preferredUnit: "POINT" },
  GER40: { canonicalSymbol: "GER40", displayName: "DAX 40 Index (CFD)", assetClass: "INDEX", quoteCurrency: "EUR", decimalPrecision: 1, pipSize: null, tickSize: null, pointSize: "1", tickValue: null, contractSize: null, preferredUnit: "POINT" },
  UK100: { canonicalSymbol: "UK100", displayName: "FTSE 100 Index (CFD)", assetClass: "INDEX", quoteCurrency: "GBP", decimalPrecision: 1, pipSize: null, tickSize: null, pointSize: "1", tickValue: null, contractSize: null, preferredUnit: "POINT" },

  NQ: { canonicalSymbol: "NQ", displayName: "E-mini Nasdaq-100 Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 2, pipSize: null, tickSize: "0.25", pointSize: "1", tickValue: "5", contractSize: null, preferredUnit: "TICK" },
  ES: { canonicalSymbol: "ES", displayName: "E-mini S&P 500 Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 2, pipSize: null, tickSize: "0.25", pointSize: "1", tickValue: "12.5", contractSize: null, preferredUnit: "TICK" },
  YM: { canonicalSymbol: "YM", displayName: "E-mini Dow Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 0, pipSize: null, tickSize: "1", pointSize: "1", tickValue: "5", contractSize: null, preferredUnit: "TICK" },
  RTY: { canonicalSymbol: "RTY", displayName: "E-mini Russell 2000 Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: "0.1", pointSize: "1", tickValue: "5", contractSize: null, preferredUnit: "TICK" },
  GC: { canonicalSymbol: "GC", displayName: "Gold Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: "0.1", pointSize: "1", tickValue: "10", contractSize: null, preferredUnit: "TICK" },
  CL: { canonicalSymbol: "CL", displayName: "Crude Oil Futures", assetClass: "FUTURES", quoteCurrency: "USD", decimalPrecision: 2, pipSize: null, tickSize: "0.01", pointSize: "1", tickValue: "10", contractSize: null, preferredUnit: "TICK" },

  BTCUSD: { canonicalSymbol: "BTCUSD", displayName: "Bitcoin / US Dollar", assetClass: "CRYPTO", quoteCurrency: "USD", decimalPrecision: 1, pipSize: null, tickSize: null, pointSize: "1", tickValue: null, contractSize: null, preferredUnit: "PRICE" },
  ETHUSD: { canonicalSymbol: "ETHUSD", displayName: "Ethereum / US Dollar", assetClass: "CRYPTO", quoteCurrency: "USD", decimalPrecision: 2, pipSize: null, tickSize: null, pointSize: "0.01", tickValue: null, contractSize: null, preferredUnit: "PRICE" },
};

/** Aliases and continuous-contract roots resolve to a catalog key above. */
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
  ES1: "ES",
  YM1: "YM",
  RTY1: "RTY",
  GC1: "GC",
  CL1: "CL",
  MNQ: "NQ", // Micro E-mini — same price/tick convention, different contract size only
  MES: "ES",
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
  const spec = CATALOG[resolvedKey] ?? null;

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
