/**
 * Quantity-ledger execution engine (Phase 1) — execution instrument spec
 * resolution. Pure.
 *
 * Resolution order, field by field (each resolved field records its source):
 *   1. ACCOUNT_OVERRIDE — the account/broker's own contract terms
 *   2. USER_OVERRIDE    — the trader's instrument override
 *   3. CATALOG          — Traditorium's static catalog
 *                         (domain/trade-plan/instrument-catalog.ts) plus the
 *                         quantity conventions below
 *   4. INSUFFICIENT     — an explicit result naming every missing field.
 *
 * Never guesses: the catalog is consulted only by exact canonical symbol /
 * declared alias (`lookupInstrument`) — no broker-suffix stripping, no
 * "looks like FX" heuristics. An index CFD's contract size is broker-defined
 * and absent from the catalog, so NAS100 without an override is INSUFFICIENT.
 */
import { lookupInstrument, type AssetClassLike, type InstrumentSpec } from "@/domain/trade-plan/instrument-catalog";
import { dec, type DecimalInput } from "./precision";
import type { Decimal } from "decimal.js";

/**
 * How one unit of quantity converts a price move into quote-currency value:
 *   CONTRACT_SIZE — FX, metals, CFDs: value per 1.0 price move = contractSize
 *   TICK_VALUE    — futures: value per 1.0 price move = tickValue / tickSize
 */
export type PricingModel = "CONTRACT_SIZE" | "TICK_VALUE";
export type QuantityUnit = "LOT" | "CONTRACT" | "UNIT";
export type SpecSource = "ACCOUNT_OVERRIDE" | "USER_OVERRIDE" | "CATALOG";

/** A partial spec supplied by one layer. Strings/Decimals for every number. */
export interface ExecutionSpecLayer {
  pricingModel?: PricingModel | null;
  quoteCurrency?: string | null;
  contractSize?: DecimalInput | null;
  tickSize?: DecimalInput | null;
  tickValue?: DecimalInput | null;
  quantityUnit?: QuantityUnit | null;
  quantityStep?: DecimalInput | null;
  minQuantity?: DecimalInput | null;
  /** null/absent = no known maximum. */
  maxQuantity?: DecimalInput | null;
  /** Presentation only (pip/point display) — never used for value. */
  pipSize?: DecimalInput | null;
  pointSize?: DecimalInput | null;
}

export type SpecField = keyof ExecutionSpecLayer;

export interface ResolvedExecutionSpec {
  symbol: string;
  pricingModel: PricingModel;
  quoteCurrency: string;
  contractSize: Decimal | null;
  tickSize: Decimal | null;
  tickValue: Decimal | null;
  quantityUnit: QuantityUnit;
  quantityStep: Decimal;
  minQuantity: Decimal;
  maxQuantity: Decimal | null;
  pipSize: Decimal | null;
  pointSize: Decimal | null;
  sources: Partial<Record<SpecField, SpecSource>>;
}

export type SpecResolution =
  | { status: "RESOLVED"; spec: ResolvedExecutionSpec }
  | { status: "INSUFFICIENT"; symbol: string; missing: SpecField[]; invalid: string[]; sources: Partial<Record<SpecField, SpecSource>> };

export interface ResolveSpecInput {
  /** Canonical Traditorium symbol (e.g. a stored canonicalInstrumentSymbol). */
  symbol: string;
  accountOverride?: ExecutionSpecLayer | null;
  userOverride?: ExecutionSpecLayer | null;
}

/**
 * Catalog quantity conventions by asset class. These are the published
 * exchange/industry conventions, not broker terms: futures trade whole
 * contracts; retail FX/metals CFDs trade in 0.01-lot increments. No maximum
 * is assumed (null). Any account/user override supersedes them field by
 * field. Asset classes absent here contribute no quantity convention.
 */
const CATALOG_QUANTITY: Partial<Record<AssetClassLike, Pick<ExecutionSpecLayer, "quantityUnit" | "quantityStep" | "minQuantity">>> = {
  FOREX: { quantityUnit: "LOT", quantityStep: "0.01", minQuantity: "0.01" },
  METALS: { quantityUnit: "LOT", quantityStep: "0.01", minQuantity: "0.01" },
  FUTURES: { quantityUnit: "CONTRACT", quantityStep: "1", minQuantity: "1" },
};

/** How each catalog asset class is priced. The model says WHICH economics
 *  are needed; whether they are present (e.g. an index CFD's broker-defined
 *  contract size) is checked separately and reported as missing. */
const CATALOG_PRICING_MODEL: Partial<Record<AssetClassLike, PricingModel>> = {
  FOREX: "CONTRACT_SIZE",
  METALS: "CONTRACT_SIZE",
  INDEX: "CONTRACT_SIZE",
  CRYPTO: "CONTRACT_SIZE",
  FUTURES: "TICK_VALUE",
};

/** The catalog contribution for a symbol — only what the catalog actually states. */
export function catalogLayer(spec: InstrumentSpec): ExecutionSpecLayer {
  const pricingModel = CATALOG_PRICING_MODEL[spec.assetClass] ?? null;
  const quantity = CATALOG_QUANTITY[spec.assetClass] ?? {};
  return {
    pricingModel,
    quoteCurrency: spec.quoteCurrency,
    contractSize: spec.contractSize,
    tickSize: spec.tickSize,
    tickValue: spec.tickValue,
    pipSize: spec.pipSize,
    pointSize: spec.pointSize,
    ...quantity,
  };
}

const FIELDS: SpecField[] = [
  "pricingModel",
  "quoteCurrency",
  "contractSize",
  "tickSize",
  "tickValue",
  "quantityUnit",
  "quantityStep",
  "minQuantity",
  "maxQuantity",
  "pipSize",
  "pointSize",
];

/** Field-by-field merge in priority order; first non-null wins. */
function mergeLayers(layers: { source: SpecSource; layer: ExecutionSpecLayer | null | undefined }[]) {
  const merged: ExecutionSpecLayer = {};
  const sources: Partial<Record<SpecField, SpecSource>> = {};
  for (const field of FIELDS) {
    for (const { source, layer } of layers) {
      const value = layer?.[field];
      if (value != null) {
        (merged as Record<SpecField, unknown>)[field] = value;
        sources[field] = source;
        break;
      }
    }
  }
  return { merged, sources };
}

/** A pricing model inferred only from which economics a layer stated — never from the symbol. */
function inferPricingModel(m: ExecutionSpecLayer): PricingModel | null {
  const hasContract = m.contractSize != null;
  const hasTick = m.tickSize != null && m.tickValue != null;
  if (hasContract && !hasTick) return "CONTRACT_SIZE";
  if (hasTick && !hasContract) return "TICK_VALUE";
  return null; // neither, or both (ambiguous) → must be stated explicitly
}

function positive(value: DecimalInput | null | undefined): Decimal | null {
  if (value == null) return null;
  try {
    const d = dec(value);
    return d.greaterThan(0) ? d : null;
  } catch {
    return null;
  }
}

export function resolveExecutionSpec(input: ResolveSpecInput): SpecResolution {
  const symbol = input.symbol.trim().toUpperCase();
  const catalog = lookupInstrument(symbol);
  const { merged, sources } = mergeLayers([
    { source: "ACCOUNT_OVERRIDE", layer: input.accountOverride },
    { source: "USER_OVERRIDE", layer: input.userOverride },
    { source: "CATALOG", layer: catalog ? catalogLayer(catalog) : null },
  ]);

  const missing: SpecField[] = [];
  const invalid: string[] = [];
  const pricingModel = merged.pricingModel ?? inferPricingModel(merged);
  if (!pricingModel) missing.push("pricingModel");
  if (!merged.quoteCurrency) missing.push("quoteCurrency");

  const num = (field: SpecField, required: boolean): Decimal | null => {
    const raw = merged[field] as DecimalInput | null | undefined;
    if (raw == null) {
      if (required) missing.push(field);
      return null;
    }
    const d = positive(raw);
    if (!d) invalid.push(`${field} must be a positive number (got ${String(raw)}).`);
    return d;
  };

  const contractSize = num("contractSize", pricingModel === "CONTRACT_SIZE");
  const tickSize = num("tickSize", pricingModel === "TICK_VALUE");
  const tickValue = num("tickValue", pricingModel === "TICK_VALUE");
  const quantityStep = num("quantityStep", true);
  const minQuantity = num("minQuantity", true);
  const maxQuantity = num("maxQuantity", false);
  const pipSize = num("pipSize", false);
  const pointSize = num("pointSize", false);
  if (!merged.quantityUnit) missing.push("quantityUnit");

  if (quantityStep && minQuantity && !minQuantity.mod(quantityStep).isZero()) {
    invalid.push("minQuantity must be a multiple of quantityStep.");
  }
  if (quantityStep && maxQuantity && !maxQuantity.mod(quantityStep).isZero()) {
    invalid.push("maxQuantity must be a multiple of quantityStep.");
  }
  if (minQuantity && maxQuantity && maxQuantity.lessThan(minQuantity)) {
    invalid.push("maxQuantity must be at least minQuantity.");
  }

  if (missing.length > 0 || invalid.length > 0 || !pricingModel || !quantityStep || !minQuantity || !merged.quantityUnit || !merged.quoteCurrency) {
    return { status: "INSUFFICIENT", symbol, missing, invalid, sources };
  }

  return {
    status: "RESOLVED",
    spec: {
      symbol,
      pricingModel,
      quoteCurrency: merged.quoteCurrency.toUpperCase(),
      contractSize,
      tickSize,
      tickValue,
      quantityUnit: merged.quantityUnit,
      quantityStep,
      minQuantity,
      maxQuantity,
      pipSize,
      pointSize,
      sources,
    },
  };
}
