import { describe, expect, it } from "vitest";

import { ctraderAdapter } from "./ctrader";

const POSITION_HEADERS = [
  "Position ID",
  "Symbol",
  "Direction",
  "Volume (lots)",
  "Entry price",
  "Closing price",
  "Opening time",
  "Closing time",
  "Commission",
  "Swap",
  "Net USD",
];

const POSITION_ROWS: Record<string, string>[] = [
  {
    "Position ID": "P-100",
    Symbol: "EURUSD",
    Direction: "Buy",
    "Volume (lots)": "1.00",
    "Entry price": "1.10500",
    "Closing price": "1.10800",
    "Opening time": "2026-06-15 09:00:00",
    "Closing time": "2026-06-15 12:00:00",
    Commission: "-2.00",
    Swap: "-0.10",
    "Net USD": "27.90",
  },
];

const DEAL_HEADERS = ["Deal ID", "Symbol", "Direction", "Volume", "Price", "Time", "Commission", "Swap", "Net USD"];
const DEAL_ROWS: Record<string, string>[] = [
  { "Deal ID": "D-1", Symbol: "GBPUSD", Direction: "Sell", Volume: "2", Price: "1.27000", Time: "2026-06-15 10:00:00", Commission: "-1.00", Swap: "0", "Net USD": "" },
  { "Deal ID": "D-2", Symbol: "", Direction: "Deposit", Volume: "", Price: "", Time: "2026-06-16 00:00:00", Commission: "", Swap: "", "Net USD": "1000" },
];

describe("ctraderAdapter", () => {
  it("detects a cTrader Positions export", () => {
    expect(ctraderAdapter.detect(POSITION_HEADERS, [], "positions.csv")).toBeGreaterThan(0.6);
  });

  it("splits a Positions row into entry + exit executions with the shared ticket id", () => {
    const res = ctraderAdapter.parse(POSITION_ROWS, POSITION_HEADERS, { timezone: "UTC" });
    expect(res.executions).toHaveLength(2);
    expect(res.executions[0].platformExecutionId).toBe("P-100:open");
    expect(res.executions[0].direction).toBe("LONG");
    expect(res.executions[1].platformExecutionId).toBe("P-100:close");
    expect(res.executions[1].direction).toBe("SHORT");
    expect(res.executions[1].grossPnl).toBe("27.9");
    expect(res.executions[1].commission).toBe("-2");
  });

  it("parses a Deals export one fill per row and routes a Deposit to transactions", () => {
    const res = ctraderAdapter.parse(DEAL_ROWS, DEAL_HEADERS, { timezone: "UTC" });
    expect(res.executions).toHaveLength(1);
    expect(res.executions[0].platformDealId).toBe("D-1");
    expect(res.executions[0].direction).toBe("SHORT");
    expect(res.transactions).toHaveLength(1);
    expect(res.transactions[0].amount).toBe("1000");
  });
});
