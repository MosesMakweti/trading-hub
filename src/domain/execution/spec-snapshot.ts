/**
 * Quantity ledger (Phase 2) — the frozen instrument economics of one trade.
 * Pure.
 *
 * The exact ResolvedExecutionSpec used for sizing is serialized (decimal
 * strings, never floats) into PerformanceRiskSnapshot.specSnapshot at first
 * entry. Every later ledger calculation reads ONLY this snapshot, so a later
 * catalog edit, UserInstrumentSpec edit or broker change can never rewrite a
 * historical result.
 */
import type { Decimal } from "decimal.js";
import type { PricingModel, QuantityUnit, ResolvedExecutionSpec, SpecField, SpecSource } from "./instrument-spec";
import { dec } from "./precision";

/** Bump when the sizing/settlement math changes meaning; stored per snapshot. */
export const SIZING_VERSION = 1;

export interface SpecSnapshotJson {
  version: 1;
  symbol: string;
  pricingModel: PricingModel;
  quoteCurrency: string;
  contractSize: string | null;
  tickSize: string | null;
  tickValue: string | null;
  quantityUnit: QuantityUnit;
  quantityStep: string;
  minQuantity: string;
  maxQuantity: string | null;
  pipSize: string | null;
  pointSize: string | null;
  sources: Partial<Record<SpecField, SpecSource>>;
}

const s = (d: Decimal | null) => (d == null ? null : d.toString());
const d = (v: string | null) => (v == null ? null : dec(v));

export function toSpecSnapshot(spec: ResolvedExecutionSpec): SpecSnapshotJson {
  return {
    version: 1,
    symbol: spec.symbol,
    pricingModel: spec.pricingModel,
    quoteCurrency: spec.quoteCurrency,
    contractSize: s(spec.contractSize),
    tickSize: s(spec.tickSize),
    tickValue: s(spec.tickValue),
    quantityUnit: spec.quantityUnit,
    quantityStep: spec.quantityStep.toString(),
    minQuantity: spec.minQuantity.toString(),
    maxQuantity: s(spec.maxQuantity),
    pipSize: s(spec.pipSize),
    pointSize: s(spec.pointSize),
    sources: { ...spec.sources },
  };
}

export function fromSpecSnapshot(json: unknown): ResolvedExecutionSpec {
  const j = json as SpecSnapshotJson;
  if (!j || j.version !== 1 || !j.quantityStep || !j.minQuantity || !j.pricingModel || !j.quoteCurrency) {
    throw new Error("LEDGER_CORRUPT: unreadable instrument spec snapshot.");
  }
  return {
    symbol: j.symbol,
    pricingModel: j.pricingModel,
    quoteCurrency: j.quoteCurrency,
    contractSize: d(j.contractSize),
    tickSize: d(j.tickSize),
    tickValue: d(j.tickValue),
    quantityUnit: j.quantityUnit,
    quantityStep: dec(j.quantityStep),
    minQuantity: dec(j.minQuantity),
    maxQuantity: d(j.maxQuantity),
    pipSize: d(j.pipSize),
    pointSize: d(j.pointSize),
    sources: j.sources ?? {},
  };
}
