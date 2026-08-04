import { describe, expect, it } from "vitest";

import {
  EMPTY_TRADE_FILTERS,
  filterTrades,
  hasActiveFilters,
  type FilterableTrade,
  type TradeFilters,
} from "@/domain/trades/filter";

const t = (over: Partial<FilterableTrade>): FilterableTrade => ({
  assetSymbol: "EURUSD",
  direction: "LONG",
  status: "CLOSED",
  actualRR: 1.5,
  strategyName: null,
  psychology: null,
  ...over,
});

const trades: FilterableTrade[] = [
  t({ assetSymbol: "EURUSD", direction: "LONG", status: "REVIEWED", actualRR: 2, strategyName: "Silver Bullet", psychology: { grade: "A" } }),
  t({ assetSymbol: "NAS100", direction: "SHORT", status: "CLOSED", actualRR: -1, strategyName: "Trend", psychology: { grade: "C" } }),
  t({ assetSymbol: "GBPUSD", direction: "LONG", status: "OPEN", actualRR: null, strategyName: null, psychology: null }),
];

const f = (over: Partial<TradeFilters>): TradeFilters => ({ ...EMPTY_TRADE_FILTERS, ...over });

describe("filterTrades", () => {
  it("returns all with empty filters", () => {
    expect(filterTrades(trades, EMPTY_TRADE_FILTERS)).toHaveLength(3);
  });

  it("filters by direction / status / asset", () => {
    expect(filterTrades(trades, f({ direction: "SHORT" })).map((x) => x.assetSymbol)).toEqual(["NAS100"]);
    expect(filterTrades(trades, f({ status: "OPEN" })).map((x) => x.assetSymbol)).toEqual(["GBPUSD"]);
    expect(filterTrades(trades, f({ asset: "EURUSD" }))).toHaveLength(1);
  });

  it("filters by result (R sign)", () => {
    expect(filterTrades(trades, f({ result: "WIN" })).map((x) => x.assetSymbol)).toEqual(["EURUSD"]);
    expect(filterTrades(trades, f({ result: "LOSS" })).map((x) => x.assetSymbol)).toEqual(["NAS100"]);
    expect(filterTrades(trades, f({ result: "OPEN" })).map((x) => x.assetSymbol)).toEqual(["GBPUSD"]);
  });

  it("filters by grade and strategy", () => {
    expect(filterTrades(trades, f({ grade: "A" })).map((x) => x.assetSymbol)).toEqual(["EURUSD"]);
    expect(filterTrades(trades, f({ strategy: "Trend" })).map((x) => x.assetSymbol)).toEqual(["NAS100"]);
  });

  it("searches asset + strategy, case-insensitive AND", () => {
    expect(filterTrades(trades, f({ search: "silver" })).map((x) => x.assetSymbol)).toEqual(["EURUSD"]);
    expect(filterTrades(trades, f({ search: "nas short" }))).toHaveLength(0); // search only spans asset+strategy text
    expect(filterTrades(trades, f({ search: "NAS trend" })).map((x) => x.assetSymbol)).toEqual(["NAS100"]);
  });

  it("combines filters with AND", () => {
    expect(filterTrades(trades, f({ direction: "LONG", result: "WIN" })).map((x) => x.assetSymbol)).toEqual(["EURUSD"]);
    expect(filterTrades(trades, f({ direction: "LONG", grade: "C" }))).toHaveLength(0);
  });
});

describe("hasActiveFilters", () => {
  it("is false for empty, true when any is set", () => {
    expect(hasActiveFilters(EMPTY_TRADE_FILTERS)).toBe(false);
    expect(hasActiveFilters(f({ direction: "LONG" }))).toBe(true);
    expect(hasActiveFilters(f({ search: "  " }))).toBe(false);
    expect(hasActiveFilters(f({ search: "x" }))).toBe(true);
  });
});
