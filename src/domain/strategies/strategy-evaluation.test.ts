import { describe, expect, it } from "vitest";

import { evaluateStrategyDecision, inWindow, type EvaluationContext } from "@/domain/strategies/strategy-evaluation";
import type { StrategyVersionSnapshot } from "@/types/strategies";

const conf = (name: string, over: Record<string, unknown> = {}) => ({
  id: `id-${name}`, name, color: "GRAY" as const, category: null, description: null, weight: 50,
  mandatory: false, directionApplicability: "BOTH" as const, pairId: null, validationCriteria: null, enabled: true, ...over,
});

function snap(over: Partial<StrategyVersionSnapshot> = {}): StrategyVersionSnapshot {
  return {
    name: "S", description: null, applicableAssets: [], status: "TESTING",
    arsenalConcepts: [], frameworkSteps: [], timeframes: [], entryModels: [], tradeManagement: null, ...over,
  };
}
const ctx = (over: Partial<EvaluationContext> = {}): EvaluationContext => ({
  localMinuteOfDay: 9 * 60, timezoneLabel: "Europe/London", tradesTodayBefore: 0, riskPercent: 1, dayRiskPercentBefore: 0, ...over,
});
const tm = (over: Record<string, unknown>) => ({
  id: "tm", takeProfitPhilosophy: null, initialStopPlacement: null, breakEvenRules: null, trailingStopRules: null,
  scalingInRules: null, scalingOutRules: null, maxHoldingTime: null, maxRiskPercent: null, expectedWinRate: null,
  expectedAvgRr: null, expectedExpectancy: null, minExecutionScore: null, maxDailyRiskPercent: null, maxTradesPerDay: null,
  partialTakeProfits: [], customRules: [], ...over,
});

describe("inWindow", () => {
  it("handles normal and overnight windows", () => {
    expect(inWindow(540, 480, 600)).toBe(true);
    expect(inWindow(600, 480, 600)).toBe(false); // end exclusive
    expect(inWindow(30, 1320, 120)).toBe(true); // 22:00–02:00 wraps midnight
    expect(inWindow(720, 1320, 120)).toBe(false);
  });
});

describe("evaluateStrategyDecision", () => {
  it("scores confirmed confluences with the existing engine and flags missing mandatory ones", () => {
    const e = evaluateStrategyDecision({
      snapshot: snap({ confluences: [conf("Sweep", { mandatory: true }), conf("FVG"), conf("Bear only", { directionApplicability: "BEARISH" })] }),
      direction: "LONG",
      checkedNames: ["FVG", "Bear only"],
      context: ctx(),
    });
    expect(e.score).toBe(50); // FVG 50 of eligible 100 (bear-only excluded)
    expect(e.missingMandatory).toEqual(["Sweep"]);
    expect(e.ineligibleChecked).toEqual(["Bear only"]);
    expect(e.checks.find((c) => c.rule === "MANDATORY_CONDITIONS")?.status).toBe("FAIL");
    expect(e.followedRules).toBe(false);
  });

  it("ignores disabled confluences and requires mandatory execution confirmations", () => {
    const e = evaluateStrategyDecision({
      snapshot: snap({ confluences: [conf("Off", { enabled: false, mandatory: true })], execution: [conf("Retest", { mandatory: true })] }),
      direction: "SHORT",
      checkedNames: [],
      context: ctx(),
    });
    expect(e.missingMandatory).toEqual(["Retest"]);
  });

  it("uses the setup-type scenario for the trade's direction, and refuses a missing one", () => {
    const setupTypes = [{
      name: "Type A", description: null,
      scenarios: [{ direction: "BULLISH" as const, name: "Bullish", description: null, conditions: [
        { checklistItemId: "a", name: "MSB", directionApplicability: "BULLISH" as const, mandatory: true, weight: 60, sortOrder: 0 },
        { checklistItemId: "b", name: "Disabled", directionApplicability: "BOTH" as const, mandatory: true, weight: 40, sortOrder: 1, enabled: false },
      ] }],
    }];
    const long = evaluateStrategyDecision({ snapshot: snap({ setupTypes }), direction: "LONG", setupTypeName: "Type A", checkedNames: ["MSB"], context: ctx() });
    expect(long.setupType).toEqual({ name: "Type A", scenario: "Bullish" });
    expect(long.score).toBe(100);
    expect(long.missingMandatory).toEqual([]);
    const short = evaluateStrategyDecision({ snapshot: snap({ setupTypes }), direction: "SHORT", setupTypeName: "Type A", checkedNames: [], context: ctx() });
    expect(short.setupType).toBeNull();
    expect(short.checks[0]).toMatchObject({ label: "Setup type", status: "FAIL" });
  });

  it("evaluates sessions, trades per day, risk, daily risk and minimum score automatically", () => {
    const snapshot = snap({
      confluences: [conf("FVG", { weight: 100 })],
      sessions: [{ name: "London", color: "GRAY", startMinutes: 8 * 60, endMinutes: 11 * 60, enabled: true }],
      tradeManagement: tm({ maxTradesPerDay: 2, maxRiskPercent: 1, maxDailyRiskPercent: 2, minExecutionScore: 80 }),
    });
    const ok = evaluateStrategyDecision({ snapshot, direction: "LONG", checkedNames: ["FVG"], context: ctx({ tradesTodayBefore: 1, dayRiskPercentBefore: 1 }) });
    expect(ok.session).toBe("London");
    expect(ok.checks.map((c) => [c.rule, c.status])).toEqual([
      ["MANDATORY_CONDITIONS", "PASS"], // conditions exist, none mandatory
      ["SESSION", "PASS"],
      ["MAX_TRADES_PER_DAY", "PASS"],
      ["MAX_RISK_PER_TRADE", "PASS"],
      ["MAX_DAILY_RISK", "PASS"],
      ["MIN_EXECUTION_SCORE", "PASS"],
    ]);
    expect(ok.followedRules).toBe(true);

    const bad = evaluateStrategyDecision({
      snapshot, direction: "LONG", checkedNames: [],
      context: ctx({ localMinuteOfDay: 14 * 60, tradesTodayBefore: 2, riskPercent: 1.5, dayRiskPercentBefore: 1 }),
    });
    expect(bad.session).toBeNull();
    expect(bad.checks.filter((c) => c.status === "FAIL").map((c) => c.rule)).toEqual([
      "SESSION", "MAX_TRADES_PER_DAY", "MAX_RISK_PER_TRADE", "MAX_DAILY_RISK", "MIN_EXECUTION_SCORE",
    ]);
  });

  it("reports what it could not evaluate instead of guessing", () => {
    const e = evaluateStrategyDecision({
      snapshot: snap({
        sessions: [{ name: "London", color: "GRAY", startMinutes: 480, endMinutes: 660, enabled: true }],
        tradeManagement: tm({ maxRiskPercent: 1 }),
        frameworkSteps: [{ id: "f", title: "HTF bias", description: null, notes: null }],
        entryModels: [{ id: "m", name: "FVG", description: null, conditions: null, confirmationChecklist: null, invalidation: null, stopPlacement: null, targetLogic: null, notes: null }],
      }),
      direction: "LONG",
      checkedNames: [],
      context: ctx({ localMinuteOfDay: null, riskPercent: null }),
    });
    expect(e.checks.find((c) => c.rule === "SESSION")?.status).toBe("NOT_EVALUATED");
    expect(e.checks.find((c) => c.rule === "MAX_RISK_PER_TRADE")?.status).toBe("NOT_EVALUATED");
    expect(e.manualOnly).toEqual(["Framework", "Entry models"]);
    expect(e.followedRules).toBe(true); // NOT_EVALUATED never counts as a failure
  });
});
