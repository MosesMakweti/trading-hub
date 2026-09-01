import { describe, expect, it } from "vitest";

import {
  buildAccountBalanceSeries,
  downsampleBalancePoints,
  sliceBalanceSeriesToRange,
  summariseAccountBalance,
  type RawBalanceEvent,
} from "./balance-curve";

const START = 100_000;

function ev(partial: Partial<RawBalanceEvent> & { amount: number | string; occurredAt: string }): RawBalanceEvent {
  return {
    id: partial.id ?? `${partial.occurredAt}-${partial.amount}`,
    eventType: partial.eventType ?? "TRADE_PNL",
    amount: partial.amount,
    occurredAt: partial.occurredAt,
    sourceType: partial.sourceType ?? null,
    sourceId: partial.sourceId ?? null,
    reason: partial.reason ?? null,
    reference: partial.reference ?? null,
  };
}

const opening = (at: string, amount = START): RawBalanceEvent =>
  ev({ id: "open", eventType: "ACCOUNT_INITIALIZED", amount, occurredAt: at, sourceType: "ACCOUNT_INIT", sourceId: "acc" });

describe("buildAccountBalanceSeries — progressive balance", () => {
  it("moves up on a win and down on a loss, from the starting balance", () => {
    const { points, currentBalance } = buildAccountBalanceSeries(
      [
        opening("2026-06-01T00:00:00.000Z"),
        ev({ amount: 500, occurredAt: "2026-06-02T00:00:00.000Z" }),
        ev({ amount: -1200, occurredAt: "2026-06-03T00:00:00.000Z" }),
      ],
      START,
    );
    expect(points.map((p) => p.balance)).toEqual([100_000, 100_500, 99_300]);
    expect(points.map((p) => p.change)).toEqual([100_000, 500, -1200]);
    expect(currentBalance).toBe(99_300);
  });

  it("re-derives balance from startingBalance even when the opening entry is dated AFTER back-dated trades", () => {
    // The bug this fixes: ACCOUNT_INITIALIZED written at import time, trades months earlier.
    const { points } = buildAccountBalanceSeries(
      [
        ev({ amount: 500, occurredAt: "2026-03-02T00:00:00.000Z" }),
        ev({ amount: -300, occurredAt: "2026-03-05T00:00:00.000Z" }),
        opening("2026-06-01T00:00:00.000Z"),
      ],
      START,
    );
    // Anchor sits at the earliest real activity, not the late opening entry.
    expect(points[0].timestamp).toBe("2026-03-02T00:00:00.000Z");
    expect(points.map((p) => p.balance)).toEqual([100_000, 100_500, 100_200]);
  });

  it("subtracts fees and commissions", () => {
    const { currentBalance } = buildAccountBalanceSeries(
      [
        opening("2026-06-01T00:00:00.000Z"),
        ev({ amount: 1000, occurredAt: "2026-06-02T00:00:00.000Z", eventType: "TRADE_PNL" }),
        ev({ amount: -40, occurredAt: "2026-06-02T01:00:00.000Z", eventType: "COMMISSION_FEE" }),
        ev({ amount: -12.5, occurredAt: "2026-06-02T02:00:00.000Z", eventType: "RESET_FEE" }),
      ],
      START,
    );
    expect(currentBalance).toBe(100_947.5);
  });

  it("adds deposits and subtracts withdrawals / payouts", () => {
    const { currentBalance } = buildAccountBalanceSeries(
      [
        opening("2026-06-01T00:00:00.000Z"),
        ev({ amount: 5000, occurredAt: "2026-06-02T00:00:00.000Z", eventType: "DEPOSIT" }),
        ev({ amount: -2000, occurredAt: "2026-06-03T00:00:00.000Z", eventType: "WITHDRAWAL" }),
        ev({ amount: -1500, occurredAt: "2026-06-04T00:00:00.000Z", eventType: "PAYOUT" }),
      ],
      START,
    );
    expect(currentBalance).toBe(101_500);
  });

  it("orders equal-timestamp events deterministically by original order then id", () => {
    const a = buildAccountBalanceSeries(
      [
        opening("2026-06-01T00:00:00.000Z"),
        ev({ id: "z", amount: 100, occurredAt: "2026-06-02T00:00:00.000Z" }),
        ev({ id: "a", amount: -30, occurredAt: "2026-06-02T00:00:00.000Z" }),
      ],
      START,
    );
    const b = buildAccountBalanceSeries(
      [
        opening("2026-06-01T00:00:00.000Z"),
        ev({ id: "z", amount: 100, occurredAt: "2026-06-02T00:00:00.000Z" }),
        ev({ id: "a", amount: -30, occurredAt: "2026-06-02T00:00:00.000Z" }),
      ],
      START,
    );
    expect(a.points.map((p) => p.balance)).toEqual([100_000, 100_100, 100_070]);
    expect(b.points).toEqual(a.points);
  });

  it("does not create duplicate points for a re-imported transaction (same source key)", () => {
    const dupA = ev({ id: "row1", amount: 750, occurredAt: "2026-06-02T00:00:00.000Z", sourceType: "TRADE_EXECUTION", sourceId: "t1" });
    const dupB = ev({ id: "row2", amount: 750, occurredAt: "2026-06-02T00:00:00.000Z", sourceType: "TRADE_EXECUTION", sourceId: "t1" });
    const { points, currentBalance } = buildAccountBalanceSeries([opening("2026-06-01T00:00:00.000Z"), dupA, dupB], START);
    expect(points).toHaveLength(2);
    expect(currentBalance).toBe(100_750);
  });

  it("collapses exact value-twin rows that carry no source key", () => {
    const { points } = buildAccountBalanceSeries(
      [
        opening("2026-06-01T00:00:00.000Z"),
        ev({ id: "x1", amount: -25, occurredAt: "2026-06-02T00:00:00.000Z", eventType: "COMMISSION_FEE" }),
        ev({ id: "x2", amount: -25, occurredAt: "2026-06-02T00:00:00.000Z", eventType: "COMMISSION_FEE" }),
      ],
      START,
    );
    expect(points).toHaveLength(2);
  });

  it("handles the empty case without fabricating points", () => {
    const s = buildAccountBalanceSeries([], START);
    expect(s.hasData).toBe(false);
    expect(s.points).toEqual([]);
    expect(s.currentBalance).toBe(START);
  });

  it("skips malformed amounts instead of poisoning the running total", () => {
    const { currentBalance, points } = buildAccountBalanceSeries(
      [
        opening("2026-06-01T00:00:00.000Z"),
        ev({ amount: "not-a-number", occurredAt: "2026-06-02T00:00:00.000Z" }),
        ev({ amount: Number.POSITIVE_INFINITY, occurredAt: "2026-06-02T06:00:00.000Z" }),
        ev({ amount: 200, occurredAt: "2026-06-03T00:00:00.000Z" }),
      ],
      START,
    );
    expect(points).toHaveLength(2);
    expect(currentBalance).toBe(100_200);
  });

  it("allows negative balances and flat stretches", () => {
    const { points } = buildAccountBalanceSeries(
      [
        opening("2026-06-01T00:00:00.000Z", 1_000),
        ev({ amount: -1_500, occurredAt: "2026-06-02T00:00:00.000Z" }),
        ev({ amount: 0, occurredAt: "2026-06-03T00:00:00.000Z", eventType: "MANUAL_ADJUSTMENT" }),
      ],
      1_000,
    );
    expect(points.map((p) => p.balance)).toEqual([1_000, -500, -500]);
  });
});

describe("sliceBalanceSeriesToRange", () => {
  const series = buildAccountBalanceSeries(
    [
      opening("2026-01-01T00:00:00.000Z"),
      ev({ amount: 1_000, occurredAt: "2026-02-01T00:00:00.000Z" }),
      ev({ amount: 2_000, occurredAt: "2026-03-01T00:00:00.000Z" }),
      ev({ amount: -500, occurredAt: "2026-04-01T00:00:00.000Z" }),
    ],
    START,
  );

  it("opens the window at the true pre-range balance, not zero", () => {
    const sliced = sliceBalanceSeriesToRange(series, "2026-03-15T00:00:00.000Z", null);
    expect(sliced.points[0]).toMatchObject({ timestamp: "2026-03-15T00:00:00.000Z", balance: 103_000, synthetic: true });
    expect(sliced.points[1].balance).toBe(102_500);
  });

  it("passes through when no range is given", () => {
    expect(sliceBalanceSeriesToRange(series, null, null)).toBe(series);
  });
});

describe("downsampleBalancePoints", () => {
  it("keeps first, last and extremes, and never alters a retained value", () => {
    const pts = Array.from({ length: 5_000 }, (_, i) => ({
      timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
      balance: 100_000 + Math.round(Math.sin(i / 20) * 5_000),
      change: 0,
      eventType: "TRADE_PNL",
    }));
    const out = downsampleBalancePoints(pts, 500);
    expect(out.length).toBeLessThanOrEqual(pts.length);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
    const peak = Math.max(...pts.map((p) => p.balance));
    const trough = Math.min(...pts.map((p) => p.balance));
    expect(out.some((p) => p.balance === peak)).toBe(true);
    expect(out.some((p) => p.balance === trough)).toBe(true);
  });
});

describe("summariseAccountBalance", () => {
  it("splits trading P&L, deposits, withdrawals and fees, and reports balance drawdown", () => {
    const summary = summariseAccountBalance(
      [
        opening("2026-06-01T00:00:00.000Z"),
        ev({ amount: 6_000, occurredAt: "2026-06-02T00:00:00.000Z", eventType: "TRADE_PNL" }),
        ev({ amount: -4_000, occurredAt: "2026-06-03T00:00:00.000Z", eventType: "TRADE_PNL" }),
        ev({ amount: -100, occurredAt: "2026-06-03T01:00:00.000Z", eventType: "COMMISSION_FEE" }),
        ev({ amount: 2_000, occurredAt: "2026-06-04T00:00:00.000Z", eventType: "DEPOSIT" }),
        ev({ amount: -1_000, occurredAt: "2026-06-05T00:00:00.000Z", eventType: "PAYOUT" }),
      ],
      START,
    );
    expect(summary.netTradingPnl).toBe(2_000);
    expect(summary.totalDeposits).toBe(2_000);
    expect(summary.totalWithdrawals).toBe(1_000);
    expect(summary.totalFees).toBe(100);
    expect(summary.peakBalance).toBe(106_000); // after the +6k trade
    expect(summary.maxBalanceDrawdown).toBe(4_100); // 106,000 → 101,900
    expect(summary.currentBalance).toBe(102_900);
  });

  it("is safe on empty input", () => {
    const summary = summariseAccountBalance([], START);
    expect(summary).toMatchObject({
      startingBalance: START,
      currentBalance: START,
      netTradingPnl: 0,
      maxBalanceDrawdown: 0,
      maxBalanceDrawdownPercent: 0,
    });
  });
});
