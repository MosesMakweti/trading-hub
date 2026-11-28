import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";

import type { Mt5DealCategory, Mt5DealEntry, Mt5Side, StopFieldState } from "./deal-classification";

/**
 * MT5 Connector — position reconstruction.
 *
 * Positions are grouped ONLY by DEAL_POSITION_ID — never by symbol or
 * direction — so hedging accounts (several simultaneous positions on one
 * symbol, in either direction) and netting accounts both reconstruct
 * correctly. This is deliberately NOT the Prop Firm statement importer's
 * `reconstruct-trades.ts`, which nets per instrument and is wrong for
 * hedging accounts.
 *
 * Pure and deterministic: the result depends only on the set of deals/orders
 * passed in (sorted here by time, then ticket), never on arrival order — so
 * incremental re-derivation of just the positions touched by a batch gives
 * the same answer as rebuilding everything. `MT5_POSITION_DERIVATION_VERSION`
 * and `sourceHash` record exactly what a stored result was computed from.
 *
 * Within one position id:
 *   IN      opens a segment or scales into it (VWAP entry)
 *   OUT     reduces / closes it (partial closes accumulate)
 *   OUT_BY  closes it against an opposite position (close-by); each of the
 *           two positions receives its own OUT_BY deal
 *   INOUT   netting reversal: closes the open volume and opens the excess in
 *           the opposite direction under the SAME position id
 *
 * Money: profit + commission + swap + fee of every TRADE deal of the position
 * (MT5 signs — costs are negative). Nothing is prorated between segments
 * except the reversal deal's profit, which belongs to the closing segment
 * (MT5 books it there).
 *
 * Unknowns stay unknown: missing opening deals (history trimmed by the
 * broker) leave entry prices null and raise INCOMPLETE_HISTORY; the initial
 * stop is taken only from the opening deal/order (MT5 keeps no record of
 * later SL modifications) — otherwise UNAVAILABLE. No R is computed.
 */

export const MT5_POSITION_DERIVATION_VERSION = 1;

/** Decimal scale of stored prices/volumes (Decimal(24,10)). */
const PRICE_SCALE = 10;

export interface DerivationDeal {
  ticket: string;
  orderTicket: string | null;
  timeMsc: bigint;
  category: Mt5DealCategory;
  side: Mt5Side | null;
  entry: Mt5DealEntry | null;
  symbol: string | null;
  volume: string | null;
  price: string | null;
  profit: string;
  commission: string;
  swap: string;
  fee: string;
  stopLoss: string | null;
  stopLossState: StopFieldState;
  takeProfit: string | null;
  payloadHash: string;
}

export interface DerivationOrder {
  ticket: string;
  stopLoss: string | null;
  stopLossState: StopFieldState;
  takeProfit: string | null;
  payloadHash: string;
}

export type Direction = "LONG" | "SHORT";

export type PositionFlag =
  | "INCOMPLETE_HISTORY" // the opening deal(s) are not in the available history
  | "REVERSED" // a netting INOUT reversal occurred
  | "CLOSED_BY" // closed (fully/partly) by an OUT_BY close-by operation
  | "PARTIALLY_CLOSED" // more than one exit
  | "SCALED_IN" // more than one entry into a segment
  | "VOLUME_EXCEEDS_OPEN" // an exit larger than the open volume (data inconsistency)
  | "DIRECTION_CONFLICT" // an entry/exit whose side contradicts the open segment; excluded from volume math
  | "CANCELED_DEAL_PRESENT"; // a DEAL_TYPE_*_CANCELED deal references this position; excluded

export interface PositionSegment {
  direction: Direction;
  openedMsc: string | null;
  closedMsc: string | null;
  volumeIn: string;
  volumeOut: string;
  avgEntryPrice: string | null;
  avgExitPrice: string | null;
  profit: string;
  /** True when the segment's opening deals are missing from history. */
  openingMissing: boolean;
}

export type InitialStopSource = "OPENING_DEAL" | "OPENING_ORDER" | "NONE_AT_OPEN" | "UNAVAILABLE";

export interface DerivedPosition {
  positionId: string;
  symbol: string;
  direction: Direction;
  status: "OPEN" | "CLOSED";
  openedMsc: bigint | null;
  closedMsc: bigint | null;
  volumeIn: string;
  volumeOut: string;
  openVolume: string;
  avgEntryPrice: string | null;
  avgExitPrice: string | null;
  profit: string;
  commission: string;
  swap: string;
  fee: string;
  netProfit: string;
  dealCount: number;
  entryCount: number;
  exitCount: number;
  reversalCount: number;
  initialStopLoss: string | null;
  initialTakeProfit: string | null;
  initialStopSource: InitialStopSource;
  segments: PositionSegment[];
  flags: PositionFlag[];
  derivationVersion: number;
  sourceHash: string;
}

const ZERO = new Decimal(0);
const sideDirection = (side: Mt5Side): Direction => (side === "BUY" ? "LONG" : "SHORT");
const opposite = (d: Direction): Direction => (d === "LONG" ? "SHORT" : "LONG");

function ticketCompare(a: string, b: string): number {
  const digits = /^\d+$/;
  if (digits.test(a) && digits.test(b)) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical processing order: time, then ticket (numeric). */
export function compareDeals(a: { timeMsc: bigint; ticket: string }, b: { timeMsc: bigint; ticket: string }): number {
  if (a.timeMsc !== b.timeMsc) return a.timeMsc < b.timeMsc ? -1 : 1;
  return ticketCompare(a.ticket, b.ticket);
}

interface WorkingSegment {
  direction: Direction;
  openedMsc: bigint | null;
  closedMsc: bigint | null;
  volumeIn: Decimal;
  volumeOut: Decimal;
  entryNotional: Decimal;
  exitNotional: Decimal;
  profit: Decimal;
  openingMissing: boolean;
  entries: number;
}

function newSegment(direction: Direction, openedMsc: bigint | null, openingMissing = false): WorkingSegment {
  return {
    direction,
    openedMsc,
    closedMsc: null,
    volumeIn: ZERO,
    volumeOut: ZERO,
    entryNotional: ZERO,
    exitNotional: ZERO,
    profit: ZERO,
    openingMissing,
    entries: 0,
  };
}

const priceStr = (d: Decimal) => d.toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_HALF_EVEN).toFixed();
const vwap = (notional: Decimal, volume: Decimal) => (volume.isZero() ? null : priceStr(notional.div(volume)));

function sourceHashOf(positionId: string, deals: DerivationDeal[], orders: DerivationOrder[]): string {
  const h = createHash("sha256");
  h.update(`v${MT5_POSITION_DERIVATION_VERSION}|${positionId}|`);
  for (const d of deals) h.update(`d:${d.ticket}:${d.payloadHash};`);
  for (const o of [...orders].sort((a, b) => ticketCompare(a.ticket, b.ticket))) h.update(`o:${o.ticket}:${o.payloadHash};`);
  return h.digest("hex");
}

/**
 * Reconstructs one position from all of its deals. `orders` should include
 * at least the opening order (looked up by the opening deal's order ticket)
 * when it is known. Returns null when the position id has no TRADE deals
 * (nothing to reconstruct).
 */
export function derivePosition(positionId: string, allDeals: DerivationDeal[], orders: DerivationOrder[] = []): DerivedPosition | null {
  const deals = [...allDeals].sort(compareDeals);
  const trade = deals.filter((d) => d.category === "TRADE" && d.side != null);
  if (trade.length === 0) return null;

  const flags = new Set<PositionFlag>();
  if (deals.some((d) => d.category === "TRADE_CANCELED")) flags.add("CANCELED_DEAL_PRESENT");

  const segments: WorkingSegment[] = [];
  let cur: WorkingSegment | null = null;
  let openVol = ZERO;
  let entryCount = 0;
  let exitCount = 0;
  let reversalCount = 0;
  let profit = ZERO;
  let commission = ZERO;
  let swap = ZERO;
  let fee = ZERO;

  const closeCurrent = (at: bigint) => {
    if (!cur) return;
    cur.closedMsc = at;
    segments.push(cur);
    cur = null;
  };

  for (const d of trade) {
    profit = profit.plus(d.profit);
    commission = commission.plus(d.commission);
    swap = swap.plus(d.swap);
    fee = fee.plus(d.fee);

    const dir = sideDirection(d.side!);
    const vol = new Decimal(d.volume ?? 0);
    const price = new Decimal(d.price ?? 0);

    switch (d.entry) {
      case "IN": {
        if (cur && (cur as WorkingSegment).direction !== dir) {
          flags.add("DIRECTION_CONFLICT");
          break;
        }
        if (!cur) cur = newSegment(dir, d.timeMsc);
        const seg = cur as WorkingSegment;
        seg.volumeIn = seg.volumeIn.plus(vol);
        seg.entryNotional = seg.entryNotional.plus(vol.mul(price));
        seg.entries += 1;
        if (seg.entries > 1) flags.add("SCALED_IN");
        openVol = openVol.plus(vol);
        entryCount += 1;
        break;
      }
      case "OUT":
      case "OUT_BY": {
        if (d.entry === "OUT_BY") flags.add("CLOSED_BY");
        if (!cur) {
          // Exit with no known opening: the history does not contain it.
          flags.add("INCOMPLETE_HISTORY");
          cur = newSegment(opposite(dir), null, true);
        }
        const seg = cur as WorkingSegment;
        if (seg.direction === dir) {
          flags.add("DIRECTION_CONFLICT");
          break;
        }
        seg.volumeOut = seg.volumeOut.plus(vol);
        seg.exitNotional = seg.exitNotional.plus(vol.mul(price));
        seg.profit = seg.profit.plus(d.profit);
        exitCount += 1;
        if (seg.openingMissing) {
          // Open quantity unknown: the segment ends at its latest exit.
          seg.closedMsc = d.timeMsc;
          openVol = Decimal.max(ZERO, openVol.minus(vol));
          break;
        }
        if (vol.greaterThan(openVol)) flags.add("VOLUME_EXCEEDS_OPEN");
        openVol = Decimal.max(ZERO, openVol.minus(vol));
        if (openVol.isZero()) closeCurrent(d.timeMsc);
        break;
      }
      case "INOUT": {
        flags.add("REVERSED");
        reversalCount += 1;
        entryCount += 1;
        exitCount += 1;
        if (!cur) {
          // Reversal with no known open side: the closed part's volume is
          // unknown, so only the fact of the new segment is recorded.
          flags.add("INCOMPLETE_HISTORY");
          const missing = newSegment(opposite(dir), null, true);
          missing.closedMsc = d.timeMsc;
          missing.profit = new Decimal(d.profit);
          segments.push(missing);
          cur = newSegment(dir, d.timeMsc, true);
          break;
        }
        const seg = cur as WorkingSegment;
        if (seg.direction === dir) {
          flags.add("DIRECTION_CONFLICT");
          break;
        }
        if (seg.openingMissing) {
          // Can't split the reversal volume without the open quantity.
          seg.closedMsc = d.timeMsc;
          seg.profit = seg.profit.plus(d.profit);
          segments.push(seg);
          cur = newSegment(dir, d.timeMsc, true);
          break;
        }
        let closeVol = openVol;
        let openPart = vol.minus(openVol);
        if (!openPart.greaterThan(ZERO)) {
          flags.add("VOLUME_EXCEEDS_OPEN");
          closeVol = vol;
          openPart = ZERO;
        }
        seg.volumeOut = seg.volumeOut.plus(closeVol);
        seg.exitNotional = seg.exitNotional.plus(closeVol.mul(price));
        seg.profit = seg.profit.plus(d.profit);
        closeCurrent(d.timeMsc);
        openVol = ZERO;
        if (openPart.greaterThan(ZERO)) {
          const next = newSegment(dir, d.timeMsc);
          next.volumeIn = openPart;
          next.entryNotional = openPart.mul(price);
          next.entries = 1;
          cur = next;
          openVol = openPart;
        }
        break;
      }
      default:
        // normalizeDeal rejects trade deals without an entry; nothing to do.
        break;
    }
  }

  if (cur) segments.push(cur as WorkingSegment);

  if (exitCount > 1) flags.add("PARTIALLY_CLOSED");

  const anyMissing = segments.some((s) => s.openingMissing);
  const volumeIn = segments.reduce((sum, s) => sum.plus(s.volumeIn), ZERO);
  const volumeOut = segments.reduce((sum, s) => sum.plus(s.volumeOut), ZERO);
  const lastSegment = segments[segments.length - 1];
  // A segment whose opening is missing has an unknown open quantity; it is
  // treated as closed at its last exit (never as an invented open remainder).
  const status: "OPEN" | "CLOSED" = openVol.greaterThan(ZERO) || (lastSegment.openingMissing && lastSegment.closedMsc == null) ? "OPEN" : "CLOSED";

  const single = reversalCount === 0 && !anyMissing;
  const entryNotional = segments.reduce((sum, s) => sum.plus(s.entryNotional), ZERO);
  const exitNotional = segments.reduce((sum, s) => sum.plus(s.exitNotional), ZERO);

  // Initial stop: opening deal first, then the opening order. Never inferred
  // from later observations or from the exit price.
  let initialStopLoss: string | null = null;
  let initialTakeProfit: string | null = null;
  let initialStopSource: InitialStopSource = "UNAVAILABLE";
  const firstSegment = segments[0];
  const openingDeal = firstSegment.openingMissing ? null : trade.find((d) => d.entry === "IN" || d.entry === "INOUT") ?? null;
  if (openingDeal && openingDeal.entry === "IN") {
    const openingOrder = openingDeal.orderTicket ? orders.find((o) => o.ticket === openingDeal.orderTicket) ?? null : null;
    if (openingDeal.stopLossState === "SET") {
      initialStopLoss = openingDeal.stopLoss;
      initialStopSource = "OPENING_DEAL";
    } else if (openingOrder?.stopLossState === "SET") {
      initialStopLoss = openingOrder.stopLoss;
      initialStopSource = "OPENING_ORDER";
    } else if (openingDeal.stopLossState === "NONE" || openingOrder?.stopLossState === "NONE") {
      initialStopSource = "NONE_AT_OPEN";
    }
    initialTakeProfit = openingDeal.takeProfit ?? openingOrder?.takeProfit ?? null;
  }

  const netProfit = profit.plus(commission).plus(swap).plus(fee);
  const firstTime = trade[0].timeMsc;

  return {
    positionId,
    symbol: trade[0].symbol ?? "",
    direction: firstSegment.direction,
    status,
    openedMsc: firstSegment.openingMissing ? null : firstTime,
    closedMsc: status === "CLOSED" ? lastSegment.closedMsc ?? trade[trade.length - 1].timeMsc : null,
    volumeIn: priceStr(volumeIn),
    volumeOut: priceStr(volumeOut),
    openVolume: priceStr(openVol),
    avgEntryPrice: single ? vwap(entryNotional, volumeIn) : null,
    avgExitPrice: single ? vwap(exitNotional, volumeOut) : null,
    profit: profit.toFixed(),
    commission: commission.toFixed(),
    swap: swap.toFixed(),
    fee: fee.toFixed(),
    netProfit: netProfit.toFixed(),
    dealCount: trade.length,
    entryCount,
    exitCount,
    reversalCount,
    initialStopLoss,
    initialTakeProfit,
    initialStopSource,
    segments: segments.map((s) => ({
      direction: s.direction,
      openedMsc: s.openedMsc?.toString() ?? null,
      closedMsc: s.closedMsc?.toString() ?? null,
      volumeIn: priceStr(s.volumeIn),
      volumeOut: priceStr(s.volumeOut),
      avgEntryPrice: s.openingMissing ? null : vwap(s.entryNotional, s.volumeIn),
      avgExitPrice: vwap(s.exitNotional, s.volumeOut),
      profit: s.profit.toFixed(),
      openingMissing: s.openingMissing,
    })),
    flags: [...flags].sort(),
    derivationVersion: MT5_POSITION_DERIVATION_VERSION,
    sourceHash: sourceHashOf(positionId, deals, orders),
  };
}
