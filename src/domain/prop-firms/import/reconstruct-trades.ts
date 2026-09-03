import { Decimal } from "decimal.js";

import type { ImportSide } from "./types";

export interface ExecutionForReconstruction {
  /** Any stable identifier the caller controls — a DB row id once
   *  executions are persisted, or a synthetic key ("<rowIndex>:close" /
   *  "<rowIndex>:open") before a reversal split. Opaque to this module. */
  id: string;
  instrumentNormalized: string;
  direction: ImportSide;
  quantity: Decimal;
  price: Decimal;
  grossPnl: Decimal;
  commission: Decimal;
  swap: Decimal;
  otherFees: Decimal;
  executedAt: Date;
  /** Preserved through splitting so both halves of a reversal still trace
   *  back to the one raw fill. */
  sourceExecutionId: string;
}

export interface ReconstructedTradeGroup {
  instrument: string;
  direction: ImportSide;
  status: "OPEN" | "PARTIAL" | "CLOSED";
  openedAt: Date;
  closedAt: Date | null;
  entryCount: number;
  exitCount: number;
  totalQuantity: Decimal;
  avgEntryPrice: Decimal;
  avgExitPrice: Decimal | null;
  grossPnl: Decimal;
  commission: Decimal;
  swap: Decimal;
  otherFees: Decimal;
  netPnl: Decimal;
  executionIds: string[];
}

const ZERO = new Decimal(0);

/**
 * Splits any fill whose quantity exceeds the currently open position (a
 * reversal — e.g. long 1 lot, then a single sell-3 fill) into a closing
 * piece (sized to exactly flatten the open position) and an opening piece
 * (the excess, starting a new position in the opposite direction).
 *
 * Financial allocation: the entire reported grossPnl belongs to the closing
 * piece (a position can't realize P&L in the same instant it opens);
 * commission/swap/fees are prorated by quantity between the two pieces
 * (brokers charge these per unit traded on both legs of a single fill).
 * Must run per-instrument, chronologically, before `reconstructTrades`.
 */
export function splitReversalFills(executions: ExecutionForReconstruction[]): ExecutionForReconstruction[] {
  const byInstrument = new Map<string, ExecutionForReconstruction[]>();
  for (const e of executions) {
    const list = byInstrument.get(e.instrumentNormalized) ?? [];
    list.push(e);
    byInstrument.set(e.instrumentNormalized, list);
  }

  const result: ExecutionForReconstruction[] = [];
  for (const list of byInstrument.values()) {
    const sorted = [...list].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());

    let openQty = ZERO;
    let openSide: ImportSide | null = null;

    for (const e of sorted) {
      const isEntry = openSide === null || e.direction === openSide;
      if (isEntry) {
        openQty = openQty.plus(e.quantity);
        openSide = e.direction;
        result.push(e);
        continue;
      }

      // Opposite direction: an exit, possibly a reversal if it overshoots.
      if (e.quantity.lessThanOrEqualTo(openQty)) {
        openQty = openQty.minus(e.quantity);
        result.push(e);
        if (openQty.isZero()) openSide = null;
        continue;
      }

      const closingQty = openQty;
      const openingQty = e.quantity.minus(openQty);
      const ratioClose = closingQty.dividedBy(e.quantity);
      const ratioOpen = openingQty.dividedBy(e.quantity);

      result.push({
        ...e,
        id: `${e.id}:close`,
        quantity: closingQty,
        grossPnl: e.grossPnl,
        commission: e.commission.times(ratioClose),
        swap: e.swap.times(ratioClose),
        otherFees: e.otherFees.times(ratioClose),
        sourceExecutionId: e.sourceExecutionId,
      });
      result.push({
        ...e,
        id: `${e.id}:open`,
        quantity: openingQty,
        grossPnl: ZERO,
        commission: e.commission.times(ratioOpen),
        swap: e.swap.times(ratioOpen),
        otherFees: e.otherFees.times(ratioOpen),
        sourceExecutionId: e.sourceExecutionId,
      });

      openQty = openingQty;
      openSide = e.direction;
    }
  }

  return result;
}

/**
 * Groups a (pre-split, so no fill ever overshoots the open position)
 * execution list into logical round-trip trades: per instrument,
 * chronological FIFO accumulation — same-direction fills add to the open
 * trade, opposite-direction fills reduce it, and the trade closes exactly
 * when the running position returns to zero. P&L is never recomputed here;
 * it's the sum of whatever the platform already reported per fill.
 */
export function reconstructTrades(executions: ExecutionForReconstruction[]): ReconstructedTradeGroup[] {
  const byInstrument = new Map<string, ExecutionForReconstruction[]>();
  for (const e of executions) {
    const list = byInstrument.get(e.instrumentNormalized) ?? [];
    list.push(e);
    byInstrument.set(e.instrumentNormalized, list);
  }

  const groups: ReconstructedTradeGroup[] = [];

  for (const [instrument, list] of byInstrument) {
    const sorted = [...list].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());

    let current: ReconstructedTradeGroup | null = null;
    let openQty = ZERO;
    let entryQtySum = ZERO;
    let entryPriceWeighted = ZERO;
    let exitQtySum = ZERO;
    let exitPriceWeighted = ZERO;

    const flush = () => {
      if (!current) return;
      current.avgEntryPrice = entryQtySum.isZero() ? ZERO : entryPriceWeighted.dividedBy(entryQtySum);
      current.avgExitPrice = exitQtySum.isZero() ? null : exitPriceWeighted.dividedBy(exitQtySum);
      current.totalQuantity = entryQtySum;
      groups.push(current);
      current = null;
      entryQtySum = ZERO;
      entryPriceWeighted = ZERO;
      exitQtySum = ZERO;
      exitPriceWeighted = ZERO;
    };

    for (const e of sorted) {
      const isEntry = current === null || e.direction === current.direction;

      if (isEntry) {
        if (current === null) {
          current = {
            instrument,
            direction: e.direction,
            status: "OPEN",
            openedAt: e.executedAt,
            closedAt: null,
            entryCount: 0,
            exitCount: 0,
            totalQuantity: ZERO,
            avgEntryPrice: ZERO,
            avgExitPrice: null,
            grossPnl: ZERO,
            commission: ZERO,
            swap: ZERO,
            otherFees: ZERO,
            netPnl: ZERO,
            executionIds: [],
          };
        }
        current.entryCount += 1;
        entryQtySum = entryQtySum.plus(e.quantity);
        entryPriceWeighted = entryPriceWeighted.plus(e.price.times(e.quantity));
        openQty = openQty.plus(e.quantity);
      } else {
        // Guaranteed by splitReversalFills to never overshoot `current`.
        current!.exitCount += 1;
        exitQtySum = exitQtySum.plus(e.quantity);
        exitPriceWeighted = exitPriceWeighted.plus(e.price.times(e.quantity));
        openQty = openQty.minus(e.quantity);
        current!.status = openQty.isZero() ? "CLOSED" : "PARTIAL";
        if (openQty.isZero()) current!.closedAt = e.executedAt;
      }

      current!.grossPnl = current!.grossPnl.plus(e.grossPnl);
      current!.commission = current!.commission.plus(e.commission);
      current!.swap = current!.swap.plus(e.swap);
      current!.otherFees = current!.otherFees.plus(e.otherFees);
      current!.netPnl = current!.grossPnl.plus(current!.commission).plus(current!.swap).plus(current!.otherFees);
      current!.executionIds.push(e.id);

      if (openQty.isZero()) flush();
    }

    flush();
  }

  return groups;
}
