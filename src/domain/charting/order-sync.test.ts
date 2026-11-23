import { describe, expect, it } from "vitest";

import type { ChartDrawing } from "@/domain/native-replay/drawings/model";
import { draftFromDrawing, linkStatus, positionFromTicket, riskPreview, samePosition } from "./order-sync";

const drawing = (type: "LONG" | "SHORT", entry: number, stop: number, targets: number[]): ChartDrawing => ({
  id: "d-00000001",
  type,
  assetSymbol: "EURUSD",
  anchors: [{ time: 1, price: entry }, { time: 2, price: entry }],
  style: { color: "#8ab4f8", width: 2, dash: "solid", opacity: 1 },
  data: { position: { entry, stop, targets } },
  locked: false,
  hidden: false,
  linkedTradeId: null,
});
const q = { bid: 1.1, ask: 1.1002 };

describe("drawing → order draft", () => {
  it("derives side and order type from the entry against the quote", () => {
    expect(draftFromDrawing(drawing("LONG", 1.099, 1.098, [1.102]), q)).toEqual({ side: "BUY", type: "LIMIT", price: 1.099, stopLoss: 1.098, takeProfit: 1.102 });
    expect(draftFromDrawing(drawing("LONG", 1.101, 1.1, [1.103]), q)?.type).toBe("STOP");
    expect(draftFromDrawing(drawing("SHORT", 1.101, 1.102, [1.099]), q)).toMatchObject({ side: "SELL", type: "LIMIT" });
    expect(draftFromDrawing(drawing("SHORT", 1.099, 1.1, [1.097]), q)?.type).toBe("STOP");
    // At the market (within tolerance) → MARKET, no price.
    expect(draftFromDrawing(drawing("LONG", 1.1002, 1.099, [1.102]), q, 0.00005)).toMatchObject({ type: "MARKET", price: null });
  });

  it("ignores non-position drawings", () => {
    expect(draftFromDrawing({ ...drawing("LONG", 1, 0.9, [1.1]), type: "TREND" }, q)).toBeNull();
  });
});

describe("ticket → drawing", () => {
  it("moves entry/stop/TP1 and keeps further targets; ignores invalid input", () => {
    const p = { entry: 1.1, stop: 1.09, targets: [1.11, 1.12] };
    expect(positionFromTicket(p, { stopLoss: 1.095 })).toEqual({ entry: 1.1, stop: 1.095, targets: [1.11, 1.12] });
    expect(positionFromTicket(p, { price: 1.101, takeProfit: 1.115 })).toEqual({ entry: 1.101, stop: 1.09, targets: [1.115, 1.12] });
    expect(positionFromTicket(p, { stopLoss: NaN, takeProfit: -1 })).toEqual(p);
    // Same values → no change, so the sync can't loop.
    expect(samePosition(positionFromTicket(p, { price: 1.1 }), p)).toBe(true);
  });
});

describe("risk preview", () => {
  it("sizes by risk % from the contract value and floors to the quantity step", () => {
    // EURUSD: 100,000 per 1.0 move per lot. 20-pip stop, 1% of 10,000 = 100 → 0.5 lots.
    const r = riskPreview({ side: "BUY", entry: 1.1, stop: 1.098, targets: [1.104], valuePerPrice: 100_000, balance: 10_000, sizing: { mode: "RISK_PERCENT", riskPercent: 1 }, step: 0.01 });
    expect(r.issues).toEqual([]);
    expect(r.quantity).toBeCloseTo(0.5, 10);
    expect(r.riskAmount).toBeCloseTo(100, 6);
    expect(r.rr).toEqual([2]);
  });

  it("reports wrong-side stops and missing specs instead of guessing", () => {
    expect(riskPreview({ side: "SELL", entry: 1.1, stop: 1.09, targets: [1.08], valuePerPrice: 100_000, balance: 1e4, sizing: { mode: "QUANTITY", quantity: 1 } }).issues[0]).toMatch(/above the entry/);
    const noSpec = riskPreview({ side: "BUY", entry: 1.1, stop: 1.09, targets: [1.12], valuePerPrice: null, balance: 1e4, sizing: { mode: "RISK_AMOUNT", amount: 50 } });
    expect(noSpec.issues.join()).toMatch(/No contract specification/);
    expect(Number.isNaN(noSpec.quantity)).toBe(true);
    expect(riskPreview({ side: "BUY", entry: 1.1, stop: 1.0, targets: [1.2], valuePerPrice: 100_000, balance: 100, sizing: { mode: "RISK_PERCENT", riskPercent: 1 } }).issues.join()).toMatch(/smaller than one minimum/);
  });
});

describe("link status", () => {
  const live = { orderIds: new Set(["o1"]), positionIds: new Set(["p1"]) };
  it("distinguishes draft, linked, pending, open and executed", () => {
    expect(linkStatus(undefined, false, live)).toBe("draft");
    expect(linkStatus(undefined, true, live)).toBe("linked");
    expect(linkStatus({ orderId: "o1", positionId: null, side: "BUY", status: "PENDING", minute: 1 }, true, live)).toBe("pending");
    expect(linkStatus({ orderId: "o2", positionId: "p1", side: "BUY", status: "FILLED", minute: 1 }, false, live)).toBe("open");
    expect(linkStatus({ orderId: "o2", positionId: "p2", side: "BUY", status: "FILLED", minute: 1 }, false, live)).toBe("executed");
  });
});
