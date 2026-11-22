/**
 * The simulation step engine — pure and deterministic.
 *
 * Given an account's open positions, pending orders and balance, and the M1
 * bars revealed by one clock step, it walks the step's timeline minute by
 * minute and returns everything that happened:
 *   - pending orders that triggered (→ new positions),
 *   - stops / targets that filled (→ closed positions, realized PnL),
 *   - commissions on every fill side,
 *   - daily rollovers on the broker clock, with swaps for positions held,
 *   - a per-minute account snapshot (balance, close equity, adverse equity)
 *     handed to `onMinute`, which may HALT the step (a breach, Phase 5).
 *
 * Every money effect is returned as a ledger intent with a deterministic
 * idempotency key, so the service can append them atomically and a retried
 * step can never book twice.
 *
 * Within one minute, per instrument: existing positions are checked for
 * exits first, then pending orders; a position opened by a pending order on
 * this bar is checked for its STOP only (market.ts, D5).
 *
 * Currency: each position carries its frozen account value per price unit
 * (conversion fixed at entry). Simplification, documented in
 * SIMULATION_PLATFORM.md: cross-currency PnL is not re-converted at exit.
 */
import type { Decimal } from "decimal.js";

import { dec, ZERO, type DecimalInput } from "@/domain/execution/precision";
import { adversePrice, effectiveSpread, exitOnBar, markPrice, pendingFill, type ExitReason, type SimBar, type SimPendingType, type SimSide } from "./market";
import { commissionFor, grossPnl, pointsToPrice, swapFor } from "./money";
import type { SimLedgerType } from "./ledger";

export interface EnginePosition {
  id: string;
  symbol: string;
  side: SimSide;
  quantity: DecimalInput;
  entryPoints: number;
  stopLoss: number | null;
  takeProfit: number | null;
  /** Account-currency value of a 1.0 price move per quantity unit (frozen at entry). */
  valuePerPriceUnit: DecimalInput;
  priceScale: number;
  openedMinute: number;
}

export interface EngineOrder {
  id: string;
  symbol: string;
  side: SimSide;
  type: SimPendingType;
  pricePoints: number;
  quantity: DecimalInput;
  stopLoss: number | null;
  takeProfit: number | null;
  valuePerPriceUnit: DecimalInput;
  priceScale: number;
  /** Optional expiry (inclusive minute); the order is cancelled after it. */
  expiresMinute: number | null;
}

export interface EngineCosts {
  commissionPerUnitPerSide: DecimalInput;
  defaultSpreadPoints: number;
  swapLongPerUnit: DecimalInput;
  swapShortPerUnit: DecimalInput;
}

export interface LedgerIntent {
  type: SimLedgerType;
  amount: Decimal;
  idempotencyKey: string;
  positionId: string | null;
}

export type EngineEvent =
  | { kind: "ORDER_FILLED"; minute: number; orderId: string; positionId: string; price: number; gapped: boolean }
  | { kind: "ORDER_EXPIRED"; minute: number; orderId: string }
  | {
      kind: "POSITION_CLOSED";
      minute: number;
      positionId: string;
      reason: ExitReason;
      price: number;
      gapped: boolean;
      ambiguous: boolean;
      grossPnl: Decimal;
      commission: Decimal;
    }
  | { kind: "DAY_ROLLOVER"; minute: number; fromDay: number; toDay: number };

export interface MinuteSnapshot {
  minute: number;
  tradingDay: number;
  balance: Decimal;
  /** Balance + floating PnL at each open position's bar close. */
  equity: Decimal;
  /** Balance + floating PnL at each position's worst price this minute (D6). */
  adverseEquity: Decimal;
  openPositions: number;
  /** Positions opened by pending orders during this minute (market orders are counted by the execution service). */
  openedThisMinute: number;
}

export interface StepInput {
  /** Exclusive: the clock's current minute before the step. */
  fromMinute: number;
  /** Ascending union of bar minutes in (fromMinute, toMinute]. */
  timeline: number[];
  /** symbol → minute → bar */
  bars: Map<string, Map<number, SimBar>>;
  positions: EnginePosition[];
  orders: EngineOrder[];
  balance: DecimalInput;
  costs: EngineCosts;
  dailyResetHour: number;
  /** Fresh ids for positions created by pending fills (deterministic in tests). */
  newPositionId: (order: EngineOrder) => string;
  /** Called after each minute is processed; return "HALT" to stop the step at this minute. */
  onMinute?: (snapshot: MinuteSnapshot) => "HALT" | void;
}

export interface StepResult {
  /** The minute the clock ends on (the last processed minute, or fromMinute if none). */
  endMinute: number;
  halted: boolean;
  events: EngineEvent[];
  ledger: LedgerIntent[];
  positions: EnginePosition[];
  closedPositionIds: string[];
  orders: EngineOrder[];
  balance: Decimal;
}

/** Trading-day index of a broker-clock minute, given the daily reset hour. */
export function tradingDayOf(minute: number, resetHour: number): number {
  return Math.floor((minute - resetHour * 60) / 1440);
}

function unrealized(p: EnginePosition, pricePoints: number): Decimal {
  return grossPnl({
    side: p.side,
    entry: pointsToPrice(p.entryPoints, p.priceScale),
    exit: pointsToPrice(pricePoints, p.priceScale),
    quantity: p.quantity,
    valuePerPriceUnit: p.valuePerPriceUnit,
  });
}

export function runStep(input: StepInput): StepResult {
  const events: EngineEvent[] = [];
  const ledger: LedgerIntent[] = [];
  let positions = [...input.positions];
  let orders = [...input.orders];
  const closed: string[] = [];
  let balance = dec(input.balance);
  let endMinute = input.fromMinute;
  let halted = false;
  /** Latest bar seen per symbol (for marking positions on minutes their symbol has no bar). */
  const lastBar = new Map<string, SimBar>();
  let day = tradingDayOf(input.fromMinute, input.dailyResetHour);

  const book = (type: SimLedgerType, amount: Decimal, key: string, positionId: string | null) => {
    if (amount.isZero()) return;
    balance = balance.plus(amount);
    ledger.push({ type, amount, idempotencyKey: key, positionId });
  };

  for (const minute of input.timeline) {
    if (minute <= input.fromMinute) continue;

    // Daily rollover (broker clock): swaps for every position held across it.
    const newDay = tradingDayOf(minute, input.dailyResetHour);
    if (newDay !== day) {
      const nights = newDay - day;
      for (const p of positions) {
        const perUnit = p.side === "BUY" ? input.costs.swapLongPerUnit : input.costs.swapShortPerUnit;
        book("SWAP", swapFor(p.quantity, dec(perUnit).times(nights)), `swap:${p.id}:${newDay}`, p.id);
      }
      events.push({ kind: "DAY_ROLLOVER", minute, fromDay: day, toDay: newDay });
      day = newDay;
    }

    const openedThisMinute = new Set<string>();
    for (const [symbol, byMinute] of input.bars) {
      const bar = byMinute.get(minute);
      if (!bar) continue;
      lastBar.set(symbol, bar);
      const spread = effectiveSpread(bar, input.costs.defaultSpreadPoints);

      // 1 · exits of positions opened before this minute
      for (const p of positions.filter((x) => x.symbol === symbol)) {
        const exit = exitOnBar(p, bar, spread);
        if (!exit) continue;
        const pnl = unrealized(p, exit.price);
        const commission = commissionFor(p.quantity, input.costs.commissionPerUnitPerSide);
        book("REALIZED_PNL", pnl, `close:${p.id}`, p.id);
        book("COMMISSION", commission, `commission-close:${p.id}`, p.id);
        events.push({ kind: "POSITION_CLOSED", minute, positionId: p.id, reason: exit.reason, price: exit.price, gapped: exit.gapped, ambiguous: exit.ambiguous, grossPnl: pnl, commission });
        closed.push(p.id);
      }
      positions = positions.filter((x) => !closed.includes(x.id));

      // 2 · pending orders
      for (const o of orders.filter((x) => x.symbol === symbol)) {
        const fill = pendingFill({ side: o.side, type: o.type, price: o.pricePoints }, bar, spread);
        if (!fill) continue;
        const positionId = input.newPositionId(o);
        const position: EnginePosition = {
          id: positionId,
          symbol,
          side: o.side,
          quantity: o.quantity,
          entryPoints: fill.price,
          stopLoss: o.stopLoss,
          takeProfit: o.takeProfit,
          valuePerPriceUnit: o.valuePerPriceUnit,
          priceScale: o.priceScale,
          openedMinute: minute,
        };
        book("COMMISSION", commissionFor(o.quantity, input.costs.commissionPerUnitPerSide), `commission-open:${positionId}`, positionId);
        events.push({ kind: "ORDER_FILLED", minute, orderId: o.id, positionId, price: fill.price, gapped: fill.gapped });
        orders = orders.filter((x) => x.id !== o.id);
        openedThisMinute.add(positionId);

        // Same bar: the stop only (the target can't be assumed after the fill).
        const exit = exitOnBar(position, bar, spread, true);
        if (exit) {
          const pnl = unrealized(position, exit.price);
          const commission = commissionFor(position.quantity, input.costs.commissionPerUnitPerSide);
          book("REALIZED_PNL", pnl, `close:${positionId}`, positionId);
          book("COMMISSION", commission, `commission-close:${positionId}`, positionId);
          events.push({ kind: "POSITION_CLOSED", minute, positionId, reason: exit.reason, price: exit.price, gapped: exit.gapped, ambiguous: true, grossPnl: pnl, commission });
          closed.push(positionId);
        } else {
          positions.push(position);
        }
      }
    }

    // Expiries (after this minute had its chance to fill).
    for (const o of orders.filter((x) => x.expiresMinute != null && x.expiresMinute <= minute)) {
      events.push({ kind: "ORDER_EXPIRED", minute, orderId: o.id });
    }
    orders = orders.filter((x) => x.expiresMinute == null || x.expiresMinute > minute);

    // Snapshot for the rule engine.
    let equity = balance;
    let adverseEquity = balance;
    for (const p of positions) {
      const bar = lastBar.get(p.symbol);
      if (!bar) continue;
      const spread = effectiveSpread(bar, input.costs.defaultSpreadPoints);
      equity = equity.plus(unrealized(p, markPrice(p.side, bar, spread)));
      // A position opened during this minute only saw the part of the bar after its fill;
      // its adverse price is bounded by its own entry on that bar.
      const adverse = openedThisMinute.has(p.id) ? markPrice(p.side, bar, spread) : adversePrice(p.side, bar, spread);
      adverseEquity = adverseEquity.plus(unrealized(p, adverse));
    }
    endMinute = minute;
    const verdict = input.onMinute?.({
      minute,
      tradingDay: day,
      balance,
      equity,
      adverseEquity: adverseEquity.lessThan(equity) ? adverseEquity : equity,
      openPositions: positions.length,
      openedThisMinute: openedThisMinute.size,
    });
    if (verdict === "HALT") {
      halted = true;
      break;
    }
  }

  return { endMinute, halted, events, ledger, positions, closedPositionIds: closed, orders, balance };
}

/** Floating PnL of positions at given marks (symbol → bar), for display and rule checks. */
export function floatingPnl(positions: EnginePosition[], marks: Map<string, SimBar>, defaultSpreadPoints: number): Decimal {
  let total = ZERO;
  for (const p of positions) {
    const bar = marks.get(p.symbol);
    if (!bar) continue;
    total = total.plus(unrealized(p, markPrice(p.side, bar, effectiveSpread(bar, defaultSpreadPoints))));
  }
  return total;
}
