import { describe, expect, it } from "vitest";

import { EMPTY_DRAFT, type TradeDraftContext } from "@shared/draft";
import type { TradingViewChartContext } from "@shared/chart-context";
import type { CreateTradeResult } from "@shared/trade-api";
import type { SubmissionState } from "./trade-submission";
import { toTradeViewModel } from "./trade-view";

const CHART: TradingViewChartContext = {
  symbol: { raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" },
  timeframe: "5m",
  detected: true,
  symbolSource: "url",
  timeframeSource: "title",
  updatedAt: 1,
};

const IDLE: SubmissionState = { status: "idle" };
const BASE_URL = "http://localhost:3000";

function draft(overrides: Partial<TradeDraftContext> = {}): TradeDraftContext {
  return { ...EMPTY_DRAFT, direction: "LONG", plannedEntry: "3640", plannedStopLoss: "3630", ...overrides };
}

describe("toTradeViewModel — R preview (§9)", () => {
  it("computes a preview once direction/entry/stop/target are all valid numbers", () => {
    const d = draft({ plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "3660" }] });
    const vm = toTradeViewModel({ draft: d, chartContext: CHART, strategy: null, submission: IDLE, webAppBaseUrl: BASE_URL });
    expect(vm.targets[0]!.rPreviewText).toBe("2.0R");
  });

  it("shows no preview for a target with an empty price", () => {
    const d = draft({ plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "" }] });
    const vm = toTradeViewModel({ draft: d, chartContext: CHART, strategy: null, submission: IDLE, webAppBaseUrl: BASE_URL });
    expect(vm.targets[0]!.rPreviewText).toBeNull();
  });

  it("shows no preview when entry is missing", () => {
    const d = draft({ plannedEntry: "", plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "3660" }] });
    const vm = toTradeViewModel({ draft: d, chartContext: CHART, strategy: null, submission: IDLE, webAppBaseUrl: BASE_URL });
    expect(vm.targets[0]!.rPreviewText).toBeNull();
  });

  it("shows no preview when the risk distance is invalid (stop on the wrong side)", () => {
    const d = draft({ plannedEntry: "100", plannedStopLoss: "110", direction: "LONG", plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "120" }] });
    const vm = toTradeViewModel({ draft: d, chartContext: CHART, strategy: null, submission: IDLE, webAppBaseUrl: BASE_URL });
    expect(vm.targets[0]!.rPreviewText).toBeNull();
  });

  it("never crashes or fabricates a preview from a non-numeric target price", () => {
    const d = draft({ plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "abc" }] });
    const vm = toTradeViewModel({ draft: d, chartContext: CHART, strategy: null, submission: IDLE, webAppBaseUrl: BASE_URL });
    expect(vm.targets[0]!.rPreviewText).toBeNull();
  });
});

describe("toTradeViewModel — save readiness", () => {
  it("canSave is true for a fully-valid draft", () => {
    const d = draft({ plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "3660" }] });
    const vm = toTradeViewModel({ draft: d, chartContext: CHART, strategy: null, submission: IDLE, webAppBaseUrl: BASE_URL });
    expect(vm.canSave).toBe(true);
    expect(vm.blockerMessages).toEqual([]);
  });

  it("canSave is false while a submission is already in flight, even with a valid draft", () => {
    const d = draft({ plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "3660" }] });
    const vm = toTradeViewModel({ draft: d, chartContext: CHART, strategy: null, submission: { status: "submitting" }, webAppBaseUrl: BASE_URL });
    expect(vm.canSave).toBe(false);
  });

  it("canSave is false with a descriptive blocker when required fields are missing", () => {
    const vm = toTradeViewModel({ draft: EMPTY_DRAFT, chartContext: CHART, strategy: null, submission: IDLE, webAppBaseUrl: BASE_URL });
    expect(vm.canSave).toBe(false);
    expect(vm.blockerMessages.length).toBeGreaterThan(0);
  });

  it("surfaces a non-blocking geometry warning without affecting canSave", () => {
    const d = draft({ plannedEntry: "100", plannedStopLoss: "110", plannedTargets: [{ id: "t1", label: "TP1", targetPrice: "120" }] });
    const vm = toTradeViewModel({ draft: d, chartContext: CHART, strategy: null, submission: IDLE, webAppBaseUrl: BASE_URL });
    expect(vm.canSave).toBe(true);
    expect(vm.warningMessages.length).toBeGreaterThan(0);
  });
});

describe("toTradeViewModel — submission states", () => {
  const successResult: Extract<CreateTradeResult, { ok: true }> = {
    ok: true,
    warnings: [],
    replayed: false,
    trade: {
      id: "trade_42",
      tradeNumber: 7,
      dateKey: "2026-01-15",
      assetSymbol: "XAUUSD",
      direction: "LONG",
      timeframe: "5m",
      selectedSession: "London",
      strategyId: "s1",
      strategyName: "London Continuation",
      selectedEntryModel: "Sweep + Displacement",
      selectedConfluences: ["Liquidity Sweep"],
      selectedExecution: [],
      plannedEntry: 3640,
      plannedStopLoss: 3630,
      plannedTargets: [
        { targetOrder: 1, label: "TP1", targetPrice: 3660, rMultiple: 2, plannedClosePercent: null },
        { targetOrder: 2, label: "TP2", targetPrice: 3670, rMultiple: 3, plannedClosePercent: null },
      ],
      expectedRR: 2.5,
      setupScore: 90,
      setupRating: "A",
      setupValid: true,
      confluencePercent: 100,
      executionPercent: null,
      hasPlanScreenshot: false,
      createdAt: "2026-01-15T10:00:00.000Z",
    },
  };

  it("§18 — a success view model uses the ACTUAL returned trade data, never the local draft", () => {
    const d = draft({ strategyId: "some-other-id" }); // deliberately different from the returned trade's strategyId
    const vm = toTradeViewModel({ draft: d, chartContext: CHART, strategy: null, submission: { status: "success", result: successResult }, webAppBaseUrl: BASE_URL });
    expect(vm.submission).toEqual({
      status: "success",
      assetSymbol: "XAUUSD",
      direction: "LONG",
      strategyName: "London Continuation",
      targetCount: 2,
      hasPlanScreenshot: false,
      warnings: [],
      viewUrl: "http://localhost:3000/journal/2026-01-15/trades/trade_42",
    });
  });

  it("Step 9, Part 15 — hasPlanScreenshot reflects the actual returned trade DTO, not draft/session state", () => {
    const withScreenshot = { ...successResult, trade: { ...successResult.trade, hasPlanScreenshot: true } };
    const vm = toTradeViewModel({ draft: EMPTY_DRAFT, chartContext: null, strategy: null, submission: { status: "success", result: withScreenshot }, webAppBaseUrl: BASE_URL });
    expect(vm.submission).toMatchObject({ hasPlanScreenshot: true });
  });

  it("§19 — the view URL uses the real existing /journal/[date]/trades/[tradeId] route with the trade's own returned ids", () => {
    const vm = toTradeViewModel({ draft: EMPTY_DRAFT, chartContext: null, strategy: null, submission: { status: "success", result: successResult }, webAppBaseUrl: "https://traditorium.com" });
    expect(vm.submission).toMatchObject({ viewUrl: "https://traditorium.com/journal/2026-01-15/trades/trade_42" });
  });

  it("§22 — a success WITH warnings surfaces them from the actual response", () => {
    const withWarnings = { ...successResult, warnings: ["plan: Could not save the planned targets."] };
    const vm = toTradeViewModel({ draft: EMPTY_DRAFT, chartContext: null, strategy: null, submission: { status: "success", result: withWarnings }, webAppBaseUrl: BASE_URL });
    expect(vm.submission).toMatchObject({ warnings: ["plan: Could not save the planned targets."] });
  });

  it("a validation error surfaces the structured issues array", () => {
    const vm = toTradeViewModel({
      draft: EMPTY_DRAFT,
      chartContext: null,
      strategy: null,
      submission: { status: "error", result: { ok: false, kind: "validation", message: "Validation failed.", issues: [{ path: "trade.direction", message: "Required" }] } },
      webAppBaseUrl: BASE_URL,
    });
    expect(vm.submission).toEqual({ status: "error", message: "Validation failed.", issues: [{ path: "trade.direction", message: "Required" }] });
  });

  it("a network/server/conflict error has an empty issues array, never a fabricated one", () => {
    const vm = toTradeViewModel({
      draft: EMPTY_DRAFT,
      chartContext: null,
      strategy: null,
      submission: { status: "error", result: { ok: false, kind: "network", message: "Could not reach Traditorium." } },
      webAppBaseUrl: BASE_URL,
    });
    expect(vm.submission).toEqual({ status: "error", message: "Could not reach Traditorium.", issues: [] });
  });
});
