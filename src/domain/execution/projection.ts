/**
 * Quantity ledger (Phase 2) — the ONE derived, in-memory projection of a
 * ledger into the shape legacy readers already consume (percent-of-original
 * partial exits). Pure. Never persisted: PositionFill stays the canonical
 * history and TradeActualPartialExit is never written for a ledger trade.
 *
 * Only effective closes are projected (a reversed CLOSE and its REVERSAL
 * cancel), each as `executed / initial × 100`, so readers see the same
 * open/partially-closed/fully-closed state the ledger does. While open, the
 * ledger's own realized R (PnL / intended risk) is carried alongside so a
 * reader never re-derives a price-weighted R that would disagree with it.
 */
import type { LedgerState } from "./ledger";
import { dec } from "./precision";

export interface ProjectedPartialExit {
  exitPrice: string;
  /** Percent of the ORIGINAL (frozen executable) quantity. */
  percentClosed: string;
  exitedAt: Date;
}

export interface LedgerReaderProjection {
  partials: ProjectedPartialExit[];
  /** Ledger realized R so far (open or closed), as a decimal string. */
  realizedRSoFar: string;
  closedPercent: string;
  fullyClosed: boolean;
  weightedAverageExit: string | null;
}

export function projectLedgerForReaders(state: LedgerState): LedgerReaderProjection {
  const closes = state.effectiveCloses;
  const percents = closes.map((f) => f.executedQuantity.dividedBy(state.initialQuantity).times(100));
  // A fully closed ledger projects to exactly 100%: the last close absorbs
  // any non-terminating division remainder (e.g. 0.41 / 0.83).
  if (state.fullyClosed && percents.length > 0) {
    percents[percents.length - 1] = percents.slice(0, -1).reduce((rest, p) => rest.minus(p), dec(100));
  }
  return {
    partials: closes.map((f, i) => ({ exitPrice: f.price.toString(), percentClosed: percents[i].toString(), exitedAt: f.executedAt })),
    realizedRSoFar: state.realizedR.toString(),
    closedPercent: state.fullyClosed ? "100" : state.closedQuantity.dividedBy(state.initialQuantity).times(100).toString(),
    fullyClosed: state.fullyClosed,
    weightedAverageExit: state.weightedAverageExit?.toString() ?? null,
  };
}
