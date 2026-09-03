import { describe, expect, it } from "vitest";

import {
  buildOverviewSeries,
  overviewCurrencies,
  type OverviewAccountInput,
  type OverviewPayoutInput,
  type OverviewStageInput,
} from "./overview-series";
import type { RawBalanceEvent } from "./balance-curve";

const NOW = new Date("2026-03-30T00:00:00.000Z"); // a Monday

function open(at: string, amount: number): RawBalanceEvent {
  return { id: `open-${at}`, eventType: "ACCOUNT_INITIALIZED", amount, occurredAt: at, sourceType: "ACCOUNT_INIT", sourceId: "a" };
}
function trade(at: string, amount: number, id = `t-${at}-${amount}`): RawBalanceEvent {
  return { id, eventType: "TRADE_PNL", amount, occurredAt: at, sourceType: "TRADE_EXECUTION", sourceId: id };
}

function account(over: Partial<OverviewAccountInput> = {}): OverviewAccountInput {
  return {
    accountId: over.accountId ?? "acc-1",
    firmId: over.firmId ?? "firm-1",
    marketCategory: over.marketCategory ?? "CFD",
    currency: over.currency ?? "USD",
    startingBalance: over.startingBalance ?? 100_000,
    status: over.status ?? "FUNDED",
    archivedAt: over.archivedAt ?? null,
    purchaseDate: over.purchaseDate ?? null,
    createdAt: over.createdAt ?? "2026-01-01T00:00:00.000Z",
    stages: over.stages ?? [fundedStage("2026-01-05T00:00:00.000Z")],
    ledgerEvents: over.ledgerEvents ?? [open("2026-01-05T00:00:00.000Z", 100_000)],
    payouts: over.payouts ?? [],
  };
}

function fundedStage(startDate: string | null, over: Partial<OverviewStageInput> = {}): OverviewStageInput {
  return { type: "MASTER_FUNDED", status: over.status ?? "ACTIVE", startDate, completionDate: over.completionDate ?? null };
}
function challengeStage(startDate: string | null): OverviewStageInput {
  return { type: "PHASE_1", status: "ACTIVE", startDate, completionDate: null };
}
function payout(over: Partial<OverviewPayoutInput> & { traderReceived: number; paidDate: string }): OverviewPayoutInput {
  return {
    id: over.id ?? `p-${over.paidDate}-${over.traderReceived}`,
    traderReceived: over.traderReceived,
    status: over.status ?? "PAID",
    paidDate: over.paidDate,
    approvedDate: over.approvedDate ?? null,
  };
}

describe("buildOverviewSeries — master capital", () => {
  it("snapshots combined balance per week and never cumulative-sums it", () => {
    const acc = account({
      ledgerEvents: [
        open("2026-01-05T00:00:00.000Z", 100_000),
        trade("2026-02-02T00:00:00.000Z", 5_000),
        trade("2026-03-02T00:00:00.000Z", -2_000),
      ],
    });
    const { points } = buildOverviewSeries([acc], { now: NOW });
    // Each week's masterCapital is the balance as of that week, not a growing tally.
    expect(points[0].masterCapital).toBe(100_000);
    const feb = points.find((p) => p.weekEnding >= "2026-02-08" && p.weekEnding < "2026-02-16")!;
    expect(feb.masterCapital).toBe(105_000);
    const mar = points[points.length - 1];
    expect(mar.masterCapital).toBe(103_000); // 100k + 5k - 2k, NOT 100k+105k+103k
  });

  it("adds a master account only from the week it became funded", () => {
    const a = account({ accountId: "a", stages: [fundedStage("2026-01-05T00:00:00.000Z")], ledgerEvents: [open("2026-01-05T00:00:00.000Z", 100_000)] });
    const b = account({
      accountId: "b",
      stages: [challengeStage("2026-01-05T00:00:00.000Z"), fundedStage("2026-03-01T00:00:00.000Z")],
      ledgerEvents: [open("2026-01-05T00:00:00.000Z", 50_000)],
      startingBalance: 50_000,
    });
    const { points } = buildOverviewSeries([a, b], { now: NOW });
    expect(points[0].activeAccountCount).toBe(1);
    expect(points[0].masterCapital).toBe(100_000);
    const last = points[points.length - 1];
    expect(last.activeAccountCount).toBe(2);
    expect(last.masterCapital).toBe(150_000);
  });

  it("drops a breached account after its breach date", () => {
    const a = account({ accountId: "a" });
    const b = account({
      accountId: "b",
      status: "BREACHED",
      startingBalance: 50_000,
      stages: [fundedStage("2026-01-05T00:00:00.000Z", { status: "BREACHED", completionDate: "2026-02-15T00:00:00.000Z" })],
      ledgerEvents: [open("2026-01-05T00:00:00.000Z", 50_000)],
    });
    const { points } = buildOverviewSeries([a, b], { now: NOW });
    const jan = points[0];
    const end = points[points.length - 1];
    expect(jan.activeAccountCount).toBe(2);
    expect(jan.masterCapital).toBe(150_000);
    expect(end.activeAccountCount).toBe(1);
    expect(end.masterCapital).toBe(100_000);
  });

  it("excludes challenge / evaluation accounts entirely", () => {
    const challenge = account({ accountId: "c", status: "ACTIVE", stages: [challengeStage("2026-01-05T00:00:00.000Z")] });
    const funded = account({ accountId: "f" });
    const { points } = buildOverviewSeries([challenge, funded], { now: NOW });
    expect(points.every((p) => p.activeAccountCount === 1)).toBe(true);
    expect(points[points.length - 1].masterCapital).toBe(100_000);
  });

  it("combines several master accounts across multiple firms", () => {
    const accounts = [
      account({ accountId: "a1", firmId: "f1" }),
      account({ accountId: "a2", firmId: "f2", startingBalance: 200_000, ledgerEvents: [open("2026-01-05T00:00:00.000Z", 200_000)] }),
      account({ accountId: "a3", firmId: "f2", startingBalance: 25_000, ledgerEvents: [open("2026-01-05T00:00:00.000Z", 25_000)] }),
    ];
    const { points } = buildOverviewSeries(accounts, { now: NOW });
    expect(points[points.length - 1].masterCapital).toBe(325_000);
    expect(points[points.length - 1].activeAccountCount).toBe(3);
  });

  it("handles negative balances and flat weeks", () => {
    const acc = account({
      startingBalance: 1_000,
      ledgerEvents: [open("2026-01-05T00:00:00.000Z", 1_000), trade("2026-02-02T00:00:00.000Z", -1_500)],
    });
    const { points } = buildOverviewSeries([acc], { now: NOW });
    expect(points[0].masterCapital).toBe(1_000);
    expect(points[points.length - 1].masterCapital).toBe(-500);
    // weeks between the two events are flat at 1_000 then flat at -500
  });
});

describe("buildOverviewSeries — cumulative payouts", () => {
  it("accumulates trader-received (net) payouts by paid date, once each", () => {
    const acc = account({
      payouts: [
        payout({ traderReceived: 800, paidDate: "2026-02-03T00:00:00.000Z" }),
        payout({ traderReceived: 1_200, paidDate: "2026-03-03T00:00:00.000Z" }),
      ],
    });
    const { points, summary } = buildOverviewSeries([acc], { now: NOW });
    expect(points[0].cumulativePayouts).toBe(0);
    const afterFirst = points.find((p) => p.weekEnding >= "2026-02-08")!;
    expect(afterFirst.cumulativePayouts).toBe(800);
    expect(points[points.length - 1].cumulativePayouts).toBe(2_000);
    expect(summary.lifetimeCumulativePayouts).toBe(2_000);
  });

  it("does NOT re-apply a profit split — traderReceived is already net", () => {
    // Gross was $1,000 @ 80% → traderReceived 800 supplied by the caller.
    const acc = account({ payouts: [payout({ traderReceived: 800, paidDate: "2026-02-03T00:00:00.000Z" })] });
    const { points } = buildOverviewSeries([acc], { now: NOW });
    expect(points[points.length - 1].cumulativePayouts).toBe(800);
  });

  it("ignores duplicate, pending, failed and cancelled payouts", () => {
    const acc = account({
      payouts: [
        payout({ id: "dup", traderReceived: 500, paidDate: "2026-02-03T00:00:00.000Z" }),
        payout({ id: "dup", traderReceived: 500, paidDate: "2026-02-03T00:00:00.000Z" }),
        payout({ id: "pending", traderReceived: 999, paidDate: "2026-02-03T00:00:00.000Z", status: "REQUESTED" }),
        payout({ id: "cancelled", traderReceived: 999, paidDate: "2026-02-03T00:00:00.000Z", status: "CANCELLED" }),
        payout({ id: "rejected", traderReceived: 999, paidDate: "2026-02-10T00:00:00.000Z", status: "REJECTED" }),
      ],
    });
    const { points } = buildOverviewSeries([acc], { now: NOW });
    expect(points[points.length - 1].cumulativePayouts).toBe(500);
  });
});

describe("buildOverviewSeries — currency", () => {
  it("separates unlike currencies and never adds them together", () => {
    const usd = account({ accountId: "usd", currency: "USD" });
    const eur = account({ accountId: "eur", currency: "EUR", startingBalance: 80_000, ledgerEvents: [open("2026-01-05T00:00:00.000Z", 80_000)] });
    const both = [usd, eur];
    expect(overviewCurrencies(both)).toEqual(["EUR", "USD"]);
    const usdSeries = buildOverviewSeries(both, { now: NOW, currency: "USD" });
    expect(usdSeries.currency).toBe("USD");
    expect(usdSeries.currencies).toEqual(["EUR", "USD"]);
    expect(usdSeries.points[usdSeries.points.length - 1].masterCapital).toBe(100_000);
    const eurSeries = buildOverviewSeries(both, { now: NOW, currency: "EUR" });
    expect(eurSeries.points[eurSeries.points.length - 1].masterCapital).toBe(80_000);
  });

  it("defaults to the currency backing the most accounts", () => {
    const accounts = [
      account({ accountId: "u1", currency: "USD" }),
      account({ accountId: "u2", currency: "USD" }),
      account({ accountId: "e1", currency: "EUR" }),
    ];
    expect(buildOverviewSeries(accounts, { now: NOW }).currency).toBe("USD");
  });
});

describe("buildOverviewSeries — filters & summary", () => {
  const acc = account({
    ledgerEvents: [
      open("2026-01-05T00:00:00.000Z", 100_000),
      trade("2026-01-19T00:00:00.000Z", 4_000),
      trade("2026-02-16T00:00:00.000Z", 6_000),
      trade("2026-03-16T00:00:00.000Z", -1_000),
    ],
    payouts: [
      payout({ traderReceived: 1_000, paidDate: "2026-01-20T00:00:00.000Z" }),
      payout({ traderReceived: 2_000, paidDate: "2026-02-20T00:00:00.000Z" }),
      payout({ traderReceived: 500, paidDate: "2026-03-20T00:00:00.000Z" }),
    ],
  });

  it("opens a filtered window at the true pre-range values, not zero", () => {
    const full = buildOverviewSeries([acc], { now: NOW });
    const sliced = buildOverviewSeries([acc], { now: NOW, from: "2026-03-01T00:00:00.000Z" });
    expect(sliced.points[0].masterCapital).toBeGreaterThan(100_000);
    expect(sliced.points[0].cumulativePayouts).toBe(3_000); // 1000 + 2000 already banked
    // Lifetime total is unchanged by the window.
    expect(sliced.summary.lifetimeCumulativePayouts).toBe(full.summary.lifetimeCumulativePayouts);
    expect(sliced.summary.lifetimeCumulativePayouts).toBe(3_500);
  });

  it("computes opening / current / change / growth% / period payouts for the window", () => {
    const s = buildOverviewSeries([acc], { now: NOW, from: "2026-03-01T00:00:00.000Z" }).summary;
    // opening = end-of-Feb capital = 100k + 4k + 6k = 110k
    expect(s.openingMasterCapital).toBe(110_000);
    // current = 110k - 1k = 109k
    expect(s.currentMasterCapital).toBe(109_000);
    expect(s.netMasterCapitalChange).toBe(-1_000);
    expect(s.masterCapitalGrowthPercent).toBeCloseTo(-0.91, 2);
    expect(s.payoutsReceivedDuringPeriod).toBe(500); // only the March payout
  });

  it("reports growth% as null when opening capital is zero", () => {
    const s = buildOverviewSeries([account({ startingBalance: 0, ledgerEvents: [] })], { now: NOW }).summary;
    expect(s.openingMasterCapital).toBe(0);
    expect(s.masterCapitalGrowthPercent).toBeNull();
  });

  it("returns an empty, safe result when nothing is eligible", () => {
    const res = buildOverviewSeries([account({ status: "ACTIVE", stages: [challengeStage("2026-01-05T00:00:00.000Z")] })], { now: NOW });
    expect(res.hasData).toBe(false);
    expect(res.points).toEqual([]);
    expect(res.summary.currentMasterCapital).toBe(0);
  });
});
