import { describe, expect, it } from "vitest";

import { buildBestGuessMapping, genericCsvAdapter } from "./generic-csv";

const HEADERS = ["Date", "Symbol", "Side", "Volume", "Price", "P/L", "Commission"];

const ROWS: Record<string, string>[] = [
  { Date: "2026-06-15 14:30:00", Symbol: "EURUSD", Side: "buy", Volume: "1.0", Price: "1.1050", "P/L": "", Commission: "" },
  { Date: "2026-06-15 15:00:00", Symbol: "EURUSD", Side: "sell", Volume: "1.0", Price: "1.1080", "P/L": "30.00", Commission: "-2.00" },
];

const MAPPING = {
  executedAt: "Date",
  instrument: "Symbol",
  direction: "Side",
  quantity: "Volume",
  price: "Price",
  grossPnl: "P/L",
  commission: "Commission",
};

describe("genericCsvAdapter", () => {
  it("is always the lowest-confidence match", () => {
    expect(genericCsvAdapter.detect(HEADERS, [], "file.csv")).toBeLessThan(0.5);
  });

  it("parses rows using a supplied column mapping", () => {
    const result = genericCsvAdapter.parse(ROWS, HEADERS, { mapping: MAPPING, timezone: "UTC" });
    expect(result.rejections).toHaveLength(0);
    expect(result.executions).toHaveLength(2);
    expect(result.executions[0].direction).toBe("LONG");
    expect(result.executions[0].instrumentNormalized).toBe("EURUSD");
    expect(result.executions[1].grossPnl).toBe("30");
    expect(result.executions[1].commission).toBe("-2");
  });

  it("rejects a row missing a required mapped field", () => {
    const rows = [{ Date: "2026-06-15 14:30:00", Symbol: "", Side: "buy", Volume: "1.0", Price: "1.1050", "P/L": "", Commission: "" }];
    const result = genericCsvAdapter.parse(rows, HEADERS, { mapping: MAPPING, timezone: "UTC" });
    expect(result.executions).toHaveLength(0);
    expect(result.rejections).toHaveLength(1);
  });

  it("routes an unmapped/unrecognized direction to a rejection rather than guessing", () => {
    const rows = [{ Date: "2026-06-15 14:30:00", Symbol: "EURUSD", Side: "weird", Volume: "1.0", Price: "1.1050", "P/L": "", Commission: "" }];
    const result = genericCsvAdapter.parse(rows, HEADERS, { mapping: MAPPING, timezone: "UTC" });
    expect(result.executions).toHaveLength(0);
  });
});

describe("buildBestGuessMapping", () => {
  it("guesses common header names", () => {
    const mapping = buildBestGuessMapping(["Symbol", "Volume", "Price", "Profit", "Time"]);
    expect(mapping.instrument).toBe("Symbol");
    expect(mapping.quantity).toBe("Volume");
    expect(mapping.price).toBe("Price");
    expect(mapping.grossPnl).toBe("Profit");
  });

  it("leaves unmatched fields undefined", () => {
    const mapping = buildBestGuessMapping(["Foo", "Bar"]);
    expect(mapping.instrument).toBeUndefined();
  });
});
