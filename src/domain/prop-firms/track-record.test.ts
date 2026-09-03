import { describe, expect, it } from "vitest";

import {
  computeTrackRecord,
  type TrackRecordExecution,
  type TrackRecordLedgerEntry,
} from "@/domain/prop-firms/track-record";

const d = (isoDate: string) => new Date(isoDate);

function makeEntries(): TrackRecordLedgerEntry[] {
  // Starting balance 100,000 -> +2,000 win -> -1,000 loss -> -50 commission -> -500 payout
  return [
    { amount: 100_000, balanceAfter: 100_000, occurredAt: d("2026-01-01"), eventType: "ACCOUNT_INITIALIZED" },
    { amount: 2_000, balanceAfter: 102_000, occurredAt: d("2026-01-02"), eventType: "TRADE_PNL" },
    { amount: -1_000, balanceAfter: 101_000, occurredAt: d("2026-01-03"), eventType: "TRADE_PNL" },
    { amount: -50, balanceAfter: 100_950, occurredAt: d("2026-01-03"), eventType: "COMMISSION_FEE" },
    { amount: -500, balanceAfter: 100_450, occurredAt: d("2026-01-05"), eventType: "PAYOUT" },
  ];
}

function makeExecutions(): TrackRecordExecution[] {
  return [
    {
      grossPnl: 2_010,
      netPnl: 2_000,
      plannedRiskAmount: 1_000,
      riskPercentOfBase: 1,
      actualR: 2,
      status: "CLOSED",
      closedAt: d("2026-01-02"),
      dateKey: "2026-01-02",
    },
    {
      grossPnl: -1_000,
      netPnl: -1_000,
      plannedRiskAmount: 1_000,
      riskPercentOfBase: 1,
      actualR: -1,
      status: "CLOSED",
      closedAt: d("2026-01-03"),
      dateKey: "2026-01-03",
    },
    // A still-open execution must not count toward wins/losses/trading days.
    {
      grossPnl: null,
      netPnl: null,
      plannedRiskAmount: 500,
      riskPercentOfBase: 0.5,
      actualR: null,
      status: "EXECUTED",
      closedAt: null,
      dateKey: "2026-01-06",
    },
  ];
}

describe("computeTrackRecord", () => {
  it("computes balance, PnL, win rate, and fees/payouts from the ledger + executions", () => {
    const summary = computeTrackRecord(makeEntries(), makeExecutions(), 100_000);

    expect(summary.currentBalance.toNumber()).toBe(100_450);
    expect(summary.grossPnl.toNumber()).toBe(1_010);
    expect(summary.netPnl.toNumber()).toBe(1_000);
    expect(summary.roiPercent).toBe(1); // 1,000 / 100,000 × 100
    expect(summary.totalTrades).toBe(2); // the OPEN execution is excluded
    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(1);
    expect(summary.winRatePercent).toBe(50);
    expect(summary.avgR).toBe(0.5); // (2 + -1) / 2
    expect(summary.feesPaid.toNumber()).toBe(50);
    expect(summary.payoutsReceived.toNumber()).toBe(500);
    expect(summary.netReturnAfterCosts.toNumber()).toBe(950); // 1000 - 50 fees
    expect(summary.tradingDaysCompleted).toBe(2);
    expect(summary.totalR).toBe(1); // 2 + -1
    expect(summary.totalParticipatingTrades).toBe(3); // includes the still-open EXECUTED one
    expect(summary.executedTrades).toBe(3); // 2 CLOSED + 1 EXECUTED
    expect(summary.missedOrCancelledTrades).toBe(0);
  });

  it("computes max realized drawdown and current drawdown from the balance curve's peak", () => {
    const summary = computeTrackRecord(makeEntries(), makeExecutions(), 100_000);
    // Peak was 102,000 after the win; it never dropped below 100,450 after that,
    // so max drawdown = 102,000 - 100,450 = 1,550, and current drawdown is the same.
    expect(summary.maxRealizedDrawdown.toNumber()).toBe(1_550);
    expect(summary.currentDrawdown.toNumber()).toBe(1_550);
  });

  it("is honest about the empty case — no fabricated 0% win rate or Infinity profit factor", () => {
    const summary = computeTrackRecord([], [], 100_000);
    expect(summary.currentBalance.toNumber()).toBe(100_000);
    expect(summary.winRatePercent).toBeNull();
    expect(summary.profitFactor).toBeNull();
    expect(summary.avgR).toBeNull();
    expect(summary.lastActivityAt).toBeNull();
  });

  it("profit factor is sum(wins)/sum(|losses|), null when there are no losses to divide by", () => {
    const onlyWins: TrackRecordExecution[] = [
      { grossPnl: 100, netPnl: 100, plannedRiskAmount: 50, riskPercentOfBase: 0.5, actualR: 2, status: "CLOSED", closedAt: d("2026-01-01"), dateKey: "2026-01-01" },
    ];
    const summary = computeTrackRecord([], onlyWins, 10_000);
    expect(summary.profitFactor).toBeNull();
  });

  it("stage-scoped vs account-scoped give different numbers on the same underlying data (caller filters by stageId before calling)", () => {
    const allEntries = makeEntries();
    const allExecutions = makeExecutions();

    const accountScoped = computeTrackRecord(allEntries, allExecutions, 100_000);
    // Simulate a stage-scoped call: only the first trading day's entries/executions.
    const stageScoped = computeTrackRecord(
      allEntries.filter((e) => e.occurredAt <= d("2026-01-02")),
      allExecutions.filter((e) => e.dateKey === "2026-01-02"),
      100_000,
    );

    expect(stageScoped.netPnl.toNumber()).toBe(2_000);
    expect(stageScoped.netPnl.toNumber()).not.toBe(accountScoped.netPnl.toNumber());
  });

  it("finds the longest win/loss streak across closed executions in chronological order", () => {
    const executions: TrackRecordExecution[] = [
      { grossPnl: 10, netPnl: 10, plannedRiskAmount: 10, riskPercentOfBase: 0.1, actualR: 1, status: "CLOSED", closedAt: d("2026-01-01"), dateKey: "2026-01-01" },
      { grossPnl: 10, netPnl: 10, plannedRiskAmount: 10, riskPercentOfBase: 0.1, actualR: 1, status: "CLOSED", closedAt: d("2026-01-02"), dateKey: "2026-01-02" },
      { grossPnl: -10, netPnl: -10, plannedRiskAmount: 10, riskPercentOfBase: 0.1, actualR: -1, status: "CLOSED", closedAt: d("2026-01-03"), dateKey: "2026-01-03" },
      { grossPnl: -10, netPnl: -10, plannedRiskAmount: 10, riskPercentOfBase: 0.1, actualR: -1, status: "CLOSED", closedAt: d("2026-01-04"), dateKey: "2026-01-04" },
      { grossPnl: -10, netPnl: -10, plannedRiskAmount: 10, riskPercentOfBase: 0.1, actualR: -1, status: "CLOSED", closedAt: d("2026-01-05"), dateKey: "2026-01-05" },
    ];
    const summary = computeTrackRecord([], executions, 10_000);
    expect(summary.longestWinStreak).toBe(2);
    expect(summary.longestLossStreak).toBe(3);
    // The account's current run, right now, is 3 losses in a row.
    expect(summary.currentStreak).toBe(-3);
  });

  it("current streak flips sign when the most recent trade breaks the prior run", () => {
    const executions: TrackRecordExecution[] = [
      { grossPnl: -10, netPnl: -10, plannedRiskAmount: 10, riskPercentOfBase: 0.1, actualR: -1, status: "CLOSED", closedAt: d("2026-01-01"), dateKey: "2026-01-01" },
      { grossPnl: -10, netPnl: -10, plannedRiskAmount: 10, riskPercentOfBase: 0.1, actualR: -1, status: "CLOSED", closedAt: d("2026-01-02"), dateKey: "2026-01-02" },
      { grossPnl: 10, netPnl: 10, plannedRiskAmount: 10, riskPercentOfBase: 0.1, actualR: 1, status: "CLOSED", closedAt: d("2026-01-03"), dateKey: "2026-01-03" },
    ];
    const summary = computeTrackRecord([], executions, 10_000);
    expect(summary.currentStreak).toBe(1);
  });

  it("counts MISSED/CANCELLED/NOT_TAKEN participations without letting them affect wins/losses/PnL", () => {
    const executions: TrackRecordExecution[] = [
      { grossPnl: 10, netPnl: 10, plannedRiskAmount: 10, riskPercentOfBase: 0.1, actualR: 1, status: "CLOSED", closedAt: d("2026-01-01"), dateKey: "2026-01-01" },
      { grossPnl: null, netPnl: null, plannedRiskAmount: 10, riskPercentOfBase: 0.1, actualR: null, status: "MISSED", closedAt: null, dateKey: "2026-01-02" },
      { grossPnl: null, netPnl: null, plannedRiskAmount: 10, riskPercentOfBase: 0.1, actualR: null, status: "CANCELLED", closedAt: null, dateKey: "2026-01-03" },
      { grossPnl: null, netPnl: null, plannedRiskAmount: 10, riskPercentOfBase: 0.1, actualR: null, status: "NOT_TAKEN", closedAt: null, dateKey: "2026-01-04" },
    ];
    const summary = computeTrackRecord([], executions, 10_000);
    expect(summary.totalParticipatingTrades).toBe(4);
    expect(summary.executedTrades).toBe(1);
    expect(summary.missedOrCancelledTrades).toBe(3);
    expect(summary.wins).toBe(1);
    expect(summary.netPnl.toNumber()).toBe(10);
  });
});
