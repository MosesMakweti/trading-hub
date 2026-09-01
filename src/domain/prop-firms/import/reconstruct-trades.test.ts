import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import { reconstructTrades, splitReversalFills, type ExecutionForReconstruction } from "./reconstruct-trades";

let counter = 0;
type FillInput = Partial<Omit<ExecutionForReconstruction, "quantity" | "price" | "executedAt">> & {
  direction: "LONG" | "SHORT";
  quantity: number;
  price: number;
  executedAt: string;
};
function fill(overrides: FillInput): ExecutionForReconstruction {
  counter += 1;
  const id = overrides.id ?? `e${counter}`;
  return {
    instrumentNormalized: "EURUSD",
    grossPnl: new Decimal(0),
    commission: new Decimal(0),
    swap: new Decimal(0),
    otherFees: new Decimal(0),
    sourceExecutionId: id,
    ...overrides,
    id,
    quantity: new Decimal(overrides.quantity),
    price: new Decimal(overrides.price),
    executedAt: new Date(overrides.executedAt),
  };
}

describe("reconstructTrades — market fills", () => {
  it("groups one entry + one exit into a single closed trade", () => {
    const executions = [
      fill({ direction: "LONG", quantity: 1, price: 1.1, executedAt: "2026-06-01T10:00:00Z" }),
      fill({ direction: "SHORT", quantity: 1, price: 1.105, executedAt: "2026-06-01T11:00:00Z", grossPnl: new Decimal(50) }),
    ];
    const [trade] = reconstructTrades(executions);
    expect(trade.status).toBe("CLOSED");
    expect(trade.direction).toBe("LONG");
    expect(trade.entryCount).toBe(1);
    expect(trade.exitCount).toBe(1);
    expect(trade.avgEntryPrice.toNumber()).toBe(1.1);
    expect(trade.avgExitPrice?.toNumber()).toBe(1.105);
    expect(trade.grossPnl.toNumber()).toBe(50);
    expect(trade.closedAt?.toISOString()).toBe("2026-06-01T11:00:00.000Z");
  });

  it("leaves an unmatched entry as OPEN", () => {
    const executions = [fill({ direction: "LONG", quantity: 1, price: 1.1, executedAt: "2026-06-01T10:00:00Z" })];
    const [trade] = reconstructTrades(executions);
    expect(trade.status).toBe("OPEN");
    expect(trade.closedAt).toBeNull();
    expect(trade.avgExitPrice).toBeNull();
  });

  it("keeps separate instruments in separate trades", () => {
    const executions = [
      fill({ direction: "LONG", quantity: 1, price: 1.1, executedAt: "2026-06-01T10:00:00Z", instrumentNormalized: "EURUSD" }),
      fill({ direction: "SHORT", quantity: 1, price: 1.105, executedAt: "2026-06-01T11:00:00Z", instrumentNormalized: "EURUSD" }),
      fill({ direction: "LONG", quantity: 1, price: 100, executedAt: "2026-06-01T10:30:00Z", instrumentNormalized: "GBPUSD" }),
    ];
    const trades = reconstructTrades(executions);
    expect(trades).toHaveLength(2);
    expect(new Set(trades.map((t) => t.instrument))).toEqual(new Set(["EURUSD", "GBPUSD"]));
  });
});

describe("reconstructTrades — partial fills, scaling, multiple targets", () => {
  it("scales in across two entries with a quantity-weighted avg entry price", () => {
    const executions = [
      fill({ direction: "LONG", quantity: 1, price: 1.1, executedAt: "2026-06-01T10:00:00Z" }),
      fill({ direction: "LONG", quantity: 1, price: 1.12, executedAt: "2026-06-01T10:05:00Z" }),
      fill({ direction: "SHORT", quantity: 2, price: 1.13, executedAt: "2026-06-01T11:00:00Z" }),
    ];
    const [trade] = reconstructTrades(executions);
    expect(trade.entryCount).toBe(2);
    expect(trade.avgEntryPrice.toNumber()).toBeCloseTo(1.11, 5);
    expect(trade.status).toBe("CLOSED");
  });

  it("marks a partially closed position as PARTIAL, still tracking the remainder", () => {
    const executions = [
      fill({ direction: "LONG", quantity: 3, price: 1.1, executedAt: "2026-06-01T10:00:00Z" }),
      fill({ direction: "SHORT", quantity: 1, price: 1.12, executedAt: "2026-06-01T11:00:00Z", grossPnl: new Decimal(20) }),
    ];
    const [trade] = reconstructTrades(executions);
    expect(trade.status).toBe("PARTIAL");
    expect(trade.closedAt).toBeNull();
    expect(trade.exitCount).toBe(1);
  });

  it("handles multiple partial exits (scaling out at multiple targets) ending fully closed", () => {
    const executions = [
      fill({ direction: "LONG", quantity: 3, price: 1.1, executedAt: "2026-06-01T10:00:00Z" }),
      fill({ direction: "SHORT", quantity: 1, price: 1.12, executedAt: "2026-06-01T11:00:00Z", grossPnl: new Decimal(20) }),
      fill({ direction: "SHORT", quantity: 1, price: 1.14, executedAt: "2026-06-01T12:00:00Z", grossPnl: new Decimal(40) }),
      fill({ direction: "SHORT", quantity: 1, price: 1.16, executedAt: "2026-06-01T13:00:00Z", grossPnl: new Decimal(60) }),
    ];
    const [trade] = reconstructTrades(executions);
    expect(trade.status).toBe("CLOSED");
    expect(trade.exitCount).toBe(3);
    expect(trade.avgExitPrice?.toNumber()).toBeCloseTo(1.14, 5);
    expect(trade.grossPnl.toNumber()).toBe(120);
  });

  it("spans multiple days without losing continuity", () => {
    const executions = [
      fill({ direction: "LONG", quantity: 1, price: 1.1, executedAt: "2026-06-01T10:00:00Z" }),
      fill({ direction: "SHORT", quantity: 1, price: 1.12, executedAt: "2026-06-05T15:00:00Z", grossPnl: new Decimal(20) }),
    ];
    const [trade] = reconstructTrades(executions);
    expect(trade.status).toBe("CLOSED");
    expect(trade.openedAt.toISOString()).toBe("2026-06-01T10:00:00.000Z");
    expect(trade.closedAt?.toISOString()).toBe("2026-06-05T15:00:00.000Z");
  });
});

describe("splitReversalFills + reconstructTrades — reversals", () => {
  it("splits a single overshooting fill into a close + a new open, in opposite directions", () => {
    const raw = [
      fill({ direction: "LONG", quantity: 1, price: 1.1, executedAt: "2026-06-01T10:00:00Z" }),
      fill({
        id: "reversal",
        direction: "SHORT",
        quantity: 3,
        price: 1.12,
        executedAt: "2026-06-01T11:00:00Z",
        grossPnl: new Decimal(20),
        commission: new Decimal(-3),
      }),
    ];
    const split = splitReversalFills(raw);
    expect(split).toHaveLength(3); // untouched entry + close-piece + open-piece

    const closePiece = split.find((e) => e.id === "reversal:close")!;
    const openPiece = split.find((e) => e.id === "reversal:open")!;
    expect(closePiece.quantity.toNumber()).toBe(1);
    expect(openPiece.quantity.toNumber()).toBe(2);
    // All realized P&L belongs to the closing piece — the opening piece has none.
    expect(closePiece.grossPnl.toNumber()).toBe(20);
    expect(openPiece.grossPnl.toNumber()).toBe(0);
    // Commission prorated 1/3 vs 2/3 by quantity.
    expect(closePiece.commission.toNumber()).toBeCloseTo(-1, 5);
    expect(openPiece.commission.toNumber()).toBeCloseTo(-2, 5);

    const trades = reconstructTrades(split);
    expect(trades).toHaveLength(2);
    const closed = trades.find((t) => t.status === "CLOSED")!;
    const opened = trades.find((t) => t.status === "OPEN")!;
    expect(closed.direction).toBe("LONG");
    expect(closed.totalQuantity.toNumber()).toBe(1);
    expect(opened.direction).toBe("SHORT");
    expect(opened.totalQuantity.toNumber()).toBe(2);
    expect(opened.avgEntryPrice.toNumber()).toBe(1.12);
  });

  it("passes non-overshooting fills through unchanged", () => {
    const raw = [
      fill({ direction: "LONG", quantity: 2, price: 1.1, executedAt: "2026-06-01T10:00:00Z" }),
      fill({ direction: "SHORT", quantity: 2, price: 1.12, executedAt: "2026-06-01T11:00:00Z" }),
    ];
    const split = splitReversalFills(raw);
    expect(split).toHaveLength(2);
    expect(split.map((e) => e.id)).toEqual(raw.map((e) => e.id));
  });
});
