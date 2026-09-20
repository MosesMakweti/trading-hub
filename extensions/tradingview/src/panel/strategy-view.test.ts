import { describe, expect, it } from "vitest";

import { EMPTY_DRAFT, type TradeDraftContext } from "@shared/draft";
import type { StrategyReference, StrategySummary } from "@shared/strategy";
import type { StrategyLoadState } from "./strategy-loader";
import { toStrategyContextViewModel } from "./strategy-view";

const STRATEGIES: StrategySummary[] = [{ id: "s1", name: "London Continuation", version: 1, status: "LIVE" }];

const STRATEGY: StrategyReference = {
  id: "s1",
  name: "London Continuation",
  version: 1,
  applicableAssets: ["XAUUSD"],
  entryModels: ["Sweep + Displacement"],
  frameworkSteps: ["HTF bias", "Liquidity sweep", "Entry"],
  sessions: [{ name: "London", color: "BLUE" }],
  confluences: [
    { id: "c-bull", name: "Bullish sweep", color: "GRAY", category: "Structure", weight: 40, mandatory: true, directionApplicability: "BULLISH", pairId: null },
    { id: "c-bear", name: "Bearish sweep", color: "GRAY", category: "Structure", weight: 40, mandatory: true, directionApplicability: "BEARISH", pairId: null },
    { id: "c-both", name: "HTF support", color: "GRAY", category: null, weight: 20, mandatory: false, directionApplicability: "BOTH", pairId: null },
  ],
  execution: [{ id: "e1", name: "Candle close", color: "GRAY", category: null, weight: null, mandatory: false, directionApplicability: "BOTH", pairId: null }],
  tradeManagement: { maxRiskPercent: 1, maxHoldingTime: "2 hours", customRules: ["Move to BE after TP1"], partialTakeProfits: [] },
  setupTypes: [],
};

const IDLE: StrategyLoadState = { status: "idle" };
const LOADED: StrategyLoadState = { status: "loaded", strategyId: "s1", strategy: STRATEGY };

describe("toStrategyContextViewModel", () => {
  it("hides the whole section while disconnected", () => {
    const vm = toStrategyContextViewModel({ connected: false, strategies: [], draft: EMPTY_DRAFT, loader: IDLE });
    expect(vm.show).toBe(false);
  });

  it("shows the strategy picker once connected, even before anything is selected", () => {
    const vm = toStrategyContextViewModel({ connected: true, strategies: STRATEGIES, draft: EMPTY_DRAFT, loader: IDLE });
    expect(vm.show).toBe(true);
    expect(vm.strategies).toEqual(STRATEGIES);
    expect(vm.selectedStrategyId).toBeNull();
  });

  it("reflects the loading state while a strategy reference is being fetched", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1" };
    const vm = toStrategyContextViewModel({ connected: true, strategies: STRATEGIES, draft, loader: { status: "loading", strategyId: "s1" } });
    expect(vm.loading).toBe(true);
    expect(vm.entryModels).toEqual([]); // nothing fabricated while loading
  });

  it("surfaces a load error message and fabricates no strategy data", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1" };
    const vm = toStrategyContextViewModel({
      connected: true,
      strategies: STRATEGIES,
      draft,
      loader: { status: "error", strategyId: "s1", message: "Could not reach Traditorium." },
    });
    expect(vm.loadErrorMessage).toBe("Could not reach Traditorium.");
    expect(vm.sessionNames).toEqual([]);
    expect(vm.confluences).toEqual([]);
  });

  it("exposes sessions/entry models by NAME once loaded — no ids fabricated", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1" };
    const vm = toStrategyContextViewModel({ connected: true, strategies: STRATEGIES, draft, loader: LOADED });
    expect(vm.sessionNames).toEqual(["London"]);
    expect(vm.entryModels).toEqual(["Sweep + Displacement"]);
  });

  it("§6 — LONG shows only BULLISH + BOTH confluences", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: "LONG" };
    const vm = toStrategyContextViewModel({ connected: true, strategies: STRATEGIES, draft, loader: LOADED });
    expect(vm.confluences.map((c) => c.id)).toEqual(["c-bull", "c-both"]);
  });

  it("§6 — SHORT shows only BEARISH + BOTH confluences", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: "SHORT" };
    const vm = toStrategyContextViewModel({ connected: true, strategies: STRATEGIES, draft, loader: LOADED });
    expect(vm.confluences.map((c) => c.id)).toEqual(["c-bear", "c-both"]);
  });

  it("shows no confluences at all when no direction has been chosen yet", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: null };
    const vm = toStrategyContextViewModel({ connected: true, strategies: STRATEGIES, draft, loader: LOADED });
    expect(vm.confluences).toEqual([]);
  });

  it("execution confirmations are never direction-filtered", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: "SHORT" };
    const vm = toStrategyContextViewModel({ connected: true, strategies: STRATEGIES, draft, loader: LOADED });
    expect(vm.execution.map((e) => e.id)).toEqual(["e1"]);
  });

  it("marks a confluence checked when its id is in the draft's selection, with real mandatory/weight metadata", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: "LONG", selectedConfluenceIds: ["c-bull"] };
    const vm = toStrategyContextViewModel({ connected: true, strategies: STRATEGIES, draft, loader: LOADED });
    const row = vm.confluences.find((c) => c.id === "c-bull")!;
    expect(row.checked).toBe(true);
    expect(row.mandatory).toBe(true);
    expect(row.weight).toBe(40);
  });

  it("§12 — Strategy Rules summarizes framework steps and trade management only when the strategy has some", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1" };
    const vm = toStrategyContextViewModel({ connected: true, strategies: STRATEGIES, draft, loader: LOADED });
    expect(vm.rules.show).toBe(true);
    expect(vm.rules.frameworkStepCount).toBe(3);
    expect(vm.rules.tradeManagement).toEqual(STRATEGY.tradeManagement);
  });

  it("Strategy Rules stays hidden for a strategy with neither framework steps nor trade management", () => {
    const bare: StrategyLoadState = { status: "loaded", strategyId: "s2", strategy: { ...STRATEGY, id: "s2", frameworkSteps: [], tradeManagement: null } };
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s2" };
    const vm = toStrategyContextViewModel({ connected: true, strategies: STRATEGIES, draft, loader: bare });
    expect(vm.rules.show).toBe(false);
  });

  it("§22 — validation never flags a direction-ineligible mandatory confluence as missing", () => {
    const draft: TradeDraftContext = { ...EMPTY_DRAFT, strategyId: "s1", direction: "LONG" };
    const vm = toStrategyContextViewModel({ connected: true, strategies: STRATEGIES, draft, loader: LOADED });
    // c-bear is mandatory but BEARISH-only — must not appear for a LONG draft.
    expect(vm.validation.missingMandatoryConfluenceIds).toEqual(["c-bull"]);
  });
});
