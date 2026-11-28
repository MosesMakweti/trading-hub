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
      maxHoldingTime: null, maxRiskPercent: null,
      expectedWinRate: null, expectedAvgRr: null, expectedExpectancy: null, minExecutionScore: null,
      maxDailyRiskPercent: null, maxTradesPerDay: null,
      partialTakeProfits: [], customRules: [],
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

// ── Comprehensive diff (audit #3) ────────────────────────────────────────────
const conf = (name: string, over: Record<string, unknown> = {}) => ({
  id: `id-${name}-${Math.random()}`, name, color: "GRAY" as const, category: null, description: null,
  weight: 10, mandatory: false, directionApplicability: "BOTH" as const, pairId: null,
  validationCriteria: null, enabled: true, icon: null, ...over,
});
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const section = (d: ReturnType<typeof diffStrategyVersions>, key: string) => d.sections.find((s) => s.key === key);

describe("diffStrategyVersions — detailed sections", () => {
  it("detects confluence weight / mandatory / direction / enabled changes (was reported as 'no changes')", () => {
    const d = diffStrategyVersions(
      snap({ confluences: [conf("MSB", { weight: 10 })] }),
      snap({ confluences: [conf("MSB", { weight: 90, mandatory: true, directionApplicability: "BULLISH", enabled: false })] }),
    );
    expect(d.hasChanges).toBe(true);
    expect(d.affectsScoring).toBe(true);
    const entry = section(d, "confluences")!.entries[0];
    expect(entry).toMatchObject({ change: "changed", subject: "MSB" });
    expect(entry.fields.map((f) => [f.field, f.from, f.to])).toEqual([
      ["Weight", "10", "90"],
      ["Mandatory", "No", "Yes"],
      ["Direction", "Both", "Bullish (long)"],
      ["Enabled", "Yes", "No"],
    ]);
  });

  it("detects added / removed confluences and execution items", () => {
    const d = diffStrategyVersions(
      snap({ confluences: [conf("A")], execution: [conf("Retest")] }),
      snap({ confluences: [conf("B")], execution: [] }),
    );
    expect(section(d, "confluences")!.entries.map((e) => [e.change, e.subject])).toEqual([["added", "B"], ["removed", "A"]]);
    expect(section(d, "execution")!.entries).toEqual([{ change: "removed", subject: "Retest", fields: [] }]);
  });

  it("detects session additions and window changes", () => {
    const s = (name: string, start: number | null) => ({ name, color: "GRAY" as const, startMinutes: start, endMinutes: 600, enabled: true });
    const d = diffStrategyVersions(snap({ sessions: [s("London", 420)] }), snap({ sessions: [s("London", 480), s("NY", 780)] }));
    const entries = section(d, "sessions")!.entries;
    expect(entries).toContainEqual({ change: "added", subject: "NY", fields: [] });
    expect(entries).toContainEqual({ change: "changed", subject: "London", fields: [{ field: "Start", from: "07:00", to: "08:00" }] });
  });

  it("detects setup-type scenario and condition changes", () => {
    const cond = (name: string, over: Record<string, unknown> = {}) => ({
      checklistItemId: `x-${Math.random()}`, name, directionApplicability: "BOTH" as const, mandatory: false, weight: 10, sortOrder: 0, ...over,
    });
    const scenario = (conds: ReturnType<typeof cond>[], over: Record<string, unknown> = {}) => ({
      direction: "BULLISH" as const, name: "Bullish", description: null, conditions: conds,
      customType: null, instruments: [] as string[], timeframes: [] as string[], ...over,
    });
    const d = diffStrategyVersions(
      snap({ setupTypes: [{ name: "Type A", description: null, scenarios: [scenario([cond("MSB"), cond("Sweep")])] }] }),
      snap({ setupTypes: [{ name: "Type A", description: null, scenarios: [scenario([cond("MSB", { mandatory: true }), cond("Displacement")], { instruments: ["XAUUSD"], customType: "Judas" })] }] }),
    );
    const entry = section(d, "setupTypes")!.entries[0];
    expect(entry.subject).toBe("Type A › Bullish");
    expect(entry.fields.map((f) => f.field)).toEqual([
      "Custom type", "Instruments", "Condition added", "Condition removed", "MSB · mandatory",
    ]);
  });

  it("detects trade-management targets, partial TPs and rich-text content changes", () => {
    const tm = (over: Record<string, unknown>) => ({
      id: "tm", takeProfitPhilosophy: null, initialStopPlacement: null, breakEvenRules: null, trailingStopRules: null,
      scalingInRules: null, scalingOutRules: null, maxHoldingTime: null, maxRiskPercent: null,
      expectedWinRate: null, expectedAvgRr: null, expectedExpectancy: null, minExecutionScore: null,
      maxDailyRiskPercent: null, maxTradesPerDay: null, partialTakeProfits: [], customRules: [], ...over,
    });
    const d = diffStrategyVersions(
      snap({ tradeManagement: tm({ expectedWinRate: 40, maxTradesPerDay: 3, takeProfitPhilosophy: doc("2R") }) }),
      snap({ tradeManagement: tm({ expectedWinRate: 50, maxTradesPerDay: 2, takeProfitPhilosophy: doc("3R"), minExecutionScore: 70 }) }),
    );
    const fields = section(d, "tradeManagement")!.entries[0].fields;
    expect(fields.map((f) => [f.field, f.from, f.to])).toEqual([
      ["Expected win rate", "40%", "50%"],
      ["Min execution score", "—", "70"],
      ["Max trades per day", "3", "2"],
      ["Take-profit philosophy", "2R", "3R"],
    ]);
    expect(d.affectsScoring).toBe(false);
  });

  it("detects rich-text edits in entry models", () => {
    const d = diffStrategyVersions(
      snap({ entryModels: [{ ...em("FVG"), invalidation: doc("close below") }] }),
      snap({ entryModels: [{ ...em("FVG"), invalidation: doc("close below low") }] }),
    );
    expect(section(d, "entryModels")!.entries[0].fields).toEqual([
      { field: "Invalidation", from: "close below", to: "close below low" },
    ]);
  });

  it("reports NO changes for differences in ids, JSON key order or empty rich-text documents", () => {
    const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };
    const a = snap({
      confluences: [conf("MSB", { id: "a1" })],
      entryModels: [{ ...em("FVG"), id: "e1", notes: null }],
      tradeManagement: null,
    });
    const b = snap({
      confluences: [conf("MSB", { id: "zzz" })],
      entryModels: [{ ...em("FVG"), id: "e2", notes: emptyDoc }],
      tradeManagement: null,
    });
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reverseKeys)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]))
        : v;
    expect(diffStrategyVersions(a, b).hasChanges).toBe(false);
    expect(diffStrategyVersions(a, reverseKeys(b) as StrategyVersionSnapshot).hasChanges).toBe(false);
  });

  it("does not flag fields that only newer snapshots record", () => {
    const legacy = conf("MSB");
    delete (legacy as { icon?: unknown }).icon;
    const d = diffStrategyVersions(snap({ confluences: [legacy] }), snap({ confluences: [conf("MSB", { icon: "star" })] }));
    expect(d.hasChanges).toBe(false);
  });
});
