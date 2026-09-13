/**
 * Deterministic simulated Replay execution (Stage 14 §11-26). Every function
 * here is pure — `(state, ...) => { state, events }` — mirroring
 * domain/market-data/replay-clock.ts's style so the engine is trivially
 * testable and never tied to React/Prisma.
 *
 * EXECUTION TIMEFRAME (§13): this engine always processes the FINEST base
 * candles available (the same 1m series the chart aggregates for display),
 * never the trader's currently-selected display timeframe. Callers must feed
 * base candles here — never 15m/1h aggregates — to minimize false ambiguity.
 *
 * OHLC AMBIGUITY POLICY (§12): when a single base candle's [low, high] range
 * touches BOTH the current stop and an unfilled target, this engine CANNOT
 * know which happened first from OHLC alone. It never guesses toward the
 * profitable outcome — it sets `pendingAmbiguity` and stops advancing past
 * that candle until `resolveAmbiguity` is called with the trader's manual
 * call. If finer-than-base data is ever available, feeding IT to this same
 * engine resolves the ambiguity automatically (the sequence becomes
 * unambiguous one level down); only once even the finest available data
 * can't order the two does it become a manual decision.
 */
import type { Candle } from "@/domain/market-data/candle";
import type {
  ExecutionEvent,
  PendingAmbiguity,
  ProcessResult,
  ReplayOrderType,
  ReplayOutcomeClass,
  ReplayPlannedTargetState,
  ReplayPositionState,
} from "@/domain/replay-execution/types";

const R_EPSILON = 0.001;

function riskPerUnit(state: ReplayPositionState): number {
  const entry = state.filledEntry ?? state.plannedEntry;
  return Math.abs(entry - state.initialStopLoss);
}

/** R multiple of exiting at `price` — ALWAYS relative to the original
 *  entry/initialStopLoss risk basis, never the (possibly moved) current
 *  stop (§21: moving the stop must never redefine what 1R means). */
export function rMultipleAt(state: ReplayPositionState, price: number): number {
  const risk = riskPerUnit(state);
  if (risk === 0) return 0;
  const entry = state.filledEntry ?? state.plannedEntry;
  const diff = state.direction === "LONG" ? price - entry : entry - price;
  return diff / risk;
}

export function classifyOutcome(state: ReplayPositionState): ReplayOutcomeClass {
  if (state.lifecycle !== "CLOSED") return "OPEN";
  if (state.realizedR > R_EPSILON) return "WIN";
  if (state.realizedR < -R_EPSILON) return "LOSS";
  return "BREAKEVEN";
}

function candleTouches(low: number, high: number, price: number): boolean {
  return low <= price && price <= high;
}

function slHit(direction: "LONG" | "SHORT", sl: number, candle: Candle): boolean {
  return direction === "LONG" ? candle.low <= sl : candle.high >= sl;
}

function targetHit(direction: "LONG" | "SHORT", price: number, candle: Candle): boolean {
  return direction === "LONG" ? candle.high >= price : candle.low <= price;
}

export interface PlaceOrderParams {
  direction: "LONG" | "SHORT";
  orderType: ReplayOrderType;
  /** MARKET: the current market price (caller resolves this from the last
   *  visible candle's close — never chosen by the trader). PENDING: the
   *  trader's chosen trigger price. */
  entryPrice: number;
  initialStopLoss: number;
  targets: { price: number; percentToClose: number }[];
  /** Always `replayCurrentTime` — never a trader-typed timestamp (§24). */
  timestamp: number;
}

export function placeOrder(params: PlaceOrderParams): ProcessResult {
  const targets: ReplayPlannedTargetState[] = params.targets.map((t, i) => ({
    id: `t${i + 1}`,
    order: i + 1,
    price: t.price,
    percentToClose: t.percentToClose,
    filledAt: null,
  }));

  const isMarket = params.orderType === "MARKET";
  const state: ReplayPositionState = {
    direction: params.direction,
    orderType: params.orderType,
    lifecycle: isMarket ? "OPEN" : "PENDING",
    plannedEntry: params.entryPrice,
    initialStopLoss: params.initialStopLoss,
    currentStopLoss: params.initialStopLoss,
    targets,
    filledEntry: isMarket ? params.entryPrice : null,
    filledAt: isMarket ? params.timestamp : null,
    remainingPercent: 100,
    realizedR: 0,
    closedAt: null,
    closeReason: null,
    lastProcessedTime: params.timestamp,
    pendingAmbiguity: null,
  };

  const events: ExecutionEvent[] = [
    { type: "ORDER_PLACED", timestamp: params.timestamp, data: { orderType: params.orderType, entryPrice: params.entryPrice } },
  ];
  if (isMarket) {
    events.push({ type: "ORDER_FILLED", timestamp: params.timestamp, data: { price: params.entryPrice } });
  }
  return { state, events };
}

/**
 * Advances `state` through every NEWLY REVEALED base candle in chronological
 * order, filling pending orders and resolving stop/target hits. Idempotent
 * by construction (§26): candles at or before `state.lastProcessedTime` are
 * ignored even if the caller mistakenly re-passes them, so calling this
 * twice with overlapping candle sets never double-fills or double-closes.
 * Processing halts (returns immediately, no further candles consumed) the
 * instant an ambiguous candle is hit — see `resolveAmbiguity`.
 */
export function processCandles(state: ReplayPositionState, candles: Candle[]): ProcessResult {
  if (state.lifecycle === "CLOSED" || state.lifecycle === "CANCELLED" || state.pendingAmbiguity) {
    return { state, events: [] };
  }

  const sorted = [...candles]
    .filter((c) => c.timestamp > state.lastProcessedTime)
    .sort((a, b) => a.timestamp - b.timestamp);

  let current = state;
  const events: ExecutionEvent[] = [];

  for (const candle of sorted) {
    if (current.lifecycle === "CLOSED" || current.lifecycle === "CANCELLED") break;

    if (current.lifecycle === "PENDING") {
      if (candleTouches(candle.low, candle.high, current.plannedEntry)) {
        current = { ...current, lifecycle: "OPEN", filledEntry: current.plannedEntry, filledAt: candle.timestamp };
        events.push({ type: "ORDER_FILLED", timestamp: candle.timestamp, data: { price: current.plannedEntry } });
      } else {
        current = { ...current, lastProcessedTime: candle.timestamp };
        continue;
      }
    }

    const slTouched = slHit(current.direction, current.currentStopLoss, candle);
    const unfilledTargets = current.targets.filter((t) => t.filledAt == null).sort((a, b) => a.order - b.order);
    const hitTargets = unfilledTargets.filter((t) => targetHit(current.direction, t.price, candle));

    if (slTouched && hitTargets.length > 0) {
      const ambiguity: PendingAmbiguity = {
        candleTimestamp: candle.timestamp,
        candle,
        slPrice: current.currentStopLoss,
        hitTargetIds: hitTargets.map((t) => t.id),
      };
      current = { ...current, pendingAmbiguity: ambiguity };
      events.push({ type: "AMBIGUOUS_CANDLE", timestamp: candle.timestamp, data: { hitTargetIds: ambiguity.hitTargetIds } });
      break;
    }

    if (slTouched) {
      const exitR = rMultipleAt(current, current.currentStopLoss);
      current = {
        ...current,
        lifecycle: "CLOSED",
        closedAt: candle.timestamp,
        closeReason: "STOP_LOSS",
        realizedR: current.realizedR + exitR * (current.remainingPercent / 100),
        remainingPercent: 0,
        lastProcessedTime: candle.timestamp,
      };
      events.push({ type: "FULL_CLOSE", timestamp: candle.timestamp, data: { reason: "STOP_LOSS", price: current.currentStopLoss } });
      continue;
    }

    if (hitTargets.length > 0) {
      for (const target of hitTargets) {
        const exitR = rMultipleAt(current, target.price);
        const closePercent = Math.min(target.percentToClose, current.remainingPercent);
        current = {
          ...current,
          realizedR: current.realizedR + exitR * (closePercent / 100),
          remainingPercent: current.remainingPercent - closePercent,
          targets: current.targets.map((t) => (t.id === target.id ? { ...t, filledAt: candle.timestamp } : t)),
        };
        events.push({
          type: "PARTIAL_CLOSE",
          timestamp: candle.timestamp,
          data: { targetId: target.id, price: target.price, percent: closePercent },
        });
        if (current.remainingPercent <= R_EPSILON) {
          current = { ...current, lifecycle: "CLOSED", closedAt: candle.timestamp, closeReason: "TARGET", remainingPercent: 0 };
          events.push({ type: "FULL_CLOSE", timestamp: candle.timestamp, data: { reason: "TARGET" } });
          break;
        }
        current = { ...current, lifecycle: "PARTIALLY_CLOSED" };
      }
    }

    current = { ...current, lastProcessedTime: candle.timestamp };
  }

  return { state: current, events };
}

/**
 * Manual resolution of an ambiguous candle (§12) — the trader's own call,
 * never automatic. `"SL_FIRST"` closes the whole remaining position at the
 * stop; `"TARGET_FIRST"` fills the touched target(s) first, then — since the
 * stop was ALSO touched in that same candle — closes whatever remains at
 * the stop. Either way the candle is fully consumed and processing can
 * continue from the next one.
 */
export function resolveAmbiguity(state: ReplayPositionState, resolution: "SL_FIRST" | "TARGET_FIRST"): ProcessResult {
  const ambiguity = state.pendingAmbiguity;
  if (!ambiguity) return { state, events: [] };

  let current: ReplayPositionState = { ...state, pendingAmbiguity: null };
  const events: ExecutionEvent[] = [{ type: "AMBIGUITY_RESOLVED", timestamp: ambiguity.candleTimestamp, data: { resolution } }];

  if (resolution === "SL_FIRST") {
    const exitR = rMultipleAt(current, ambiguity.slPrice);
    current = {
      ...current,
      lifecycle: "CLOSED",
      closedAt: ambiguity.candleTimestamp,
      closeReason: "STOP_LOSS",
      realizedR: current.realizedR + exitR * (current.remainingPercent / 100),
      remainingPercent: 0,
      lastProcessedTime: ambiguity.candleTimestamp,
    };
    events.push({ type: "FULL_CLOSE", timestamp: ambiguity.candleTimestamp, data: { reason: "STOP_LOSS" } });
    return { state: current, events };
  }

  // TARGET_FIRST — fill the touched target(s), then close any remainder at the stop.
  for (const targetId of ambiguity.hitTargetIds) {
    const target = current.targets.find((t) => t.id === targetId);
    if (!target || target.filledAt != null) continue;
    const exitR = rMultipleAt(current, target.price);
    const closePercent = Math.min(target.percentToClose, current.remainingPercent);
    current = {
      ...current,
      realizedR: current.realizedR + exitR * (closePercent / 100),
      remainingPercent: current.remainingPercent - closePercent,
      targets: current.targets.map((t) => (t.id === targetId ? { ...t, filledAt: ambiguity.candleTimestamp } : t)),
    };
    events.push({
      type: "PARTIAL_CLOSE",
      timestamp: ambiguity.candleTimestamp,
      data: { targetId, price: target.price, percent: closePercent },
    });
  }

  if (current.remainingPercent > R_EPSILON) {
    const exitR = rMultipleAt(current, ambiguity.slPrice);
    current = {
      ...current,
      lifecycle: "CLOSED",
      closedAt: ambiguity.candleTimestamp,
      closeReason: "STOP_LOSS",
      realizedR: current.realizedR + exitR * (current.remainingPercent / 100),
      remainingPercent: 0,
    };
    events.push({ type: "FULL_CLOSE", timestamp: ambiguity.candleTimestamp, data: { reason: "STOP_LOSS" } });
  } else {
    current = { ...current, lifecycle: "CLOSED", closedAt: ambiguity.candleTimestamp, closeReason: "TARGET" };
    events.push({ type: "FULL_CLOSE", timestamp: ambiguity.candleTimestamp, data: { reason: "TARGET" } });
  }

  current = { ...current, lastProcessedTime: ambiguity.candleTimestamp };
  return { state: current, events };
}

/** Moves the LIVE stop only — `initialStopLoss` (the 1R basis) never changes. */
export function moveStopLoss(state: ReplayPositionState, newStopLoss: number, timestamp: number): ProcessResult {
  return {
    state: { ...state, currentStopLoss: newStopLoss },
    events: [{ type: "SL_MOVED", timestamp, data: { from: state.currentStopLoss, to: newStopLoss } }],
  };
}

export function closePartialManually(state: ReplayPositionState, percent: number, price: number, timestamp: number): ProcessResult {
  const closePercent = Math.min(Math.max(percent, 0), state.remainingPercent);
  const exitR = rMultipleAt(state, price);
  const remaining = state.remainingPercent - closePercent;
  const next: ReplayPositionState = {
    ...state,
    realizedR: state.realizedR + exitR * (closePercent / 100),
    remainingPercent: remaining,
    lifecycle: remaining <= R_EPSILON ? "CLOSED" : "PARTIALLY_CLOSED",
    closedAt: remaining <= R_EPSILON ? timestamp : state.closedAt,
    closeReason: remaining <= R_EPSILON ? "MANUAL" : state.closeReason,
  };
  const events: ExecutionEvent[] = [{ type: "PARTIAL_CLOSE", timestamp, data: { price, percent: closePercent, manual: true } }];
  if (remaining <= R_EPSILON) events.push({ type: "FULL_CLOSE", timestamp, data: { reason: "MANUAL" } });
  return { state: next, events };
}

export function closeRemainingManually(state: ReplayPositionState, price: number, timestamp: number): ProcessResult {
  const exitR = rMultipleAt(state, price);
  const next: ReplayPositionState = {
    ...state,
    realizedR: state.realizedR + exitR * (state.remainingPercent / 100),
    remainingPercent: 0,
    lifecycle: "CLOSED",
    closedAt: timestamp,
    closeReason: "MANUAL",
  };
  return { state: next, events: [{ type: "FULL_CLOSE", timestamp, data: { reason: "MANUAL", price } }] };
}

export function cancelPendingOrder(state: ReplayPositionState, timestamp: number): ProcessResult {
  if (state.lifecycle !== "PENDING") return { state, events: [] };
  return {
    state: { ...state, lifecycle: "CANCELLED", closedAt: timestamp },
    events: [{ type: "ORDER_CANCELLED", timestamp }],
  };
}
