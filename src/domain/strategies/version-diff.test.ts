import { describe, expect, it } from "vitest";

import { diffStrategyVersions } from "@/domain/strategies/version-diff";
import type { StrategyVersionSnapshot } from "@/types/strategies";

function snap(over: Partial<StrategyVersionSnapshot> = {}): StrategyVersionSnapshot {
  return {
    name: "S",
    description: null,
    applicableAssets: [],
    status: "DRAFT",
    arsenalConcepts: [],
    frameworkSteps: [],
    timeframes: [],
    entryModels: [],
    tradeManagement: null,
    ...over,
  };
}

const em = (name: string) => ({
  id: name, name, description: null, conditions: null, confirmationChecklist: null,
  invalidation: null, stopPlacement: null, targetLogic: null, notes: null,
});
const fw = (title: string) => ({ id: title, title, description: null, notes: null });

describe("diffStrategyVersions", () => {
  it("reports no changes for identical snapshots", () => {
    const s = snap({ applicableAssets: ["EURUSD"], entryModels: [em("FVG")] });
    const d = diffStrategyVersions(s, snap({ applicableAssets: ["EURUSD"], entryModels: [em("FVG")] }));
    expect(d.hasChanges).toBe(false);
  });

  it("detects scalar changes (name, status, description)", () => {
    const d = diffStrategyVersions(
      snap({ name: "A", status: "DRAFT", description: "x" }),
      snap({ name: "B", status: "LIVE", description: "y" }),
    );
    expect(d.nameChange).toEqual({ from: "A", to: "B" });
    expect(d.statusChange).toEqual({ from: "DRAFT", to: "LIVE" });
    expect(d.descriptionChanged).toBe(true);
    expect(d.hasChanges).toBe(true);
  });

  it("diffs list membership by name", () => {
    const d = diffStrategyVersions(
      snap({ entryModels: [em("FVG"), em("OB")], applicableAssets: ["EURUSD"] }),
      snap({ entryModels: [em("FVG"), em("Breaker")], applicableAssets: ["EURUSD", "NAS100"] }),
    );
    expect(d.entryModels.added).toEqual(["Breaker"]);
    expect(d.entryModels.removed).toEqual(["OB"]);
    expect(d.applicableAssets.added).toEqual(["NAS100"]);
    expect(d.applicableAssets.removed).toEqual([]);
  });

  it("flags framework reordering of common steps without added/removed", () => {
    const d = diffStrategyVersions(
      snap({ frameworkSteps: [fw("Bias"), fw("Entry"), fw("Manage")] }),
      snap({ frameworkSteps: [fw("Entry"), fw("Bias"), fw("Manage")] }),
    );
    expect(d.frameworkSteps.added).toEqual([]);
    expect(d.frameworkSteps.removed).toEqual([]);
    expect(d.frameworkSteps.reordered).toBe(true);
    expect(d.hasChanges).toBe(true);
  });

  it("does not flag reorder when only the added step shifts positions", () => {
    const d = diffStrategyVersions(
      snap({ frameworkSteps: [fw("Bias"), fw("Entry")] }),
      snap({ frameworkSteps: [fw("Bias"), fw("New"), fw("Entry")] }),
    );
    expect(d.frameworkSteps.added).toEqual(["New"]);
    expect(d.frameworkSteps.reordered).toBe(false); // common order Bias→Entry preserved
  });

  it("reports trade-management scalar changes and count deltas", () => {
    const tm = (over: Record<string, unknown>) => ({
      id: "tm", takeProfitPhilosophy: null, initialStopPlacement: null, breakEvenRules: null,
      trailingStopRules: null, scalingInRules: null, scalingOutRules: null,
      maxHoldingTime: null, maxRiskPercent: null, partialTakeProfits: [], customRules: [],
      ...over,
    });
    const d = diffStrategyVersions(
      snap({ tradeManagement: tm({ maxRiskPercent: 1, customRules: [{ id: "1", text: "a" }] }) }),
      snap({ tradeManagement: tm({ maxRiskPercent: 2, customRules: [{ id: "1", text: "a" }, { id: "2", text: "b" }], partialTakeProfits: [{ id: "p", trigger: "2R", percentToClose: 50, reason: null }] }) }),
    );
    expect(d.tradeManagement.maxRiskPercent).toEqual({ from: 1, to: 2 });
    expect(d.tradeManagement.customRuleCountDelta).toBe(1);
    expect(d.tradeManagement.partialTpCountDelta).toBe(1);
    expect(d.hasChanges).toBe(true);
  });
});
