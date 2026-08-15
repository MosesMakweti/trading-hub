import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  evaluateRule,
  stateFromPercent,
  type RuleEvaluationContext,
  type RuleHealthExecution,
  type RuleHealthLedgerEntry,
  type RuleHealthRule,
} from "@/domain/prop-firms/rule-health";

const d = (isoDate: string) => new Date(isoDate);

function makeRule(overrides: Partial<RuleHealthRule>): RuleHealthRule {
  return {
    id: "rule-1",
    ruleKey: "MAX_DAILY_LOSS",
    valueType: "PERCENTAGE",
    numericValue: null,
    measurementBasis: "Balance",
    warningThreshold: null,
    criticalThreshold: null,
    breachThreshold: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<RuleEvaluationContext>): RuleEvaluationContext {
  return {
    rule: makeRule({}),
    account: { dailyResetTimezone: null, dailyResetHour: 0 },
    stage: { startingBalance: 100_000, startDate: d("2026-01-01"), status: "ACTIVE" },
    ledgerEntries: [],
    executions: [],
    currentBalance: 100_000,
    now: d("2026-01-10"),
    ...overrides,
  };
}

describe("stateFromPercent", () => {
  const thresholds = { warningThreshold: null, criticalThreshold: null, breachThreshold: null };

  it("applies the default 70/90/100 boundaries", () => {
    expect(stateFromPercent(new Decimal(69), thresholds)).toBe("SAFE");
    expect(stateFromPercent(new Decimal(70), thresholds)).toBe("APPROACHING");
    expect(stateFromPercent(new Decimal(90), thresholds)).toBe("CRITICAL");
    expect(stateFromPercent(new Decimal(100), thresholds)).toBe("BREACHED");
  });

  it("honors configured per-rule threshold overrides", () => {
    const custom = { warningThreshold: 50, criticalThreshold: 75, breachThreshold: 95 };
    expect(stateFromPercent(new Decimal(60), custom)).toBe("APPROACHING");
    expect(stateFromPercent(new Decimal(80), custom)).toBe("CRITICAL");
    expect(stateFromPercent(new Decimal(95), custom)).toBe("BREACHED");
  });
});

describe("evaluateRule dispatch", () => {
  it("returns MANUAL_TRACKING for a RuleKey with no registered evaluator", () => {
    const ctx = makeContext({ rule: makeRule({ ruleKey: "MAX_OPEN_POSITIONS" }) });
    const result = evaluateRule(ctx);
    expect(result.state).toBe("MANUAL_TRACKING");
  });

  it("PROFIT_SPLIT is always MANUAL_TRACKING — informational, not a breach concept", () => {
    const ctx = makeContext({ rule: makeRule({ ruleKey: "PROFIT_SPLIT", numericValue: 80, valueType: "PERCENTAGE" }) });
    expect(evaluateRule(ctx).state).toBe("MANUAL_TRACKING");
  });

  it("INTRADAY_TRAILING_DRAWDOWN is always NOT_ENOUGH_DATA — no intraday equity feed exists", () => {
    const ctx = makeContext({ rule: makeRule({ ruleKey: "INTRADAY_TRAILING_DRAWDOWN", numericValue: 5, valueType: "PERCENTAGE" }) });
    expect(evaluateRule(ctx).state).toBe("NOT_ENOUGH_DATA");
  });
});

describe("MAX_DAILY_LOSS", () => {
  it("is NOT_ENOUGH_DATA when no limit is configured", () => {
    const ctx = makeContext({ rule: makeRule({ ruleKey: "MAX_DAILY_LOSS", numericValue: null }) });
    expect(evaluateRule(ctx).state).toBe("NOT_ENOUGH_DATA");
  });

  it("is NOT_ENOUGH_DATA for an equity basis (no equity feed)", () => {
    const ctx = makeContext({ rule: makeRule({ ruleKey: "MAX_DAILY_LOSS", numericValue: 5, measurementBasis: "Equity" }) });
    expect(evaluateRule(ctx).state).toBe("NOT_ENOUGH_DATA");
  });

  it("sums only TODAY's TRADE_PNL entries against yesterday's EOD balance as the basis (never today's own shrinking balance)", () => {
    const entries: RuleHealthLedgerEntry[] = [
      { amount: -1_000, balanceAfter: 99_000, eventType: "TRADE_PNL", occurredAt: d("2026-01-09T10:00:00Z") }, // yesterday — sets today's basis
      { amount: -2_000, balanceAfter: 97_000, eventType: "TRADE_PNL", occurredAt: d("2026-01-10T10:00:00Z") }, // today
      { amount: -50, balanceAfter: 96_950, eventType: "COMMISSION_FEE", occurredAt: d("2026-01-10T10:01:00Z") }, // not TRADE_PNL — excluded from the loss sum
    ];
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "MAX_DAILY_LOSS", numericValue: 3, measurementBasis: "Balance" }), // 3% of yesterday's EOD balance (99,000) = 2,970
      ledgerEntries: entries,
      currentBalance: 96_950,
    });
    const result = evaluateRule(ctx);
    expect(result.currentValue?.toNumber()).toBe(2_000);
    expect(result.limitValue?.toNumber()).toBe(2_970);
    expect(result.percentConsumed).toBeCloseTo((2_000 / 2_970) * 100);
    expect(result.state).toBe("SAFE");
  });

  it("reaches BREACHED once today's loss meets or exceeds the limit", () => {
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "MAX_DAILY_LOSS", numericValue: 2, measurementBasis: "Balance" }), // 2,000 limit
      ledgerEntries: [{ amount: -2_500, balanceAfter: 97_500, eventType: "TRADE_PNL", occurredAt: d("2026-01-10T09:00:00Z") }],
      currentBalance: 97_500,
    });
    expect(evaluateRule(ctx).state).toBe("BREACHED");
  });
});

describe("MAX_TOTAL_LOSS", () => {
  it("is the cumulative drawdown from starting balance", () => {
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "MAX_TOTAL_LOSS", numericValue: 10, measurementBasis: "Balance" }), // 10% of 100k = 10,000
      currentBalance: 92_000,
    });
    const result = evaluateRule(ctx);
    expect(result.currentValue?.toNumber()).toBe(8_000);
    expect(result.percentConsumed).toBe(80);
    expect(result.state).toBe("APPROACHING"); // 80% is between the default 70% warning and 90% critical boundaries
  });
});

describe("STATIC_DRAWDOWN", () => {
  it("computes a floor that never moves, regardless of balance history", () => {
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "STATIC_DRAWDOWN", numericValue: 6, measurementBasis: "Balance" }), // floor = 94,000
      currentBalance: 95_000,
    });
    const result = evaluateRule(ctx);
    expect(result.limitValue?.toNumber()).toBe(94_000);
    // consumed = 100,000 - 95,000 = 5,000 of the 6,000 allowance = ~83.3% -> APPROACHING
    expect(result.state).toBe("APPROACHING");
  });
});

describe("EOD_TRAILING_DRAWDOWN", () => {
  it("trails the peak balanceAfter seen across the stage's ledger history", () => {
    const entries: RuleHealthLedgerEntry[] = [
      { amount: 5_000, balanceAfter: 105_000, eventType: "TRADE_PNL", occurredAt: d("2026-01-05") }, // peak
      { amount: -3_000, balanceAfter: 102_000, eventType: "TRADE_PNL", occurredAt: d("2026-01-06") },
    ];
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "EOD_TRAILING_DRAWDOWN", numericValue: 5, measurementBasis: "Balance" }), // 5% of peak 105,000 = 5,250 allowance
      ledgerEntries: entries,
      currentBalance: 102_000,
    });
    const result = evaluateRule(ctx);
    expect(result.currentValue?.toNumber()).toBe(102_000);
    // consumed = 105,000 - 102,000 = 3,000; percent = 3,000/5,250 * 100
    expect(result.percentConsumed).toBeCloseTo((3_000 / 5_250) * 100);
  });

  it("is NOT_ENOUGH_DATA with no ledger history yet", () => {
    const ctx = makeContext({ rule: makeRule({ ruleKey: "EOD_TRAILING_DRAWDOWN", numericValue: 5 }), ledgerEntries: [] });
    expect(evaluateRule(ctx).state).toBe("NOT_ENOUGH_DATA");
  });
});

describe("MIN_TRADING_DAYS / MAX_TRADING_DAYS", () => {
  const executions: RuleHealthExecution[] = [
    { netPnl: 100, riskPercentOfBase: 1, actualLotSize: null, actualContractQty: null, status: "CLOSED", closedAt: d("2026-01-02"), plannedAt: d("2026-01-02") },
    { netPnl: -50, riskPercentOfBase: 1, actualLotSize: null, actualContractQty: null, status: "CLOSED", closedAt: d("2026-01-03"), plannedAt: d("2026-01-03") },
    { netPnl: null, riskPercentOfBase: 1, actualLotSize: null, actualContractQty: null, status: "EXECUTED", closedAt: null, plannedAt: d("2026-01-04") }, // not closed — excluded
  ];

  it("MIN_TRADING_DAYS reaches TARGET_REACHED once the requirement is met (never BREACHED — this is a target, not a limit)", () => {
    const ctx = makeContext({ rule: makeRule({ ruleKey: "MIN_TRADING_DAYS", numericValue: 2, valueType: "NUMERIC" }), executions });
    const result = evaluateRule(ctx);
    expect(result.currentValue?.toNumber()).toBe(2);
    expect(result.state).toBe("TARGET_REACHED");
  });

  it("MIN_TRADING_DAYS is SAFE (not CRITICAL/BREACHED) while still below the requirement", () => {
    const ctx = makeContext({ rule: makeRule({ ruleKey: "MIN_TRADING_DAYS", numericValue: 5, valueType: "NUMERIC" }), executions });
    expect(evaluateRule(ctx).state).toBe("SAFE");
  });

  it("MAX_TRADING_DAYS is a real limit — can reach BREACHED", () => {
    const ctx = makeContext({ rule: makeRule({ ruleKey: "MAX_TRADING_DAYS", numericValue: 2, valueType: "NUMERIC" }), executions });
    expect(evaluateRule(ctx).state).toBe("BREACHED");
  });
});

describe("CONSISTENCY_RULE", () => {
  it("is NOT_ENOUGH_DATA with no profitable days yet", () => {
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "CONSISTENCY_RULE", numericValue: 30, valueType: "PERCENTAGE" }),
      ledgerEntries: [{ amount: -500, balanceAfter: 99_500, eventType: "TRADE_PNL", occurredAt: d("2026-01-05") }],
    });
    expect(evaluateRule(ctx).state).toBe("NOT_ENOUGH_DATA");
  });

  it("flags when one day dominates total profit share", () => {
    const entries: RuleHealthLedgerEntry[] = [
      { amount: 4_000, balanceAfter: 104_000, eventType: "TRADE_PNL", occurredAt: d("2026-01-05") },
      { amount: 1_000, balanceAfter: 105_000, eventType: "TRADE_PNL", occurredAt: d("2026-01-06") },
    ];
    // Total profit 5,000; largest day 4,000 = 80% share, limit is 40% -> way over.
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "CONSISTENCY_RULE", numericValue: 40, valueType: "PERCENTAGE" }),
      ledgerEntries: entries,
    });
    const result = evaluateRule(ctx);
    expect(result.currentValue?.toNumber()).toBe(80);
    expect(result.state).toBe("BREACHED");
  });
});

describe("MAX_RISK_PER_TRADE / MAX_RISK_PER_DAY", () => {
  it("MAX_RISK_PER_TRADE uses the highest single execution's risk %", () => {
    const executions: RuleHealthExecution[] = [
      { netPnl: null, riskPercentOfBase: 0.5, actualLotSize: null, actualContractQty: null, status: "EXECUTED", closedAt: null, plannedAt: d("2026-01-05") },
      { netPnl: null, riskPercentOfBase: 1.5, actualLotSize: null, actualContractQty: null, status: "EXECUTED", closedAt: null, plannedAt: d("2026-01-06") },
    ];
    const ctx = makeContext({ rule: makeRule({ ruleKey: "MAX_RISK_PER_TRADE", numericValue: 1, valueType: "PERCENTAGE" }), executions });
    const result = evaluateRule(ctx);
    expect(result.currentValue?.toNumber()).toBe(1.5);
    expect(result.state).toBe("BREACHED");
  });

  it("MAX_RISK_PER_DAY uses the highest COMBINED same-day risk %", () => {
    const executions: RuleHealthExecution[] = [
      { netPnl: null, riskPercentOfBase: 1, actualLotSize: null, actualContractQty: null, status: "EXECUTED", closedAt: null, plannedAt: d("2026-01-05T09:00:00Z") },
      { netPnl: null, riskPercentOfBase: 1, actualLotSize: null, actualContractQty: null, status: "EXECUTED", closedAt: null, plannedAt: d("2026-01-05T11:00:00Z") },
    ];
    const ctx = makeContext({ rule: makeRule({ ruleKey: "MAX_RISK_PER_DAY", numericValue: 3, valueType: "PERCENTAGE" }), executions });
    const result = evaluateRule(ctx);
    expect(result.currentValue?.toNumber()).toBe(2); // combined same day
    expect(result.state).toBe("SAFE");
  });
});

describe("MAX_LOT_SIZE / MAX_CONTRACT_SIZE", () => {
  it("uses the largest recorded execution size", () => {
    const executions: RuleHealthExecution[] = [
      { netPnl: null, riskPercentOfBase: null, actualLotSize: 1.5, actualContractQty: null, status: "CLOSED", closedAt: d("2026-01-05"), plannedAt: d("2026-01-05") },
      { netPnl: null, riskPercentOfBase: null, actualLotSize: 3, actualContractQty: null, status: "CLOSED", closedAt: d("2026-01-06"), plannedAt: d("2026-01-06") },
    ];
    const ctx = makeContext({ rule: makeRule({ ruleKey: "MAX_LOT_SIZE", numericValue: 2, valueType: "NUMERIC" }), executions });
    expect(evaluateRule(ctx).state).toBe("BREACHED");
  });
});

describe("PROFIT_TARGET", () => {
  it("progresses SAFE -> APPROACHING -> CRITICAL as profit approaches the target", () => {
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "PROFIT_TARGET", numericValue: 10, valueType: "PERCENTAGE" }), // target 10,000
      currentBalance: 107_500, // 7,500 / 10,000 = 75%
    });
    expect(evaluateRule(ctx).state).toBe("APPROACHING");
  });

  it("reaches TARGET_REACHED when profit meets the target and no MIN_TRADING_DAYS rule blocks it", () => {
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "PROFIT_TARGET", numericValue: 10, valueType: "PERCENTAGE" }),
      currentBalance: 110_500,
      minTradingDaysMet: null, // no such rule configured — met by default
    });
    expect(evaluateRule(ctx).state).toBe("TARGET_REACHED");
  });

  it("does NOT report TARGET_REACHED when profit is met but the paired MIN_TRADING_DAYS rule isn't satisfied", () => {
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "PROFIT_TARGET", numericValue: 10, valueType: "PERCENTAGE" }),
      currentBalance: 110_500,
      minTradingDaysMet: false,
    });
    const result = evaluateRule(ctx);
    expect(result.state).not.toBe("TARGET_REACHED");
  });

  it("never treats a losing stage as a discrepancy — just reports 0% progress, not a fabricated breach", () => {
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "PROFIT_TARGET", numericValue: 10, valueType: "PERCENTAGE" }),
      currentBalance: 95_000, // down, not up
    });
    const result = evaluateRule(ctx);
    expect(result.percentConsumed).toBe(0);
    expect(result.state).toBe("SAFE");
  });
});

describe("PAYOUT_WAITING_PERIOD", () => {
  it("reaches TARGET_REACHED once enough days have elapsed since the stage started", () => {
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "PAYOUT_WAITING_PERIOD", numericValue: 5, valueType: "NUMERIC" }),
      stage: { startingBalance: 100_000, startDate: d("2026-01-01"), status: "ACTIVE" },
      now: d("2026-01-10"),
    });
    expect(evaluateRule(ctx).state).toBe("TARGET_REACHED");
  });

  it("is NOT_ENOUGH_DATA without a stage start date", () => {
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "PAYOUT_WAITING_PERIOD", numericValue: 5 }),
      stage: { startingBalance: 100_000, startDate: null, status: "ACTIVE" },
    });
    expect(evaluateRule(ctx).state).toBe("NOT_ENOUGH_DATA");
  });
});

describe("INACTIVITY_LIMIT", () => {
  it("measures days since the most recent ledger or execution activity", () => {
    const ctx = makeContext({
      rule: makeRule({ ruleKey: "INACTIVITY_LIMIT", numericValue: 5, valueType: "NUMERIC" }),
      ledgerEntries: [{ amount: 100, balanceAfter: 100_100, eventType: "TRADE_PNL", occurredAt: d("2026-01-08") }],
      now: d("2026-01-10"),
    });
    const result = evaluateRule(ctx);
    expect(result.currentValue?.toNumber()).toBe(2);
    expect(result.state).toBe("SAFE");
  });
});
