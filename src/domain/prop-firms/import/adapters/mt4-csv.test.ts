import { describe, expect, it } from "vitest";

import { mt4CsvAdapter } from "./mt4-csv";

const HEADERS = ["Ticket", "Open Time", "Type", "Size", "Item", "Open Price", "Close Time", "Close Price", "Commission", "Swap", "Profit"];

const ROWS: Record<string, string>[] = [
  {
    Ticket: "1001",
    "Open Time": "2026.06.15 09:00:00",
    Type: "buy",
    Size: "0.10",
    Item: "EURUSD",
    "Open Price": "1.10500",
    "Close Time": "2026.06.15 12:00:00",
    "Close Price": "1.10800",
    Commission: "-1.00",
    Swap: "0.00",
    Profit: "30.00",
  },
  {
    Ticket: "1002",
    "Open Time": "2026.06.16 09:00:00",
    Type: "sell",
    Size: "0.20",
    Item: "GBPUSD",
    "Open Price": "1.25000",
    "Close Time": "",
    "Close Price": "",
    Commission: "",
    Swap: "",
    Profit: "",
  },
  {
    Ticket: "1003",
    "Open Time": "2026.06.16 10:00:00",
    Type: "balance",
    Size: "0.00",
    Item: "",
    "Open Price": "0.00",
    "Close Time": "",
    "Close Price": "",
    Commission: "",
    Swap: "",
    Profit: "500.00",
  },
];

describe("mt4CsvAdapter", () => {
  it("detects a matching header shape with high confidence", () => {
    expect(mt4CsvAdapter.detect(HEADERS, [], "statement.csv")).toBeGreaterThan(0.6);
  });

  it("scores an unrelated header shape at zero", () => {
    expect(mt4CsvAdapter.detect(["A", "B", "C"], [], "x.csv")).toBe(0);
  });

  it("splits a closed round-trip row into an entry and an exit execution", () => {
    const result = mt4CsvAdapter.parse([ROWS[0]], HEADERS, { timezone: "UTC" });
    expect(result.executions).toHaveLength(2);
    const [entry, exit] = result.executions;
    expect(entry.direction).toBe("LONG");
    expect(entry.price).toBe("1.105");
    expect(exit.direction).toBe("SHORT");
    expect(exit.price).toBe("1.108");
    expect(exit.grossPnl).toBe("30");
    expect(exit.commission).toBe("-1");
    expect(entry.platformExecutionId).toBe("1001:open");
    expect(exit.platformExecutionId).toBe("1001:close");
  });

  it("emits only an entry execution for a still-open position, with a warning", () => {
    const result = mt4CsvAdapter.parse([ROWS[1]], HEADERS, { timezone: "UTC" });
    expect(result.executions).toHaveLength(1);
    expect(result.executions[0].direction).toBe("SHORT");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("routes a balance row to transactions, not executions", () => {
    const result = mt4CsvAdapter.parse([ROWS[2]], HEADERS, { timezone: "UTC" });
    expect(result.executions).toHaveLength(0);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount).toBe("500");
  });

  it("parses a full mixed statement in one pass", () => {
    const result = mt4CsvAdapter.parse(ROWS, HEADERS, { timezone: "UTC" });
    expect(result.executions).toHaveLength(3); // 2 (closed) + 1 (still-open)
    expect(result.transactions).toHaveLength(1);
    expect(result.rejections).toHaveLength(0);
  });
});
