import { describe, expect, it } from "vitest";

import {
  avgTimeToPassDays,
  challengePassRatePercent,
  performanceByAccount,
  performanceByFirm,
  performanceByFundedOrChallenge,
  riskAllocationVsOutcome,
  ruleBreachFrequency,
  stageFailureReasons,
  type ExecutionAnalyticsPoint,
  type RuleBreachPoint,
  type StageOutcomePoint,
} from "@/domain/prop-firms/analytics-breakdowns";

function point(over: Partial<ExecutionAnalyticsPoint>): ExecutionAnalyticsPoint {
  return {
    tradeId: "trade-1",
    propFirmAccountId: "acct-1",
    accountDisplayName: "Account A",
    firmId: "firm-1",
    firmName: "Firm A",
    marketCategory: "CFD",
    isFundedAccount: false,
    netPnl: 100,
    actualR: 1,
    plannedRiskAmount: 100,
    riskPercentOfBase: 1,
    status: "CLOSED",
    closedAt: "2026-01-01",
    ...over,
  };
}

describe("performanceByFirm / performanceByAccount — anti-double-count", () => {
  it("one Trade Idea with executions on 2 accounts of the SAME firm contributes once per execution, not once per idea", () => {
    const points: ExecutionAnalyticsPoint[] = [
      point({ tradeId: "idea-1", propFirmAccountId: "acct-1", accountDisplayName: "Account A", netPnl: 100 }),
      point({ tradeId: "idea-1", propFirmAccountId: "acct-2", accountDisplayName: "Account B", netPnl: -50 }),
    ];
    const byAccount = performanceByAccount(points);
    expect(byAccount).toHaveLength(2); // two distinct accounts, not collapsed into one idea
    expect(byAccount.find((a) => a.label === "Account A")?.trades).toBe(1);
    expect(byAccount.find((a) => a.label === "Account B")?.trades).toBe(1);

    const byFirm = performanceByFirm(points);
    expect(byFirm).toHaveLength(1); // same firm
    expect(byFirm[0].trades).toBe(2); // both executions counted — not deduplicated to 1 idea
    expect(byFirm[0].netPnl).toBe(50); // 100 - 50
  });

  it("excludes non-closed or PnL-unresolved executions from win rate/netPnl", () => {
    const points: ExecutionAnalyticsPoint[] = [
      point({ status: "CLOSED", netPnl: 100 }),
      point({ status: "EXECUTED", netPnl: null }),
      point({ status: "PLANNED", netPnl: null }),
    ];
    const byFirm = performanceByFirm(points);
    expect(byFirm[0].trades).toBe(1);
  });
});

describe("performanceByFundedOrChallenge", () => {
  it("splits by funded vs challenge account status", () => {
    const points: ExecutionAnalyticsPoint[] = [
      point({ isFundedAccount: true, netPnl: 200 }),
      point({ isFundedAccount: false, netPnl: -100 }),
    ];
    const result = performanceByFundedOrChallenge(points);
    expect(result.find((r) => r.label === "FUNDED")?.netPnl).toBe(200);
    expect(result.find((r) => r.label === "CHALLENGE")?.netPnl).toBe(-100);
  });
});

describe("challengePassRatePercent", () => {
  it("is null with no resolved stages (never a fabricated 0%)", () => {
    const stages: StageOutcomePoint[] = [{ accountId: "a1", stageType: "PHASE_1", status: "ACTIVE", startDate: null, completionDate: null }];
    expect(challengePassRatePercent(stages)).toBeNull();
  });

  it("computes passed / (passed + failed + breached)", () => {
    const stages: StageOutcomePoint[] = [
      { accountId: "a1", stageType: "PHASE_1", status: "PASSED", startDate: "2026-01-01", completionDate: "2026-01-10" },
      { accountId: "a2", stageType: "PHASE_1", status: "FAILED", startDate: "2026-01-01", completionDate: "2026-01-05" },
      { accountId: "a3", stageType: "PHASE_1", status: "PENDING", startDate: null, completionDate: null }, // excluded — unresolved
    ];
    expect(challengePassRatePercent(stages)).toBe(50);
  });
});

describe("stageFailureReasons", () => {
  it("buckets failed/breached stages by type+status, most frequent first", () => {
    const stages: StageOutcomePoint[] = [
      { accountId: "a1", stageType: "PHASE_1", status: "FAILED", startDate: null, completionDate: null },
      { accountId: "a2", stageType: "PHASE_1", status: "FAILED", startDate: null, completionDate: null },
      { accountId: "a3", stageType: "PHASE_2", status: "BREACHED", startDate: null, completionDate: null },
      { accountId: "a4", stageType: "PHASE_1", status: "PASSED", startDate: null, completionDate: null }, // excluded
    ];
    const result = stageFailureReasons(stages);
    expect(result[0]).toEqual({ reason: "PHASE_1 — FAILED", count: 2 });
    expect(result[1]).toEqual({ reason: "PHASE_2 — BREACHED", count: 1 });
  });
});

describe("avgTimeToPassDays", () => {
  it("averages calendar days from start to completion for PASSED stages only", () => {
    const stages: StageOutcomePoint[] = [
      { accountId: "a1", stageType: "PHASE_1", status: "PASSED", startDate: "2026-01-01", completionDate: "2026-01-11" }, // 10 days
      { accountId: "a2", stageType: "PHASE_1", status: "PASSED", startDate: "2026-01-01", completionDate: "2026-01-21" }, // 20 days
      { accountId: "a3", stageType: "PHASE_1", status: "FAILED", startDate: "2026-01-01", completionDate: "2026-01-03" }, // excluded
    ];
    expect(avgTimeToPassDays(stages)).toBe(15);
  });

  it("is null when no passed stage has both dates", () => {
    expect(avgTimeToPassDays([])).toBeNull();
  });
});

describe("ruleBreachFrequency", () => {
  it("tallies BREACHED states per rule key, most frequent first", () => {
    const results: RuleBreachPoint[] = [
      { ruleKey: "MAX_DAILY_LOSS", state: "BREACHED" },
      { ruleKey: "MAX_DAILY_LOSS", state: "BREACHED" },
      { ruleKey: "MAX_TOTAL_LOSS", state: "BREACHED" },
      { ruleKey: "PROFIT_TARGET", state: "TARGET_REACHED" }, // not a breach — excluded
      { ruleKey: "MAX_DAILY_LOSS", state: "SAFE" }, // not a breach — excluded
    ];
    const result = ruleBreachFrequency(results);
    expect(result[0]).toEqual({ ruleKey: "MAX_DAILY_LOSS", breachCount: 2 });
    expect(result[1]).toEqual({ ruleKey: "MAX_TOTAL_LOSS", breachCount: 1 });
  });
});

describe("riskAllocationVsOutcome", () => {
  it("buckets closed executions by risk % and reports outcome per bucket", () => {
    const points: ExecutionAnalyticsPoint[] = [
      point({ riskPercentOfBase: 0.3, netPnl: 50, actualR: 1 }),
      point({ riskPercentOfBase: 1.5, netPnl: -100, actualR: -1 }),
      point({ riskPercentOfBase: 1.7, netPnl: 200, actualR: 2 }),
    ];
    const result = riskAllocationVsOutcome(points);
    const lowBucket = result.find((b) => b.bucketLabel === "0-0.5%");
    const midBucket = result.find((b) => b.bucketLabel === "1-2%");
    expect(lowBucket?.trades).toBe(1);
    expect(midBucket?.trades).toBe(2);
    expect(midBucket?.winRate).toBe(50);
  });

  it("excludes executions with no resolvable risk % rather than guessing a bucket", () => {
    const points: ExecutionAnalyticsPoint[] = [point({ riskPercentOfBase: null })];
    expect(riskAllocationVsOutcome(points)).toEqual([]);
  });
});
