import { describe, expect, it } from "vitest";

import { toExportRow, tradeNaturalKey, type TradeExportRecord } from "./trade-export";

const RECORD: TradeExportRecord = {
  dateKey: "2026-07-05",
  assetSymbol: "XAUUSD",
  executionMinutes: 570,
  direction: "LONG",
  higherTimeframeBias: "BULLISH",
  biasConfidencePercent: 60,
  expectedRR: 2,
  actualRR: 2.5,
  performanceClosingPnlGross: 2500,
  performanceClosingPnlNet: 2450,
  psychPreTradeMindset: null,
  psychPostTradeReflection: null,
  psychLessonsLearned: null,
  psychWhatToWorkOn: null,
  psychologyAnswers: {},
  sessionName: "London",
  allocations: [],
  confluenceLabels: [],
  executionLabels: [],
  entryModelNames: [],
};

describe("toExportRow", () => {
  it("flattens a trade record into a human-readable row", () => {
    const row = toExportRow(RECORD, "B");
    expect(row.Date).toBe("2026-07-05");
    expect(row.Time).toBe("09:30");
    expect(row.Asset).toBe("XAUUSD");
    expect(row.Direction).toBe("Long");
    expect(row["Actual RR"]).toBe("2.5");
    expect(row["Performance PnL (Net)"]).toBe(2450);
    expect(row["Psychology Grade"]).toBe("B");
  });

  it("renders a blank Actual RR for still-open trades", () => {
    const row = toExportRow({ ...RECORD, actualRR: null }, null);
    expect(row["Actual RR"]).toBe("");
    expect(row["Psychology Grade"]).toBe("");
  });
});

describe("tradeNaturalKey", () => {
  it("combines date, asset, and execution time into a stable key", () => {
    expect(tradeNaturalKey(RECORD)).toBe("2026-07-05|XAUUSD|570");
  });

  it("produces different keys for different trades", () => {
    expect(tradeNaturalKey(RECORD)).not.toBe(
      tradeNaturalKey({ ...RECORD, executionMinutes: 600 }),
    );
  });
});
