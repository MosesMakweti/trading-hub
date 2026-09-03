import { describe, expect, it } from "vitest";

import { summarizeStrategyVersionSnapshot } from "@/domain/strategies/version-snapshot";
import type { StrategyVersionSnapshot } from "@/types/strategies";

const full: StrategyVersionSnapshot = {
  name: "Silver Bullet",
  description: "desc",
  applicableAssets: ["EURUSD", "NAS100"],
  status: "LIVE",
  arsenalConcepts: [
    { id: "a1", name: "FVG", definition: null, purpose: null, howIIdentify: null, whyItMatters: null, whenIUse: null, whenIIgnore: null, examples: null, personalNotes: null },
  ],
  frameworkSteps: [
    { id: "f1", title: "HTF bias", description: null, notes: null },
    { id: "f2", title: "Entry", description: null, notes: null },
  ],
  timeframes: [
    { id: "t1", name: "Daily", checkpoints: [{ id: "c1", title: "Trend", description: null, notes: null }] },
    { id: "t2", name: "M15", checkpoints: [] },
  ],
  entryModels: [
    { id: "e1", name: "OB", description: null, conditions: null, confirmationChecklist: null, invalidation: null, stopPlacement: null, targetLogic: null, notes: null },
  ],
  tradeManagement: {
    id: "tm1", takeProfitPhilosophy: null, initialStopPlacement: null, breakEvenRules: null,
    trailingStopRules: null, scalingInRules: null, scalingOutRules: null,
    maxHoldingTime: "1 session", maxRiskPercent: 1,
    expectedWinRate: null, expectedAvgRr: null, expectedExpectancy: null, minExecutionScore: null,
    maxDailyRiskPercent: null, maxTradesPerDay: null,
    partialTakeProfits: [{ id: "p1", trigger: "2R", percentToClose: 50, reason: null }],
    customRules: [{ id: "r1", text: "BE at 2R" }, { id: "r2", text: "No news" }],
  },
  sessions: [
    { name: "NY AM", color: "BLUE", startMinutes: 570, endMinutes: 660, enabled: true },
  ],
  confluences: [
    { name: "HTF Bias", color: "GREEN", category: null, description: null, weight: 30, mandatory: true, validationCriteria: null, enabled: true },
    { name: "FVG", color: "AMBER", category: null, description: null, weight: 10, mandatory: false, validationCriteria: null, enabled: true },
  ],
  execution: [
    { name: "Candle Close", color: "TEAL", category: null, description: null, weight: null, mandatory: false, validationCriteria: null, enabled: true },
  ],
};

describe("summarizeStrategyVersionSnapshot", () => {
  it("counts and names the snapshot's contents", () => {
    expect(summarizeStrategyVersionSnapshot(full)).toEqual({
      applicableAssets: ["EURUSD", "NAS100"],
      arsenalCount: 1,
      frameworkStepTitles: ["HTF bias", "Entry"],
      timeframeCount: 2,
      checkpointCount: 1,
      entryModelNames: ["OB"],
      customRuleCount: 2,
      partialTpCount: 1,
      sessionCount: 1,
      confluenceCount: 2,
      mandatoryConfluenceCount: 1,
      executionCount: 1,
    });
  });

  it("is defensive against a sparse / legacy snapshot", () => {
    const sparse = {
      name: "X",
      description: null,
      applicableAssets: [],
      status: "DRAFT",
    } as unknown as StrategyVersionSnapshot;
    expect(summarizeStrategyVersionSnapshot(sparse)).toEqual({
      applicableAssets: [],
      arsenalCount: 0,
      frameworkStepTitles: [],
      timeframeCount: 0,
      checkpointCount: 0,
      entryModelNames: [],
      customRuleCount: 0,
      partialTpCount: 0,
      sessionCount: 0,
      confluenceCount: 0,
      mandatoryConfluenceCount: 0,
      executionCount: 0,
    });
  });
});
