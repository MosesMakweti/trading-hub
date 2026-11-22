import { describe, expect, it } from "vitest";

import { dec } from "@/domain/execution/precision";
import { exitOnBar, marketFillPrice, pendingFill, pendingPriceError, protectiveLevelError, type SimBar } from "./market";
import { commissionFor, grossPnl, pointsToPrice, priceToPoints, resolveConversion, rMultiple, swapFor } from "./money";
import { planLedgerEntries, replaySimLedger, SimLedgerCorruptError } from "./ledger";
import { runStep, tradingDayOf, type EngineOrder, type EnginePosition } from "./engine";
import { labRules, parseRules } from "./rules";

const bar = (minute: number, open: number, high: number, low: number, close: number, spread = 0): SimBar => ({ minute, open, high, low, close, spread });

describe("market mechanics (integer points, bid bars)", () => {
  it("buys fill at the ask (bid + spread), sells at the bid", () => {
    const b = bar(0, 108000, 108020, 107990, 108010, 12);
    expect(marketFillPrice("BUY", b, 12)).toBe(108022);
    expect(marketFillPrice("SELL", b, 12)).toBe(108010);
  });

  it("pending orders trigger on the right side of the spread, and gap fills at the open", () => {
    const b = bar(0, 108000, 108020, 107990, 108010, 10);
    // BUY LIMIT at 108000: ask low = 108000 → fills at the limit.
    expect(pendingFill({ side: "BUY", type: "LIMIT", price: 108000 }, b, 10)).toEqual({ price: 108000, gapped: false });
    // BUY LIMIT at 107995: ask low = 108000 > 107995 → no fill (the bid touched it, the ask didn't).
    expect(pendingFill({ side: "BUY", type: "LIMIT", price: 107995 }, b, 10)).toBeNull();
    // SELL STOP at 108005, bar opens at 108000 (already below) → gap fill at the open.
    expect(pendingFill({ side: "SELL", type: "STOP", price: 108005 }, b, 10)).toEqual({ price: 108000, gapped: true });
    // BUY STOP at 108025: ask high = 108030 ≥ 108025 → fills at the stop.
    expect(pendingFill({ side: "BUY", type: "STOP", price: 108025 }, b, 10)).toEqual({ price: 108025, gapped: false });
    // SELL LIMIT at 108021: bid high 108020 → no fill.
    expect(pendingFill({ side: "SELL", type: "LIMIT", price: 108021 }, b, 10)).toBeNull();
  });

  it("stop and target on the same bar: the stop fills and the exit is flagged ambiguous", () => {
    const b = bar(0, 108000, 108050, 107950, 108000);
    expect(exitOnBar({ side: "BUY", stopLoss: 107960, takeProfit: 108040 }, b, 0)).toEqual({ reason: "STOP_LOSS", price: 107960, gapped: false, ambiguous: true });
  });

  it("a short closes at the ask: its stop is hit by bid + spread", () => {
    const b = bar(0, 108000, 108015, 107990, 108000, 10);
    // ask high = 108025 ≥ stop 108020 → stopped, at the stop price.
    expect(exitOnBar({ side: "SELL", stopLoss: 108020, takeProfit: null }, b, 10)).toEqual({ reason: "STOP_LOSS", price: 108020, gapped: false, ambiguous: false });
  });

  it("a bar opening through the stop fills at the open (slippage); through the target at the open (improvement)", () => {
    expect(exitOnBar({ side: "BUY", stopLoss: 108000, takeProfit: null }, bar(0, 107900, 107950, 107880, 107920), 0)).toEqual({
      reason: "STOP_LOSS",
      price: 107900,
      gapped: true,
      ambiguous: false,
    });
    expect(exitOnBar({ side: "BUY", stopLoss: null, takeProfit: 108100 }, bar(0, 108150, 108200, 108140, 108160), 0)).toEqual({
      reason: "TAKE_PROFIT",
      price: 108150,
      gapped: true,
      ambiguous: false,
    });
  });

  it("validates protective levels and pending prices", () => {
    expect(protectiveLevelError("BUY", 108000, 108010, null)).toMatch(/below/);
    expect(protectiveLevelError("SELL", 108000, 108010, 107900)).toBeNull();
    expect(pendingPriceError("BUY", "LIMIT", 108030, 108000, 108020)).toMatch(/below the current ask/);
    expect(pendingPriceError("SELL", "STOP", 107990, 108000, 108020)).toBeNull();
  });
});

describe("money", () => {
  it("prices round-trip exactly through points; extra decimals are refused", () => {
    expect(pointsToPrice(108345, 5).toFixed()).toBe("1.08345");
    expect(priceToPoints("1.08345", 5)).toBe(108345);
    expect(priceToPoints("1.083455", 5)).toBeNull();
    expect(priceToPoints("2357.4", 2)).toBe(235740);
  });

  it("EURUSD 1 lot, +20 pips = $200; commission $3.50/side on 2.5 lots = −$8.75", () => {
    const pnl = grossPnl({ side: "BUY", entry: dec("1.08000"), exit: dec("1.08200"), quantity: "1", valuePerPriceUnit: "100000" });
    expect(pnl.toFixed(2)).toBe("200.00");
    expect(grossPnl({ side: "SELL", entry: dec("1.08000"), exit: dec("1.08200"), quantity: "0.5", valuePerPriceUnit: "100000" }).toFixed(2)).toBe("-100.00");
    expect(commissionFor("2.5", "3.5").toFixed(2)).toBe("-8.75");
    expect(commissionFor("1", "0").isZero()).toBe(true);
    expect(swapFor("2", "-4.1").toFixed(2)).toBe("-8.20");
  });

  it("R is realized PnL over the frozen intended risk", () => {
    expect(rMultiple("-996", "1000")!.toFixed(3)).toBe("-0.996");
    expect(rMultiple("100", null)).toBeNull();
  });

  it("converts with replay prices only — never 1:1 by default", () => {
    const prices: Record<string, string> = { USDJPY: "150", GBPUSD: "1.25" };
    const priceOf = (s: string) => (prices[s] ? dec(prices[s]) : null);
    expect(resolveConversion({ symbol: "EURUSD", quoteCurrency: "USD", accountCurrency: "USD", priceOf })).toMatchObject({ status: "OK", via: null });
    const jpy = resolveConversion({ symbol: "USDJPY", quoteCurrency: "JPY", accountCurrency: "USD", priceOf });
    expect(jpy.status === "OK" && jpy.rate.times(150).toFixed(10)).toBe("1.0000000000");
    const gbp = resolveConversion({ symbol: "EURGBP", quoteCurrency: "GBP", accountCurrency: "USD", priceOf });
    expect(gbp).toMatchObject({ status: "OK", via: "GBPUSD" });
    expect(resolveConversion({ symbol: "EURCHF", quoteCurrency: "CHF", accountCurrency: "USD", priceOf }).status).toBe("CONVERSION_REQUIRED");
  });
});

describe("ledger", () => {
  it("the balance is the sum of entries; running balances are verified", () => {
    const planned = planLedgerEntries({ balance: 0, sequence: 0 }, [
      { type: "INITIAL_BALANCE", amount: "25000", idempotencyKey: "init" },
      { type: "REALIZED_PNL", amount: "200", idempotencyKey: "close:p1" },
      { type: "COMMISSION", amount: "0", idempotencyKey: "skip-zero" },
      { type: "COMMISSION", amount: "-7", idempotencyKey: "c:p1" },
    ]);
    expect(planned.map((p) => [p.sequence, p.balanceAfter.toFixed(2)])).toEqual([
      [1, "25000.00"],
      [2, "25200.00"],
      [3, "25193.00"],
    ]);
    const summary = replaySimLedger(planned);
    expect(summary.balance.toFixed(2)).toBe("25193.00");
    expect(summary.realizedPnl.toFixed(2)).toBe("200.00");
    expect(summary.commissions.toFixed(2)).toBe("-7.00");
  });

  it("a drifted running balance or a gap in sequence is reported as corruption", () => {
    expect(() =>
      replaySimLedger([
        { sequence: 1, type: "INITIAL_BALANCE", amount: "100", balanceAfter: "100" },
        { sequence: 2, type: "REALIZED_PNL", amount: "10", balanceAfter: "111" },
      ]),
    ).toThrow(SimLedgerCorruptError);
    expect(() =>
      replaySimLedger([
        { sequence: 1, type: "INITIAL_BALANCE", amount: "100", balanceAfter: "100" },
        { sequence: 3, type: "REALIZED_PNL", amount: "10", balanceAfter: "110" },
      ]),
    ).toThrow(/sequence 2/);
  });
});

describe("rules", () => {
  it("a lab rule set has costs only; stored snapshots are validated", () => {
    const r = labRules({ costs: { commissionPerUnitPerSide: 3.5 } });
    expect(r.costs.commissionPerUnitPerSide).toBe(3.5);
    expect(r.maxLoss).toBeNull();
    expect(r.objective.profitTargetPercent).toBeNull();
    expect(() => parseRules({ schemaVersion: 2 })).toThrow();
    expect(parseRules({ maxLoss: { limitPercent: 10 } }).maxLoss).toEqual({ limitPercent: 10, model: "STATIC", basis: "EQUITY", trailingLockAtStart: false });
  });
});

describe("step engine", () => {
  const costs = { commissionPerUnitPerSide: "3.5", defaultSpreadPoints: 0, swapLongPerUnit: "-5", swapShortPerUnit: "1" };
  // Broker minutes: day 0 starts at 0. 1439 = 23:59 day 0, 1440 = 00:00 day 1.
  const eurusd = (rows: SimBar[]) => new Map([["EURUSD", new Map(rows.map((r) => [r.minute, r]))]]);

  it("fills a limit, stops it out, books commissions on both sides and computes equity", () => {
    const order: EngineOrder = {
      id: "o1", symbol: "EURUSD", side: "BUY", type: "LIMIT", pricePoints: 108000, quantity: "1",
      stopLoss: 107900, takeProfit: 108300, valuePerPriceUnit: "100000", priceScale: 5, expiresMinute: null,
    };
    const rows = [bar(601, 108050, 108060, 108020, 108040), bar(602, 108030, 108035, 107995, 108010), bar(603, 108000, 108005, 107880, 107890)];
    const snapshots: string[] = [];
    const result = runStep({
      fromMinute: 600, timeline: [601, 602, 603], bars: eurusd(rows), positions: [], orders: [order], balance: "10000",
      costs, dailyResetHour: 0, newPositionId: () => "p1",
      onMinute: (s) => void snapshots.push(`${s.minute}:${s.balance.toFixed(2)}/${s.equity.toFixed(2)}/${s.adverseEquity.toFixed(2)}`),
    });
    expect(result.events.map((e) => e.kind)).toEqual(["ORDER_FILLED", "POSITION_CLOSED"]);
    expect(result.events[0]).toMatchObject({ minute: 602, price: 108000 });
    expect(result.events[1]).toMatchObject({ minute: 603, reason: "STOP_LOSS", price: 107900 });
    // −10 pips × 1 lot = −$100; commission 2 × −$3.50.
    expect(result.balance.toFixed(2)).toBe("9893.00");
    expect(result.ledger.map((l) => [l.type, l.amount.toFixed(2), l.idempotencyKey])).toEqual([
      ["COMMISSION", "-3.50", "commission-open:p1"],
      ["REALIZED_PNL", "-100.00", "close:p1"],
      ["COMMISSION", "-3.50", "commission-close:p1"],
    ]);
    // 602: open at 1.08000, mark 1.08010 → +$10; the fill bar's adverse is bounded at the mark.
    expect(snapshots).toEqual(["601:10000.00/10000.00/10000.00", "602:9996.50/10006.50/10006.50", "603:9893.00/9893.00/9893.00"]);
    expect(result.positions).toEqual([]);
  });

  it("books swaps at the daily rollover and reports it", () => {
    const pos: EnginePosition = {
      id: "p9", symbol: "EURUSD", side: "BUY", quantity: "2", entryPoints: 108000, stopLoss: null, takeProfit: null,
      valuePerPriceUnit: "100000", priceScale: 5, openedMinute: 1300,
    };
    const result = runStep({
      fromMinute: 1438, timeline: [1439, 1440], bars: eurusd([bar(1439, 108000, 108000, 108000, 108000), bar(1440, 108000, 108000, 108000, 108000)]),
      positions: [pos], orders: [], balance: "10000", costs, dailyResetHour: 0, newPositionId: () => "x",
    });
    expect(tradingDayOf(1439, 0)).toBe(0);
    expect(tradingDayOf(1440, 0)).toBe(1);
    expect(result.events).toEqual([{ kind: "DAY_ROLLOVER", minute: 1440, fromDay: 0, toDay: 1 }]);
    expect(result.ledger.map((l) => [l.type, l.amount.toFixed(2), l.idempotencyKey])).toEqual([["SWAP", "-10.00", "swap:p9:1"]]);
  });

  it("a reset hour moves the day boundary (17:00 server = 1020 minutes)", () => {
    expect(tradingDayOf(1019, 17)).toBe(-1);
    expect(tradingDayOf(1020, 17)).toBe(0);
  });

  it("HALT stops the step at that minute; later bars are not processed", () => {
    const pos: EnginePosition = {
      id: "p1", symbol: "EURUSD", side: "BUY", quantity: "1", entryPoints: 108000, stopLoss: 107000, takeProfit: null,
      valuePerPriceUnit: "100000", priceScale: 5, openedMinute: 0,
    };
    const result = runStep({
      fromMinute: 10, timeline: [11, 12, 13], positions: [pos], orders: [], balance: "10000", costs, dailyResetHour: 0, newPositionId: () => "x",
      bars: eurusd([bar(11, 108000, 108000, 107950, 107960), bar(12, 107960, 107960, 107500, 107600), bar(13, 107600, 107600, 106000, 106100)]),
      onMinute: (s) => (s.adverseEquity.lessThan(9600) ? "HALT" : undefined),
    });
    expect(result.halted).toBe(true);
    expect(result.endMinute).toBe(12);
    expect(result.positions).toHaveLength(1); // the 13:00 stop-out never happened
  });

  it("expires a pending order after its expiry minute", () => {
    const order: EngineOrder = {
      id: "o2", symbol: "EURUSD", side: "SELL", type: "LIMIT", pricePoints: 109000, quantity: "1", stopLoss: null, takeProfit: null,
      valuePerPriceUnit: "100000", priceScale: 5, expiresMinute: 2,
    };
    const result = runStep({
      fromMinute: 0, timeline: [1, 2, 3], bars: eurusd([bar(1, 108000, 108010, 107990, 108000), bar(2, 108000, 108010, 107990, 108000), bar(3, 108000, 109500, 107990, 108000)]),
      positions: [], orders: [order], balance: "10000", costs, dailyResetHour: 0, newPositionId: () => "x",
    });
    expect(result.events).toEqual([{ kind: "ORDER_EXPIRED", minute: 2, orderId: "o2" }]);
    expect(result.orders).toEqual([]);
  });
});
