import { describe, expect, it } from "vitest";

import { ninjatraderAdapter } from "./ninjatrader";

const TRADE_HEADERS = [
  "Trade number",
  "Instrument",
  "Market pos.",
  "Qty",
  "Entry price",
  "Exit price",
  "Entry time",
  "Exit time",
  "Profit",
  "Commission",
];

const TRADE_ROWS: Record<string, string>[] = [
  {
    "Trade number": "7",
    Instrument: "MES 06-26",
    "Market pos.": "Long",
    Qty: "2",
    "Entry price": "5000.25",
    "Exit price": "5010.75",
    "Entry time": "2026-06-15 09:30:00",
    "Exit time": "2026-06-15 10:15:00",
    Profit: "105.00",
    Commission: "-4.00",
  },
];

const EXEC_HEADERS = ["Instrument", "Action", "Qty", "Price", "Time", "Commission"];
const EXEC_ROWS: Record<string, string>[] = [
  { Instrument: "NQ 06-26", Action: "Buy", Qty: "1", Price: "18000.50", Time: "2026-06-15 09:30:00", Commission: "-2.00" },
  { Instrument: "NQ 06-26", Action: "Sell", Qty: "1", Price: "18050.00", Time: "2026-06-15 09:45:00", Commission: "-2.00" },
];

describe("ninjatraderAdapter", () => {
  it("detects a NinjaTrader Trades grid", () => {
    expect(ninjatraderAdapter.detect(TRADE_HEADERS, [], "trades.csv")).toBeGreaterThan(0.6);
  });

  it("splits a completed Trade into entry + exit executions", () => {
    const res = ninjatraderAdapter.parse(TRADE_ROWS, TRADE_HEADERS, { timezone: "UTC" });
    expect(res.executions).toHaveLength(2);
    expect(res.executions[0].direction).toBe("LONG");
    expect(res.executions[0].platformExecutionId).toBe("7:open");
    expect(res.executions[1].direction).toBe("SHORT");
    expect(res.executions[1].price).toBe("5010.75");
    expect(res.executions[1].grossPnl).toBe("105");
  });

  it("parses an Executions grid one fill per row", () => {
    const res = ninjatraderAdapter.parse(EXEC_ROWS, EXEC_HEADERS, { timezone: "UTC" });
    expect(res.executions).toHaveLength(2);
    expect(res.executions[0].direction).toBe("LONG");
    expect(res.executions[1].direction).toBe("SHORT");
    expect(res.executions[0].instrumentNormalized).toBe("NQ 06-26");
  });
});
