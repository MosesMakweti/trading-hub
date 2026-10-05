import { describe, expect, it } from "vitest";

import {
  deriveClosePerformance,
  deriveCloseProcess,
  deriveNeedsAttention,
  hasDayReflection,
  type CloseTradeFacts,
} from "./close-day";

const base: CloseTradeFacts = {
  id: "t1",
  tradeNumber: 1,
  assetSymbol: "XAUUSD",
  direction: "LONG",
  carried: false,
  tradeDateKey: "2026-08-03",
  reviewState: "FINAL_REVIEW_COMPLETE",
  hasEarlierReview: false,
  missingReviewCount: 0,
  hasActualEntry: true,
  cancelled: false,
  closed: true,
  exitedPercent: 100,
  settled: true,
  hasPerformanceSnapshot: true,
  resolvedInitialStop: 1890,
  settledRealizedR: 1,
  settledPnl: 100,
  storedLifecycle: "FULLY_CLOSED",
  performanceRiskPercent: 1,
  adherenceAnswers: { followedStrategy: true, followedEntryModel: true, followedTradeManagement: true, remainedPatient: true },
  tradeIntent: "PLANNED",
  wouldTakeAgain: true,
  psychologyPercent: 80,
  setupScore: 90,
  setupValid: true,
  setupOverridden: false,
  executionPercent: 75,
  tradeQualityPercent: 85,
  hasLimitOverride: false,
};
const t = (o: Partial<CloseTradeFacts>): CloseTradeFacts => ({ ...base, ...o });

describe("deriveClosePerformance", () => {
  it("classifies only settled trades — an open trade in profit is never a win", () => {
    const p = deriveClosePerformance(
      [
        t({ id: "win" }),
        t({ id: "open", closed: false, settled: false, exitedPercent: null, settledRealizedR: null, settledPnl: null }),
        t({ id: "loss", settledRealizedR: -1, settledPnl: -100 }),
      ],
      [],
    );
    expect(p).toMatchObject({ executed: 3, settled: 2, wins: 1, losses: 1, breakevens: 0, open: 1, settledR: 0, settledPnl: 0, winRatePercent: 50 });
  });

  it("keeps cancelled, missed and carried distinct from executed / Trades Used / risk", () => {
    const p = deriveClosePerformance(
      [
        t({ id: "cancel", cancelled: true, hasActualEntry: false, closed: false, settled: false, performanceRiskPercent: null }),
        t({ id: "carried", carried: true, closed: false, settled: false }),
        t({ id: "idea", hasActualEntry: false, closed: false, settled: false, performanceRiskPercent: null, settledRealizedR: null }),
      ],
      [{ setupValid: true }, { setupValid: false }, { setupValid: null }],
    );
    expect(p).toMatchObject({ ideas: 2, executed: 0, cancelled: 1, missed: 3, missedValid: 1, riskUsedPercent: 0, settled: 0, winRatePercent: null });
  });

  it("separates fully exited but unsettled trades as pending settlement", () => {
    const p = deriveClosePerformance([t({ settled: false, settledRealizedR: null, settledPnl: null })], []);
    expect(p).toMatchObject({ settled: 0, pendingSettlement: 1, wins: 0 });
  });
});

describe("deriveCloseProcess", () => {
  it("is read from the trades' answers, independent of outcome", () => {
    const p = deriveCloseProcess([
      t({ id: "a", settledRealizedR: 3, adherenceAnswers: { followedStrategy: false, remainedPatient: false } }),
      t({ id: "b", settledRealizedR: -1, hasLimitOverride: true, setupOverridden: true, wouldTakeAgain: false, tradeIntent: "FOMO" }),
    ]);
    const strategy = p.adherence.find((a) => a.key === "followedStrategy");
    expect(strategy).toMatchObject({ yes: 1, no: 1, unanswered: 0 });
    expect(p.adherence.find((a) => a.key === "followedEntryModel")).toMatchObject({ yes: 1, no: 0, unanswered: 1 });
    expect(p).toMatchObject({ executed: 2, limitOverrides: 1, setupOverrides: 1, wouldNotTakeAgain: 1, motives: { PLANNED: 1, FOMO: 1 } });
  });
});

describe("deriveNeedsAttention", () => {
  it("emits each rule from facts, in a stable order, with neutral wording", () => {
    const items = deriveNeedsAttention([
      t({ id: "interim", reviewState: "FINAL_REVIEW_REQUIRED", hasEarlierReview: true }),
      t({ id: "open", reviewState: "INTERIM_AVAILABLE", closed: false, settled: false, exitedPercent: 40, storedLifecycle: "PARTIALLY_CLOSED" }),
      t({ id: "nostop", reviewState: "INTERIM_AVAILABLE", closed: false, settled: false, resolvedInitialStop: null, storedLifecycle: "STILL_HOLDING" }),
      t({ id: "pending", reviewState: "FINAL_REVIEW_REQUIRED", settled: false, missingReviewCount: 2 }),
      t({ id: "contra", reviewState: "INTERIM_AVAILABLE", closed: false, settled: false, storedLifecycle: "FULLY_CLOSED" }),
      t({ id: "proc", hasLimitOverride: true, adherenceAnswers: { followedTradeManagement: false } }),
    ]);
    const kinds = items.map((i) => `${i.kind}:${i.tradeId}`);
    expect(kinds).toEqual([
      "FINAL_REVIEW_REQUIRED:interim",
      "FINAL_REVIEW_REQUIRED:pending",
      "OPEN_POSITION:open",
      "OPEN_POSITION:nostop",
      "OPEN_POSITION:contra",
      "MISSING_EXECUTION_FACTS:nostop",
      "PERFORMANCE_PENDING:pending",
      "CONTRADICTORY_STATE:contra",
      "PROCESS_EXCEPTION:proc",
    ]);
    expect(items.find((i) => i.tradeId === "open" && i.kind === "OPEN_POSITION")?.detail).toMatch(/^60% still open/);
    expect(items.find((i) => i.kind === "PROCESS_EXCEPTION")?.detail).toBe("Daily-limit override · Management rules not followed");
    expect(items.every((i) => !/bad/i.test(`${i.title} ${i.detail}`))).toBe(true);
  });

  it("does not invent warnings: no snapshot → no 'missing facts', complete day → nothing", () => {
    expect(deriveNeedsAttention([t({})])).toEqual([]);
    const noSnap = deriveNeedsAttention([
      t({ hasPerformanceSnapshot: false, resolvedInitialStop: null, closed: false, settled: false, storedLifecycle: "STILL_HOLDING" }),
    ]);
    expect(noSnap.map((i) => i.kind)).toEqual(["OPEN_POSITION"]);
    expect(deriveNeedsAttention([t({ cancelled: true, hasActualEntry: false, reviewState: "CANCELLED", closed: false, settled: false })])).toEqual([]);
  });
});

describe("hasDayReflection", () => {
  it("only looks at the four day-reflection fields", () => {
    expect(hasDayReflection({ dayWentWell: null, dayToImprove: null, dayMainLesson: null, dayCarryForward: null })).toBe(false);
    expect(hasDayReflection({ dayWentWell: "  ", dayToImprove: null, dayMainLesson: null, dayCarryForward: null })).toBe(false);
    expect(hasDayReflection({ dayWentWell: null, dayToImprove: null, dayMainLesson: null, dayCarryForward: "Focus" })).toBe(true);
  });
});
