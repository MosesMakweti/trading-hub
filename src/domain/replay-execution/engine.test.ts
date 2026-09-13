import { describe, expect, it } from "vitest";

import {
  cancelPendingOrder,
  classifyOutcome,
  closePartialManually,
  closeRemainingManually,
  moveStopLoss,
  placeOrder,
  processCandles,
  resolveAmbiguity,
} from "@/domain/replay-execution/engine";
import type { Candle } from "@/domain/market-data/candle";
import type { ReplayPositionState } from "@/domain/replay-execution/types";

const MIN = 60_000;
const T0 = Date.UTC(2026, 7, 3, 10, 0, 0);

function candle(minutesAfterT0: number, o: number, h: number, l: number, c: number): Candle {
  return { timestamp: T0 + minutesAfterT0 * MIN, open: o, high: h, low: l, close: c, volume: null };
}

describe("placeOrder", () => {
  it("a MARKET order fills immediately at the given entry price", () => {
    const { state, events } = placeOrder({
      direction: "LONG",
      orderType: "MARKET",
      entryPrice: 100,
      initialStopLoss: 99,
      targets: [],
      timestamp: T0,
    });
    expect(state.lifecycle).toBe("OPEN");
    expect(state.filledEntry).toBe(100);
    expect(state.filledAt).toBe(T0);
    expect(events.map((e) => e.type)).toEqual(["ORDER_PLACED", "ORDER_FILLED"]);
  });

  it("a PENDING order starts unfilled", () => {
    const { state, events } = placeOrder({
      direction: "SHORT",
      orderType: "PENDING",
      entryPrice: 105,
      initialStopLoss: 106,
      targets: [],
      timestamp: T0,
    });
    expect(state.lifecycle).toBe("PENDING");
    expect(state.filledEntry).toBeNull();
    expect(events.map((e) => e.type)).toEqual(["ORDER_PLACED"]);
  });
});

describe("pending order fill", () => {
  it("fills only once a later candle actually reaches the entry price", () => {
    const { state: pending } = placeOrder({
      direction: "LONG",
      orderType: "PENDING",
      entryPrice: 100,
      initialStopLoss: 99,
      targets: [],
      timestamp: T0,
    });

    // Candle 1: price stays above 100 — must NOT fill yet.
    const notYet = processCandles(pending, [candle(1, 101, 102, 100.5, 101)]);
    expect(notYet.state.lifecycle).toBe("PENDING");
    expect(notYet.events).toEqual([]);

    // Candle 2: range touches 100 — fills now.
    const filled = processCandles(notYet.state, [candle(2, 101, 101, 99.8, 100.2)]);
    expect(filled.state.lifecycle).toBe("OPEN");
    expect(filled.state.filledEntry).toBe(100);
    expect(filled.events.map((e) => e.type)).toEqual(["ORDER_FILLED"]);
  });

  it("never fills before price legally reaches the entry, no matter how many candles pass", () => {
    const { state: pending } = placeOrder({
      direction: "LONG",
      orderType: "PENDING",
      entryPrice: 90,
      initialStopLoss: 89,
      targets: [],
      timestamp: T0,
    });
    const far = [candle(1, 100, 101, 99, 100), candle(2, 100, 102, 99.5, 101), candle(3, 101, 103, 100, 102)];
    const result = processCandles(pending, far);
    expect(result.state.lifecycle).toBe("PENDING");
  });
});

describe("stop-loss", () => {
  function openLong(): ReplayPositionState {
    return placeOrder({ direction: "LONG", orderType: "MARKET", entryPrice: 100, initialStopLoss: 99, targets: [], timestamp: T0 }).state;
  }

  it("LONG closes at -1R when the low touches the stop", () => {
    const result = processCandles(openLong(), [candle(1, 100, 100.5, 98.5, 99)]);
    expect(result.state.lifecycle).toBe("CLOSED");
    expect(result.state.closeReason).toBe("STOP_LOSS");
    expect(result.state.realizedR).toBeCloseTo(-1, 6);
    expect(classifyOutcome(result.state)).toBe("LOSS");
  });

  it("SHORT closes at -1R when the high touches the stop", () => {
    const short = placeOrder({ direction: "SHORT", orderType: "MARKET", entryPrice: 100, initialStopLoss: 101, targets: [], timestamp: T0 }).state;
    const result = processCandles(short, [candle(1, 100, 101.5, 99.5, 101)]);
    expect(result.state.realizedR).toBeCloseTo(-1, 6);
  });
});

describe("targets / partial closes / weighted realized R", () => {
  function openLongWithTargets(): ReplayPositionState {
    return placeOrder({
      direction: "LONG",
      orderType: "MARKET",
      entryPrice: 100,
      initialStopLoss: 99, // 1R = 1 price unit
      targets: [
        { price: 101, percentToClose: 30 }, // +1R
        { price: 102, percentToClose: 30 }, // +2R
        { price: 103, percentToClose: 40 }, // +3R
      ],
      timestamp: T0,
    }).state;
  }

  it("the exact weighted example from the spec: 30%x1R + 30%x2R + 40%x3R = 2.10R", () => {
    const state = openLongWithTargets();
    // One big candle sweeps through all three targets.
    const result = processCandles(state, [candle(1, 100, 103.5, 99.5, 103)]);
    expect(result.state.lifecycle).toBe("CLOSED");
    expect(result.state.closeReason).toBe("TARGET");
    expect(result.state.realizedR).toBeCloseTo(2.1, 6);
  });

  it("processes targets across multiple candles, accumulating remaining % correctly", () => {
    let state = openLongWithTargets();
    let r = processCandles(state, [candle(1, 100, 101.2, 99.8, 101)]);
    state = r.state;
    expect(state.lifecycle).toBe("PARTIALLY_CLOSED");
    expect(state.remainingPercent).toBe(70);
    expect(state.realizedR).toBeCloseTo(0.3, 6);

    r = processCandles(state, [candle(2, 101, 102.2, 100.8, 102)]);
    state = r.state;
    expect(state.remainingPercent).toBe(40);
    expect(state.realizedR).toBeCloseTo(0.9, 6); // 0.3 + 0.3*2

    r = processCandles(state, [candle(3, 102, 103.2, 101.8, 103)]);
    state = r.state;
    expect(state.lifecycle).toBe("CLOSED");
    expect(state.realizedR).toBeCloseTo(2.1, 6);
  });

  it("SHORT targets use the mirrored price direction", () => {
    const short = placeOrder({
      direction: "SHORT",
      orderType: "MARKET",
      entryPrice: 100,
      initialStopLoss: 101,
      targets: [{ price: 98, percentToClose: 100 }], // +2R
      timestamp: T0,
    }).state;
    const result = processCandles(short, [candle(1, 100, 100.2, 97.5, 98)]);
    expect(result.state.realizedR).toBeCloseTo(2, 6);
  });
});

describe("breakeven (§22)", () => {
  it("a trade closed exactly at entry classifies as BREAKEVEN, not win or loss", () => {
    const state = placeOrder({ direction: "LONG", orderType: "MARKET", entryPrice: 100, initialStopLoss: 99, targets: [], timestamp: T0 }).state;
    const moved = moveStopLoss(state, 100, T0 + 1 * MIN).state; // move to breakeven
    const result = processCandles(moved, [candle(2, 100, 100.5, 99.5, 100)]);
    expect(result.state.realizedR).toBeCloseTo(0, 6);
    expect(classifyOutcome(result.state)).toBe("BREAKEVEN");
  });

  it("partial profit is preserved even when the remainder closes at breakeven", () => {
    let state = placeOrder({
      direction: "LONG",
      orderType: "MARKET",
      entryPrice: 100,
      initialStopLoss: 99,
      targets: [{ price: 101, percentToClose: 50 }],
      timestamp: T0,
    }).state;
    state = processCandles(state, [candle(1, 100, 101.2, 99.8, 101)]).state;
    expect(state.realizedR).toBeCloseTo(0.5, 6); // 50% x 1R

    state = moveStopLoss(state, 100, T0 + 2 * MIN).state; // move remaining 50% to breakeven
    const result = processCandles(state, [candle(3, 100, 100.5, 99.5, 100)]);
    expect(result.state.lifecycle).toBe("CLOSED");
    expect(result.state.realizedR).toBeCloseTo(0.5, 6); // partial gain preserved, remainder contributes 0
  });
});

describe("moving the stop never redefines the original 1R (§21)", () => {
  it("R is still computed from the ORIGINAL entry/stop after the stop is moved", () => {
    let state = placeOrder({ direction: "LONG", orderType: "MARKET", entryPrice: 100, initialStopLoss: 99, targets: [], timestamp: T0 }).state;
    state = moveStopLoss(state, 100.5, T0 + 1 * MIN).state; // moved to lock in some profit
    expect(state.initialStopLoss).toBe(99); // untouched
    const result = processCandles(state, [candle(2, 100.6, 100.7, 100.4, 100.5)]); // stopped out at the NEW stop
    // Exit at 100.5 with ORIGINAL risk basis (100 - 99 = 1): R = (100.5-100)/1 = 0.5, not -1.
    expect(result.state.realizedR).toBeCloseTo(0.5, 6);
  });
});

describe("manual management (§19)", () => {
  it("closePartialManually closes a percentage at a given price", () => {
    const state = placeOrder({ direction: "LONG", orderType: "MARKET", entryPrice: 100, initialStopLoss: 99, targets: [], timestamp: T0 }).state;
    const result = closePartialManually(state, 50, 101, T0 + 5 * MIN);
    expect(result.state.remainingPercent).toBe(50);
    expect(result.state.lifecycle).toBe("PARTIALLY_CLOSED");
    expect(result.state.realizedR).toBeCloseTo(0.5, 6);
  });

  it("closeRemainingManually fully closes the position", () => {
    const state = placeOrder({ direction: "LONG", orderType: "MARKET", entryPrice: 100, initialStopLoss: 99, targets: [], timestamp: T0 }).state;
    const result = closeRemainingManually(state, 102, T0 + 5 * MIN);
    expect(result.state.lifecycle).toBe("CLOSED");
    expect(result.state.closeReason).toBe("MANUAL");
    expect(result.state.realizedR).toBeCloseTo(2, 6);
  });

  it("cancelPendingOrder cancels an unfilled pending order", () => {
    const state = placeOrder({ direction: "LONG", orderType: "PENDING", entryPrice: 90, initialStopLoss: 89, targets: [], timestamp: T0 }).state;
    const result = cancelPendingOrder(state, T0 + 1 * MIN);
    expect(result.state.lifecycle).toBe("CANCELLED");
  });

  it("cancelPendingOrder is a no-op on an already-open position", () => {
    const state = placeOrder({ direction: "LONG", orderType: "MARKET", entryPrice: 100, initialStopLoss: 99, targets: [], timestamp: T0 }).state;
    const result = cancelPendingOrder(state, T0 + 1 * MIN);
    expect(result.state.lifecycle).toBe("OPEN");
    expect(result.events).toEqual([]);
  });
});

describe("OHLC ambiguity (§12)", () => {
  function ambiguousState(): ReplayPositionState {
    return placeOrder({
      direction: "LONG",
      orderType: "MARKET",
      entryPrice: 100,
      initialStopLoss: 99,
      targets: [{ price: 102, percentToClose: 100 }],
      timestamp: T0,
    }).state;
  }

  it("flags AMBIGUOUS rather than guessing when one candle touches both SL and TP", () => {
    const state = ambiguousState();
    // High reaches TP (102), low reaches SL (99) — same candle.
    const result = processCandles(state, [candle(1, 100.5, 102.5, 98.5, 101)]);
    expect(result.state.pendingAmbiguity).not.toBeNull();
    expect(result.state.lifecycle).toBe("OPEN"); // not auto-closed
    expect(result.events.map((e) => e.type)).toEqual(["AMBIGUOUS_CANDLE"]);
  });

  it("does NOT automatically choose the profitable outcome — realizedR is 0 until resolved", () => {
    const state = ambiguousState();
    const result = processCandles(state, [candle(1, 100.5, 102.5, 98.5, 101)]);
    expect(result.state.realizedR).toBe(0);
  });

  it("further candles are not processed while ambiguity is pending", () => {
    const state = ambiguousState();
    const afterAmbiguous = processCandles(state, [candle(1, 100.5, 102.5, 98.5, 101)]).state;
    const result = processCandles(afterAmbiguous, [candle(2, 101, 105, 100, 104)]);
    expect(result.state).toEqual(afterAmbiguous); // untouched
    expect(result.events).toEqual([]);
  });

  it("resolveAmbiguity(SL_FIRST) closes at the stop, -1R", () => {
    const state = ambiguousState();
    const afterAmbiguous = processCandles(state, [candle(1, 100.5, 102.5, 98.5, 101)]).state;
    const result = resolveAmbiguity(afterAmbiguous, "SL_FIRST");
    expect(result.state.lifecycle).toBe("CLOSED");
    expect(result.state.realizedR).toBeCloseTo(-1, 6);
  });

  it("resolveAmbiguity(TARGET_FIRST) fills the target, then closes any remainder at the stop", () => {
    const state = ambiguousState();
    const afterAmbiguous = processCandles(state, [candle(1, 100.5, 102.5, 98.5, 101)]).state;
    const result = resolveAmbiguity(afterAmbiguous, "TARGET_FIRST");
    expect(result.state.lifecycle).toBe("CLOSED");
    // Target was 100% close at +2R — since it closes the whole position,
    // the stop never gets a chance to also apply.
    expect(result.state.realizedR).toBeCloseTo(2, 6);
  });

  it("finer data resolves what coarser data could not (architecture proof for §13)", () => {
    // A 5-minute-equivalent candle looks ambiguous (touches both SL and TP)...
    const coarse = candle(1, 100.5, 102.5, 98.5, 101);
    const state = ambiguousState();
    const coarseResult = processCandles(state, [coarse]);
    expect(coarseResult.state.pendingAmbiguity).not.toBeNull();

    // ...but finer sub-candles covering the SAME window show the TP was
    // touched before the SL, so feeding those instead never hits ambiguity.
    const fine = [
      candle(1.0, 100.5, 101.0, 100.2, 100.8),
      candle(1.33, 100.8, 102.5, 100.6, 102.4), // TP (102) touched here
      candle(1.66, 102.4, 102.4, 98.5, 99), // SL (99) touched only after
    ];
    const fineResult = processCandles(state, fine);
    expect(fineResult.state.pendingAmbiguity).toBeNull();
    expect(fineResult.state.lifecycle).toBe("CLOSED");
    expect(fineResult.state.closeReason).toBe("TARGET");
  });
});

describe("idempotent candle processing (§26)", () => {
  it("processing the same candles twice never double-fills, double-partials, or double-closes", () => {
    const state = placeOrder({
      direction: "LONG",
      orderType: "MARKET",
      entryPrice: 100,
      initialStopLoss: 99,
      targets: [{ price: 101, percentToClose: 100 }],
      timestamp: T0,
    }).state;
    const candles = [candle(1, 100, 101.5, 99.8, 101.2)];

    const first = processCandles(state, candles);
    expect(first.state.lifecycle).toBe("CLOSED");
    expect(first.state.realizedR).toBeCloseTo(1, 6);

    // Re-processing the SAME candle array again must be a safe no-op.
    const second = processCandles(first.state, candles);
    expect(second.state).toEqual(first.state);
    expect(second.events).toEqual([]);
  });

  it("re-processing an overlapping candle set only advances past the watermark", () => {
    const state = placeOrder({ direction: "LONG", orderType: "MARKET", entryPrice: 100, initialStopLoss: 99, targets: [], timestamp: T0 }).state;
    const batch1 = [candle(1, 100, 100.3, 99.8, 100.1)];
    const afterBatch1 = processCandles(state, batch1).state;

    // batch2 includes candle 1 again (already processed) plus a genuinely new candle 2.
    const batch2 = [candle(1, 100, 100.3, 99.8, 100.1), candle(2, 100.1, 100.4, 99.9, 100.2)];
    const result = processCandles(afterBatch1, batch2);
    expect(result.state.lastProcessedTime).toBe(candle(2, 0, 0, 0, 0).timestamp);
    expect(result.state.lifecycle).toBe("OPEN"); // still open, nothing hit
  });
});

describe("isolation / no fabrication", () => {
  it("processCandles never advances beyond the candles it's given", () => {
    const state = placeOrder({ direction: "LONG", orderType: "MARKET", entryPrice: 100, initialStopLoss: 99, targets: [], timestamp: T0 }).state;
    const result = processCandles(state, []);
    expect(result.state).toEqual(state);
    expect(result.events).toEqual([]);
  });

  it("a CLOSED position ignores further candles entirely", () => {
    const state = closeRemainingManually(
      placeOrder({ direction: "LONG", orderType: "MARKET", entryPrice: 100, initialStopLoss: 99, targets: [], timestamp: T0 }).state,
      105,
      T0 + 1 * MIN,
    ).state;
    const result = processCandles(state, [candle(2, 105, 200, 1, 105)]);
    expect(result.state).toEqual(state);
  });
});
