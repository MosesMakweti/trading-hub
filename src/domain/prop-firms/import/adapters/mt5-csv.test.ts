import { describe, expect, it } from "vitest";

import { mt5CsvAdapter } from "./mt5-csv";

const HEADERS = ["Time", "Deal", "Symbol", "Type", "Volume", "Price", "Order", "Commission", "Fee", "Swap", "Profit"];

const ROWS: Record<string, string>[] = [
  {
    Time: "2026.06.15 09:00:00",
    Deal: "5001",
    Symbol: "EURUSD",
    Type: "buy",
    Volume: "0.10",
    Price: "1.10500",
    Order: "7001",
    Commission: "-0.50",
    Fee: "0.00",
    Swap: "0.00",
    Profit: "0.00",
  },
  {
    Time: "2026.06.15 12:00:00",
    Deal: "5002",
    Symbol: "EURUSD",
    Type: "sell",
    Volume: "0.10",
    Price: "1.10800",
    Order: "7002",
    Commission: "-0.50",
    Fee: "0.00",
    Swap: "-0.10",
    Profit: "30.00",
  },
  {
    Time: "2026.06.16 08:00:00",
    Deal: "5003",
    Symbol: "",
    Type: "balance",
    Volume: "0.00",
    Price: "0.00",
    Order: "",
    Commission: "",
    Fee: "",
    Swap: "",
    Profit: "1000.00",
  },
];

describe("mt5CsvAdapter", () => {
  it("detects a matching header shape with high confidence", () => {
    expect(mt5CsvAdapter.detect(HEADERS, [], "deals.csv")).toBeGreaterThan(0.6);
  });

  it("parses each deal row as its own execution (no splitting needed)", () => {
    const result = mt5CsvAdapter.parse(ROWS.slice(0, 2), HEADERS, { timezone: "UTC" });
    expect(result.executions).toHaveLength(2);
    expect(result.executions[0].direction).toBe("LONG");
    expect(result.executions[0].platformDealId).toBe("5001");
    expect(result.executions[1].direction).toBe("SHORT");
    expect(result.executions[1].grossPnl).toBe("30");
    expect(result.executions[1].swap).toBe("-0.1");
  });

  it("routes a balance deal to transactions", () => {
    const result = mt5CsvAdapter.parse([ROWS[2]], HEADERS, { timezone: "UTC" });
    expect(result.executions).toHaveLength(0);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].platformTransactionId).toBe("5003");
    expect(result.transactions[0].amount).toBe("1000");
  });

  it("feeds cleanly into the shared reconstruction engine downstream", () => {
    const result = mt5CsvAdapter.parse(ROWS.slice(0, 2), HEADERS, { timezone: "UTC" });
    expect(result.executions.every((e) => e.instrumentNormalized === "EURUSD")).toBe(true);
  });
});
