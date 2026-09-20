import { describe, expect, it } from "vitest";

import { EMPTY_DRAFT, type TradeDraftContext } from "./draft";
import type { StrategyReference } from "./strategy";
import type { TradingViewChartContext } from "./chart-context";
import { DEFAULT_BIAS_CONFIDENCE_PERCENT, DEFAULT_EXECUTION_MINUTES, DEFAULT_HIGHER_TIMEFRAME_BIAS, buildCreateTradePayload } from "./trade-payload";

const CHART: TradingViewChartContext = {
  symbol: { raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" },
  timeframe: "5m",
  detected: true,
  symbolSource: "url",
  timeframeSource: "title",
  updatedAt: 1,
};

const STRATEGY: StrategyReference = {
  id: "s1",
  name: "London Continuation",
  version: 1,
  applicableAssets: ["XAUUSD"],
  entryModels: ["Sweep + Displacement"],
  frameworkSteps: [],
  sessions: [{ name: "London", color: "BLUE" }],
  confluences: [
    { id: "c-bull", name: "Liquidity Sweep", color: "GRAY", category: null, weight: 40, mandatory: true, directionApplicability: "BULLISH", pairId: null },
    { id: "c-both", name: "HTF Support", color: "GRAY", category: null, weight: 20, mandatory: false, directionApplicability: "BOTH", pairId: null },
  ],
  execution: [{ id: "e1", name: "Displacement", color: "GRAY", category: null, weight: null, mandatory: false, directionApplicability: "BOTH", pairId: null }],
  tradeManagement: null,
  setupTypes: [],
};

function readyDraft(overrides: Partial<TradeDraftContext> = {}): TradeDraftContext {
  return {
    ...EMPTY_DRAFT,
    strategyId: "s1",
    direction: "LONG",
    selectedSession: "London",
    selectedEntryModel: "Sweep + Displacement",
    selectedConfluenceIds: ["c-bull", "c-both"],
    selectedExecutionIds: ["e1"],
    plannedEntry: "3640",
    plannedStopLoss: "3630",
    plannedTargets: [
      { id: "t1", label: "TP1", targetPrice: "3660" },
      { id: "t2", label: "TP2", targetPrice: "3670" },
    ],
    marketContext: "Strong bullish structure",
    ...overrides,
  };
}

const FIXED_NOW = () => new Date(2026, 0, 15, 10, 0, 0);

describe("buildCreateTradePayload — the happy path", () => {
  it("maps a fully-filled draft to the exact canonical payload shape", () => {
    const result = buildCreateTradePayload({ draft: readyDraft(), chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toEqual([]);
    expect(result.payload).toEqual({
      dateKey: "2026-01-15",
      trade: {
        assetSymbol: "XAUUSD",
        executionMinutes: DEFAULT_EXECUTION_MINUTES,
        direction: "LONG",
        higherTimeframeBias: DEFAULT_HIGHER_TIMEFRAME_BIAS,
        biasConfidencePercent: DEFAULT_BIAS_CONFIDENCE_PERCENT,
        strategyId: "s1",
        selectedSession: "London",
        selectedEntryModel: "Sweep + Displacement",
        selectedConfluences: ["Liquidity Sweep", "HTF Support"],
        selectedExecution: ["Displacement"],
      },
      plan: {
        timeframe: "5m",
        entry: 3640,
        stopLoss: 3630,
        targets: [
          { targetOrder: 1, label: "TP1", targetPrice: 3660 },
          { targetOrder: 2, label: "TP2", targetPrice: 3670 },
        ],
      },
      notes: { marketContext: "Strong bullish structure" },
    });
  });

  it("§2 — chart symbol maps to trade.assetSymbol using the parsed DISPLAY symbol, never the raw exchange-qualified one", () => {
    const result = buildCreateTradePayload({ draft: readyDraft(), chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload!.trade.assetSymbol).toBe("XAUUSD");
    expect(result.payload!.trade.assetSymbol).not.toContain("OANDA");
  });

  it("chart timeframe maps to plan.timeframe, never onto the trade object itself", () => {
    const result = buildCreateTradePayload({ draft: readyDraft(), chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload!.plan.timeframe).toBe("5m");
    expect(result.payload!.trade).not.toHaveProperty("timeframe");
  });

  it("omits plan.timeframe when the chart has no detected timeframe, rather than sending null explicitly", () => {
    const noTimeframe: TradingViewChartContext = { ...CHART, timeframe: null };
    const result = buildCreateTradePayload({ draft: readyDraft(), chartContext: noTimeframe, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload!.plan.timeframe).toBeUndefined();
  });

  it("a freeform trade with no strategy selected is a valid payload — strategy is not a hard requirement", () => {
    const draft = readyDraft({ strategyId: null, selectedSession: null, selectedEntryModel: null, selectedConfluenceIds: [], selectedExecutionIds: [] });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: null, now: FIXED_NOW });
    expect(result.blockers).toEqual([]);
    expect(result.payload!.trade.strategyId).toBeUndefined();
  });

  it("multi-target ordering is preserved and re-numbered by array position, skipping empty rows", () => {
    const draft = readyDraft({
      plannedTargets: [
        { id: "t1", label: "TP1", targetPrice: "3660" },
        { id: "t-empty", label: "TP2", targetPrice: "" }, // never touched — silently excluded
        { id: "t2", label: "TP3", targetPrice: "3680" },
      ],
    });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload!.plan.targets).toEqual([
      { targetOrder: 1, label: "TP1", targetPrice: 3660 },
      { targetOrder: 2, label: "TP3", targetPrice: 3680 },
    ]);
  });
});

describe("buildCreateTradePayload — asset compatibility (§5)", () => {
  it("an exact asset match is accepted", () => {
    const result = buildCreateTradePayload({ draft: readyDraft(), chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers.some((b) => b.reason === "asset_incompatible")).toBe(false);
  });

  it("an exchange-qualified chart symbol still matches via the already-parsed display symbol", () => {
    const qualified: TradingViewChartContext = { ...CHART, symbol: { raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" } };
    const result = buildCreateTradePayload({ draft: readyDraft(), chartContext: qualified, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers.some((b) => b.reason === "asset_incompatible")).toBe(false);
  });

  it("blocks submission when the strategy doesn't support the detected asset", () => {
    const eurusd: TradingViewChartContext = { ...CHART, symbol: { raw: "FX:EURUSD", display: "EURUSD", exchange: "FX" } };
    const result = buildCreateTradePayload({ draft: readyDraft(), chartContext: eurusd, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload).toBeNull();
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "asset_incompatible" }));
  });

  it("never guesses on an ambiguous/ungrounded asset — no strategy loaded means it cannot be checked, so it's held up by strategy_not_loaded instead of silently passing", () => {
    const draft = readyDraft();
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: null, now: FIXED_NOW });
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "strategy_not_loaded" }));
  });
});

describe("buildCreateTradePayload — confluence/execution id -> name resolution (§12)", () => {
  it("resolves every selected id to its canonical name", () => {
    const result = buildCreateTradePayload({ draft: readyDraft(), chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload!.trade.selectedConfluences).toEqual(["Liquidity Sweep", "HTF Support"]);
    expect(result.payload!.trade.selectedExecution).toEqual(["Displacement"]);
  });

  it("blocks submission when a selected confluence id no longer exists on the loaded strategy", () => {
    const draft = readyDraft({ selectedConfluenceIds: ["c-bull", "does-not-exist"] });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload).toBeNull();
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "unresolved_confluence" }));
  });

  it("blocks submission when a selected execution id no longer exists", () => {
    const draft = readyDraft({ selectedExecutionIds: ["does-not-exist"] });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "unresolved_execution" }));
  });

  it("§14 — blocks a selected confluence that's no longer eligible for the current direction", () => {
    // c-bull is BULLISH-only; re-check against SHORT.
    const draft = readyDraft({ direction: "SHORT" });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "unresolved_confluence" }));
  });

  it("blocks when a session was selected but no longer exists on the strategy", () => {
    const draft = readyDraft({ selectedSession: "Tokyo" });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "unresolved_session" }));
  });

  it("blocks when an entry model was selected but no longer exists on the strategy", () => {
    const draft = readyDraft({ selectedEntryModel: "Breaker Retest" });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "unresolved_entry_model" }));
  });
});

describe("buildCreateTradePayload — plan validation", () => {
  it("blocks when the chart has no detected symbol at all", () => {
    const result = buildCreateTradePayload({ draft: readyDraft(), chartContext: null, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "no_symbol" }));
  });

  it("blocks when direction hasn't been chosen", () => {
    const result = buildCreateTradePayload({ draft: readyDraft({ direction: null }), chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "direction_required" }));
  });

  it("blocks when entry is empty", () => {
    const result = buildCreateTradePayload({ draft: readyDraft({ plannedEntry: "" }), chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "entry_required" }));
  });

  it("blocks when entry is not a valid number", () => {
    const result = buildCreateTradePayload({ draft: readyDraft({ plannedEntry: "abc" }), chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "entry_invalid" }));
  });

  it("blocks when stop loss is empty or invalid", () => {
    expect(buildCreateTradePayload({ draft: readyDraft({ plannedStopLoss: "" }), chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW }).blockers).toContainEqual(
      expect.objectContaining({ reason: "stop_loss_required" }),
    );
    expect(buildCreateTradePayload({ draft: readyDraft({ plannedStopLoss: "nope" }), chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW }).blockers).toContainEqual(
      expect.objectContaining({ reason: "stop_loss_invalid" }),
    );
  });

  it("blocks when there are no targets with a valid price at all", () => {
    const result = buildCreateTradePayload({ draft: readyDraft({ plannedTargets: [] }), chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "targets_required" }));
  });

  it("blocks when a NON-empty target has an invalid price", () => {
    const draft = readyDraft({ plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "not-a-number" }] });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toContainEqual(expect.objectContaining({ reason: "target_invalid" }));
  });

  it("LONG geometry: a stop above entry produces a non-blocking warning, not a blocker", () => {
    const draft = readyDraft({ direction: "LONG", plannedEntry: "100", plannedStopLoss: "110" });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toEqual([]); // still submits — server itself only warns on bad geometry
    expect(result.warnings.some((w) => /below entry/i.test(w))).toBe(true);
  });

  it("SHORT geometry: a stop below entry produces a non-blocking warning", () => {
    // selectedConfluenceIds overridden to drop c-bull (BULLISH-only, ineligible for SHORT) —
    // this test is about geometry, not confluence eligibility (covered separately above).
    const draft = readyDraft({ direction: "SHORT", plannedEntry: "100", plannedStopLoss: "90", selectedConfluenceIds: ["c-both"] });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers).toEqual([]);
    expect(result.warnings.some((w) => /above entry/i.test(w))).toBe(true);
  });

  it("good LONG geometry produces no warning", () => {
    const result = buildCreateTradePayload({ draft: readyDraft(), chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.warnings).toEqual([]);
  });
});

describe("buildCreateTradePayload — notes (§11)", () => {
  it("maps all three note fields directly, trimmed", () => {
    const draft = readyDraft({ marketContext: "  A  ", areasOfInterest: "B", reasonForTrade: "C" });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload!.notes).toEqual({ marketContext: "A", areasOfInterest: "B", reasonForTrade: "C" });
  });

  it("omits the whole notes object when every field is empty", () => {
    const draft = readyDraft({ marketContext: "", areasOfInterest: "", reasonForTrade: "" });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload!.notes).toBeUndefined();
  });
});

describe("buildCreateTradePayload — dateKey (§25)", () => {
  it("uses the trader's own local calendar day, computed at call time", () => {
    const result = buildCreateTradePayload({ draft: readyDraft(), chartContext: CHART, strategy: STRATEGY, now: () => new Date(2026, 11, 31, 23, 55) });
    expect(result.payload!.dateKey).toBe("2026-12-31");
  });
});

describe("buildCreateTradePayload — mediaAssetId (Step 8, §21)", () => {
  it("includes the uploaded mediaAssetId as a TOP-LEVEL field, not nested under trade", () => {
    const draft = readyDraft({ mediaAssetId: "media_1" });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload!.mediaAssetId).toBe("media_1");
    expect(result.payload!.trade).not.toHaveProperty("mediaAssetId");
  });

  it("omits mediaAssetId entirely when no screenshot was uploaded — never sends null/undefined explicitly", () => {
    const draft = readyDraft({ mediaAssetId: null });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload).not.toHaveProperty("mediaAssetId");
  });
});

describe("buildCreateTradePayload — originSymbol takes priority (Step 9, Part 8)", () => {
  it("uses draft.originSymbol as assetSymbol even though the LIVE chart shows a different symbol", () => {
    const eurusd = { ...CHART, symbol: { raw: "FX:EURUSD", display: "EURUSD", exchange: "FX" } };
    const draft = readyDraft({ originSymbol: "XAUUSD" }); // locked in earlier, before the chart changed
    const result = buildCreateTradePayload({ draft, chartContext: eurusd, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload!.trade.assetSymbol).toBe("XAUUSD");
  });

  it("falls back to the live chart symbol when no origin has been locked yet", () => {
    const draft = readyDraft({ originSymbol: null });
    const result = buildCreateTradePayload({ draft, chartContext: CHART, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload!.trade.assetSymbol).toBe("XAUUSD"); // CHART's own symbol
  });

  it("still submits successfully using the origin even if the live chart context is entirely null (tab closed/navigated away)", () => {
    const draft = readyDraft({ originSymbol: "XAUUSD" });
    const result = buildCreateTradePayload({ draft, chartContext: null, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.payload!.trade.assetSymbol).toBe("XAUUSD");
    expect(result.blockers.some((b) => b.reason === "no_symbol")).toBe(false);
  });

  it("asset-compatibility is checked against the ORIGIN symbol, not a since-changed live chart", () => {
    // STRATEGY only supports XAUUSD; origin locked to XAUUSD, live chart now shows an unsupported EURUSD.
    const eurusd = { ...CHART, symbol: { raw: "FX:EURUSD", display: "EURUSD", exchange: "FX" } };
    const draft = readyDraft({ originSymbol: "XAUUSD" });
    const result = buildCreateTradePayload({ draft, chartContext: eurusd, strategy: STRATEGY, now: FIXED_NOW });
    expect(result.blockers.some((b) => b.reason === "asset_incompatible")).toBe(false);
  });
});
