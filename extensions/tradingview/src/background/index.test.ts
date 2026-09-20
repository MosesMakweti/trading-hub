import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_DRAFT } from "@shared/draft";
import type { StrategyReference } from "@shared/strategy";
import { installChromeMock } from "../../test/chrome-mock";
import * as state from "./state";

vi.mock("./state");

const STRATEGY_REFERENCE: StrategyReference = {
  id: "strat_1",
  name: "London Continuation",
  version: 1,
  applicableAssets: ["XAUUSD"],
  entryModels: ["Sweep + Displacement"],
  frameworkSteps: [],
  sessions: [{ name: "London", color: "BLUE" }],
  confluences: [],
  execution: [],
  tradeManagement: null,
  setupTypes: [],
};

async function loadBackground() {
  vi.resetModules();
  await import("./index");
}

function getRegisteredListener(chromeMock: ReturnType<typeof installChromeMock>["chromeMock"]) {
  const call = chromeMock.runtime.onMessage.addListener.mock.calls[0];
  if (!call) throw new Error("No onMessage listener was registered.");
  return call[0] as (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean;
}

describe("background message router", () => {
  let chromeMock: ReturnType<typeof installChromeMock>["chromeMock"];

  beforeEach(async () => {
    ({ chromeMock } = installChromeMock());
    vi.resetAllMocks();
    vi.mocked(state.isActiveTabTradingView).mockResolvedValue(false);
    await loadBackground();
  });

  it("registers exactly one onMessage listener and enables the side panel on install", async () => {
    expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(chromeMock.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
  });

  it("GET_STATE calls getConnectionState and returns {connection, tradingViewDetected, chartContext, draft}", async () => {
    vi.mocked(state.getConnectionState).mockResolvedValue({ status: "disconnected" });
    vi.mocked(state.isActiveTabTradingView).mockResolvedValue(true);
    vi.mocked(state.fetchChartContext).mockResolvedValue(null);

    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    const keepChannelOpen = listener({ type: "GET_STATE" }, {}, sendResponse);
    expect(keepChannelOpen).toBe(true); // async response — must keep the message channel open

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ connection: { status: "disconnected" }, tradingViewDetected: true, chartContext: null, draft: EMPTY_DRAFT });
  });

  it("Step 5 — GET_STATE also fetches and includes the live chart context, always via fetchChartContext (never a cache)", async () => {
    vi.mocked(state.getConnectionState).mockResolvedValue({ status: "disconnected" });
    vi.mocked(state.isActiveTabTradingView).mockResolvedValue(true);
    const chartContext = { symbol: { raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" }, timeframe: "5m", detected: true, symbolSource: "url" as const, timeframeSource: "title" as const, updatedAt: 1 };
    vi.mocked(state.fetchChartContext).mockResolvedValue(chartContext);

    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    listener({ type: "GET_STATE" }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(state.fetchChartContext).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ connection: { status: "disconnected" }, tradingViewDetected: true, chartContext, draft: EMPTY_DRAFT });
  });

  it("Step 5 — a GET_STATE response enriched with chartContext still never leaks the token, even for a connected user", async () => {
    vi.mocked(state.getConnectionState).mockResolvedValue({
      status: "connected",
      user: { id: "u1", name: "Moses" },
      strategies: [{ id: "s1", name: "A", version: 1, status: "LIVE" }],
    });
    vi.mocked(state.isActiveTabTradingView).mockResolvedValue(true);
    vi.mocked(state.fetchChartContext).mockResolvedValue({ symbol: null, timeframe: null, detected: false, symbolSource: null, timeframeSource: null, updatedAt: 1 });

    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    listener({ type: "GET_STATE" }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(JSON.stringify(sendResponse.mock.calls[0]![0])).not.toContain("td_live_");
  });

  it("CONNECT forwards the token to state.connect and never puts it in the response", async () => {
    vi.mocked(state.connect).mockResolvedValue({
      status: "connected",
      user: { id: "u1", name: "Moses" },
      strategies: [{ id: "s1", name: "A", version: 1, status: "LIVE" }],
    });

    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    listener({ type: "CONNECT", token: "td_live_secret" }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(state.connect).toHaveBeenCalledWith("td_live_secret");
    const response = sendResponse.mock.calls[0]![0];
    expect(JSON.stringify(response)).not.toContain("td_live_secret");
  });

  it("DISCONNECT calls state.disconnect", async () => {
    vi.mocked(state.disconnect).mockResolvedValue({ status: "disconnected" });
    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    listener({ type: "DISCONNECT" }, {}, sendResponse);
    await vi.waitFor(() => expect(state.disconnect).toHaveBeenCalled());
  });

  it("TRADINGVIEW_DETECTED acknowledges synchronously without touching connection state", () => {
    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    const keepChannelOpen = listener({ type: "TRADINGVIEW_DETECTED" }, {}, sendResponse);
    expect(keepChannelOpen).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(state.getConnectionState).not.toHaveBeenCalled();
  });

  it("Step 5 — CHART_CONTEXT_CHANGED acknowledges synchronously and never touches connection state", () => {
    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    const context = { symbol: null, timeframe: null, detected: false, symbolSource: null, timeframeSource: null, updatedAt: 1 };
    const keepChannelOpen = listener({ type: "CHART_CONTEXT_CHANGED", context }, {}, sendResponse);
    expect(keepChannelOpen).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(state.getConnectionState).not.toHaveBeenCalled();
    expect(state.fetchChartContext).not.toHaveBeenCalled();
  });

  it("Step 6 — GET_STRATEGY_REFERENCE forwards to state.fetchStrategyReference and returns its result directly (not wrapped in a StateResponse)", async () => {
    vi.mocked(state.fetchStrategyReference).mockResolvedValue({ ok: true, strategy: STRATEGY_REFERENCE });

    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    const keepChannelOpen = listener({ type: "GET_STRATEGY_REFERENCE", strategyId: "strat_1" }, {}, sendResponse);
    expect(keepChannelOpen).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(state.fetchStrategyReference).toHaveBeenCalledWith("strat_1");
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, strategy: STRATEGY_REFERENCE });
  });

  it("Step 7 — CREATE_TRADE forwards to state.submitCreateTrade with the payload AND idempotency key, returning its result directly", async () => {
    const payload = {
      dateKey: "2026-01-15",
      trade: { assetSymbol: "XAUUSD", executionMinutes: 570, direction: "LONG" as const, higherTimeframeBias: "BULLISH" as const, biasConfidencePercent: 50 },
      plan: { entry: 100, stopLoss: 90, targets: [{ targetOrder: 1, label: "TP1", targetPrice: 120 }] },
    };
    const apiResult = { ok: true as const, warnings: [], replayed: false, trade: { id: "trade_1" } as never };
    vi.mocked(state.submitCreateTrade).mockResolvedValue(apiResult);

    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    const keepChannelOpen = listener({ type: "CREATE_TRADE", payload, idempotencyKey: "key-1" }, {}, sendResponse);
    expect(keepChannelOpen).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(state.submitCreateTrade).toHaveBeenCalledWith(payload, "key-1");
    expect(sendResponse).toHaveBeenCalledWith(apiResult);
  });

  it("Step 8 — CAPTURE_CHART forwards to state.captureActiveTradingViewTab and returns its result directly", async () => {
    vi.mocked(state.captureActiveTradingViewTab).mockResolvedValue({ ok: true, dataUrl: "data:image/png;base64,ZmFrZQ==" });

    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    const keepChannelOpen = listener({ type: "CAPTURE_CHART" }, {}, sendResponse);
    expect(keepChannelOpen).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(state.captureActiveTradingViewTab).toHaveBeenCalledWith();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, dataUrl: "data:image/png;base64,ZmFrZQ==" });
  });

  it("Step 8 — UPLOAD_CAPTURE forwards to state.uploadCapture with the data URL and file name, returning its result directly", async () => {
    const uploadResult = { ok: true as const, media: { id: "media_1", url: "/api/media/media_1", mimeType: "image/png", fileSize: 8 } };
    vi.mocked(state.uploadCapture).mockResolvedValue(uploadResult);

    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    const keepChannelOpen = listener({ type: "UPLOAD_CAPTURE", dataUrl: "data:image/png;base64,ZmFrZQ==", fileName: "chart.png" }, {}, sendResponse);
    expect(keepChannelOpen).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(state.uploadCapture).toHaveBeenCalledWith("data:image/png;base64,ZmFrZQ==", "chart.png");
    expect(sendResponse).toHaveBeenCalledWith(uploadResult);
  });

  it("Step 9 — ANALYZE_SCREENSHOT forwards to state.analyzeScreenshotAsset with the mediaAssetId, returning its result directly", async () => {
    const analyzeResult = { ok: true as const, outcome: { status: "RECOGNITION_FAILED" as const, error: "Not configured." } };
    vi.mocked(state.analyzeScreenshotAsset).mockResolvedValue(analyzeResult);

    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    const keepChannelOpen = listener({ type: "ANALYZE_SCREENSHOT", mediaAssetId: "media_1" }, {}, sendResponse);
    expect(keepChannelOpen).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(state.analyzeScreenshotAsset).toHaveBeenCalledWith("media_1");
    expect(sendResponse).toHaveBeenCalledWith(analyzeResult);
  });

  it("Step 6 — SET_DRAFT persists the given draft and acknowledges only — never re-verifies the connection over the network", async () => {
    const draft = { ...EMPTY_DRAFT, strategyId: "strat_1", direction: "LONG" as const, updatedAt: 123 };

    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    const keepChannelOpen = listener({ type: "SET_DRAFT", draft }, {}, sendResponse);
    expect(keepChannelOpen).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(state.getConnectionState).not.toHaveBeenCalled();

    // Persisted for real — a subsequent GET_STATE picks it up.
    vi.mocked(state.getConnectionState).mockResolvedValue({ status: "disconnected" });
    vi.mocked(state.isActiveTabTradingView).mockResolvedValue(false);
    vi.mocked(state.fetchChartContext).mockResolvedValue(null);
    const getStateResponse = vi.fn();
    listener({ type: "GET_STATE" }, {}, getStateResponse);
    await vi.waitFor(() => expect(getStateResponse).toHaveBeenCalled());
    expect(getStateResponse).toHaveBeenCalledWith({ connection: { status: "disconnected" }, tradingViewDetected: false, chartContext: null, draft });
  });

  it("an unrecognized message type is ignored, not a crash", () => {
    const listener = getRegisteredListener(chromeMock);
    const sendResponse = vi.fn();
    expect(() => listener({ type: "SOMETHING_UNKNOWN" }, {}, sendResponse)).not.toThrow();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
