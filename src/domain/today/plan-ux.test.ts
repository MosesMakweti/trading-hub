import { describe, expect, it } from "vitest";

import { summarizeDayRules } from "./rule-suggestions";
import { phaseAfterPlan } from "./day-phase";

const A = { strategyId: "a", strategyName: "London Sweep", maxDailyRiskPercent: 2, maxTradesPerDay: 3 };
const B = { strategyId: "b", strategyName: "NY Reversal", maxDailyRiskPercent: 1.5, maxTradesPerDay: 4 };
const none = { riskBudgetPercent: null, maxTradesPerDay: null };

describe("summarizeDayRules (compact Plan rules line)", () => {
  it("shows inherited Strategy Lab values and confirms them in one patch (strictest wins)", () => {
    const s = summarizeDayRules([A, B], none);
    expect(s.risk).toEqual({ value: 1.5, state: "SUGGESTED" });
    expect(s.maxTrades).toEqual({ value: 3, state: "SUGGESTED" });
    expect(s.allConfirmed).toBe(false);
    expect(s.confirmPatch).toEqual({ riskBudgetPercent: 1.5, maxTradesPerDay: 3 });
  });

  it("never overwrites a value the trader already confirmed, even if different", () => {
    const s = summarizeDayRules([A], { riskBudgetPercent: 1, maxTradesPerDay: null });
    expect(s.risk).toEqual({ value: 1, state: "CONFIRMED_DIFFERENT" });
    expect(s.confirmPatch).toEqual({ maxTradesPerDay: 3 });
    const done = summarizeDayRules([A], { riskBudgetPercent: 2, maxTradesPerDay: 3 });
    expect(done.allConfirmed).toBe(true);
    expect(done.confirmPatch).toBeNull();
  });

  it("falls back cleanly when Strategy Lab has no limits", () => {
    const s = summarizeDayRules([{ ...A, maxDailyRiskPercent: null, maxTradesPerDay: null }], none);
    expect(s).toMatchObject({ noLimits: true, allConfirmed: true, confirmPatch: null });
    expect(s.risk.value).toBeNull();
    const manual = summarizeDayRules([], { riskBudgetPercent: 2, maxTradesPerDay: null });
    expect(manual).toMatchObject({ noLimits: false, allConfirmed: true });
    expect(manual.risk).toEqual({ value: 2, state: "CONFIRMED_MANUAL" });
  });
});

describe("summarizeDayRules — sessions", () => {
  it("adopts strategy sessions only when the day lists none, in the same Confirm", () => {
    const s = summarizeDayRules([A], { riskBudgetPercent: 2, maxTradesPerDay: 3 }, { active: [], strategySessions: [["London"], ["New York", "london"]] });
    expect(s.sessions).toEqual({ names: ["London", "New York"], suggested: true });
    expect(s.confirmPatch).toEqual({ activeSessions: ["London", "New York"] });
    expect(s.allConfirmed).toBe(false);
    const own = summarizeDayRules([A], { riskBudgetPercent: 2, maxTradesPerDay: 3 }, { active: ["Asia"], strategySessions: [["London"]] });
    expect(own.sessions).toEqual({ names: ["Asia"], suggested: false });
    expect(own.confirmPatch).toBeNull();
  });
});

describe("phaseAfterPlan", () => {
  it("continues to Trade once ready, otherwise to Prepare (readiness gates trading only)", () => {
    expect(phaseAfterPlan(true)).toBe("trade");
    expect(phaseAfterPlan(false)).toBe("prepare");
  });
});
