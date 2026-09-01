import { describe, expect, it } from "vitest";

import { tradovateAdapter } from "./tradovate";

const FILL_HEADERS = ["Timestamp", "B/S", "Contract", "Product", "avgPrice", "filledQty", "Commission"];
const FILL_ROWS: Record<string, string>[] = [
  { Timestamp: "2026-06-15 09:30:00", "B/S": "Buy", Contract: "MESM6", Product: "MES", avgPrice: "5000.25", filledQty: "1", Commission: "-1.24" },
  { Timestamp: "2026-06-15 09:45:00", "B/S": "Sell", Contract: "MESM6", Product: "MES", avgPrice: "5010.00", filledQty: "1", Commission: "-1.24" },
];

const PERF_HEADERS = ["Contract", "qty", "buyPrice", "sellPrice", "boughtTimestamp", "soldTimestamp", "pnl"];
const PERF_ROWS: Record<string, string>[] = [
  {
    Contract: "NQM6",
    qty: "1",
    buyPrice: "18000.00",
    sellPrice: "18050.00",
    boughtTimestamp: "2026-06-15 09:30:00",
    soldTimestamp: "2026-06-15 10:00:00",
    pnl: "1000.00",
  },
];

describe("tradovateAdapter", () => {
  it("detects a Tradovate fills export", () => {
    expect(tradovateAdapter.detect(FILL_HEADERS, [], "fills.csv")).toBeGreaterThan(0.6);
  });

  it("parses fills one execution per row", () => {
    const res = tradovateAdapter.parse(FILL_ROWS, FILL_HEADERS, { timezone: "UTC" });
    expect(res.executions).toHaveLength(2);
    expect(res.executions[0].direction).toBe("LONG");
    expect(res.executions[0].price).toBe("5000.25");
    expect(res.executions[1].direction).toBe("SHORT");
  });

  it("splits a Performance row into entry + exit executions in time order", () => {
    const res = tradovateAdapter.parse(PERF_ROWS, PERF_HEADERS, { timezone: "UTC" });
    expect(res.executions).toHaveLength(2);
    expect(res.executions[0].direction).toBe("LONG");
    expect(res.executions[0].price).toBe("18000");
    expect(res.executions[1].direction).toBe("SHORT");
    expect(res.executions[1].price).toBe("18050");
    expect(res.executions[1].grossPnl).toBe("1000");
  });
});
