import { beforeEach, describe, expect, it, vi } from "vitest";

import { installChromeMock } from "../../test/chrome-mock";
import * as apiClient from "./api-client";
import { getStored, setStored } from "./storage";
import type { StrategyReference } from "@shared/strategy";
import {
  analyzeScreenshotAsset,
  captureActiveTradingViewTab,
  connect,
  disconnect,
  fetchChartContext,
  fetchStrategyReference,
  getConnectionState,
  isActiveTabTradingView,
  submitCreateTrade,
  uploadCapture,
} from "./state";
import type { CreateTradeRequest } from "@shared/trade-api";

function tradePayload(): CreateTradeRequest {
  return {
    dateKey: "2026-01-15",
    trade: { assetSymbol: "XAUUSD", executionMinutes: 570, direction: "LONG", higherTimeframeBias: "BULLISH", biasConfidencePercent: 50 },
    plan: { entry: 100, stopLoss: 90, targets: [{ targetOrder: 1, label: "TP1", targetPrice: 120 }] },
  };
}

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

vi.mock("./api-client");

describe("state", () => {
  let chromeMock: ReturnType<typeof installChromeMock>["chromeMock"];
  let store: ReturnType<typeof installChromeMock>["store"];

  beforeEach(() => {
    vi.resetAllMocks();
    ({ chromeMock, store } = installChromeMock());
  });

  describe("connect + verifyAndRefresh", () => {
    it("valid token -> connected, with user and the real strategy list from the API (not hard-coded)", async () => {
      vi.mocked(apiClient.getMe).mockResolvedValue({ ok: true, data: { user: { id: "u1", name: "Moses" } } });
      const strategies = [
        { id: "s1", name: "A", version: 1, status: "LIVE" as const },
        { id: "s2", name: "B", version: 1, status: "LIVE" as const },
      ];
      vi.mocked(apiClient.getStrategies).mockResolvedValue({ ok: true, data: { strategies } });

      const result = await connect("td_live_valid");
      expect(result).toEqual({ status: "connected", user: { id: "u1", name: "Moses" }, strategies });

      // The response never carries the token — only user/strategies.
      expect(JSON.stringify(result)).not.toContain("td_live_valid");
    });

    it("invalid/revoked token -> error state, and the bad token is cleared from storage", async () => {
      vi.mocked(apiClient.getMe).mockResolvedValue({ ok: false, reason: "unauthorized", message: "The Traditorium token is invalid or has been revoked." });

      const result = await connect("td_live_bad");
      expect(result).toEqual({ status: "error", message: "The Traditorium token is invalid or has been revoked." });
      expect((await getStored()).apiToken).toBeNull();
    });

    it("network failure -> error state, token is NOT cleared (it may still be valid once Traditorium is reachable)", async () => {
      vi.mocked(apiClient.getMe).mockResolvedValue({ ok: false, reason: "network", message: "Could not reach Traditorium." });

      await connect("td_live_ok");
      expect((await getStored()).apiToken).toBe("td_live_ok");
    });

    it("an empty token is rejected before any network call", async () => {
      const result = await connect("   ");
      expect(result.status).toBe("error");
      expect(apiClient.getMe).not.toHaveBeenCalled();
    });
  });

  describe("getConnectionState", () => {
    it("no stored token -> disconnected, without calling the API", async () => {
      const result = await getConnectionState();
      expect(result).toEqual({ status: "disconnected" });
      expect(apiClient.getMe).not.toHaveBeenCalled();
    });

    it("a stored token is ALWAYS re-verified against the network, never trusted blindly", async () => {
      store.set("traditorium", { apiToken: "td_live_x", cachedUser: null, cachedStrategies: null });
      vi.mocked(apiClient.getMe).mockResolvedValue({ ok: true, data: { user: { id: "u1", name: "Moses" } } });
      vi.mocked(apiClient.getStrategies).mockResolvedValue({ ok: true, data: { strategies: [] } });

      await getConnectionState();
      expect(apiClient.getMe).toHaveBeenCalledTimes(1);
    });
  });

  describe("disconnect", () => {
    it("clears the stored token and every cached value, never calls the API", async () => {
      await setStored({ apiToken: "td_live_x", cachedUser: { id: "u1", name: "Moses" }, cachedStrategies: [] });

      const result = await disconnect();
      expect(result).toEqual({ status: "disconnected" });
      expect(await getStored()).toEqual({ apiToken: null, cachedUser: null, cachedStrategies: null });
      expect(apiClient.getMe).not.toHaveBeenCalled();
    });
  });

  describe("isActiveTabTradingView", () => {
    it("true when the active tab's URL is a tradingview.com page", async () => {
      chromeMock.tabs.query.mockResolvedValueOnce([{ id: 1, url: "https://www.tradingview.com/chart/abc123/" }] as chrome.tabs.Tab[]);
      expect(await isActiveTabTradingView()).toBe(true);
    });

    it("false for any other site", async () => {
      chromeMock.tabs.query.mockResolvedValueOnce([{ id: 1, url: "https://example.com/" }] as chrome.tabs.Tab[]);
      expect(await isActiveTabTradingView()).toBe(false);
    });

    it("false when the tab has no id (query without the tabs permission can omit it)", async () => {
      chromeMock.tabs.query.mockResolvedValueOnce([{ url: "https://www.tradingview.com/chart/abc123/" }] as chrome.tabs.Tab[]);
      expect(await isActiveTabTradingView()).toBe(false);
    });

    it("false when there is no active tab / no url available", async () => {
      chromeMock.tabs.query.mockResolvedValueOnce([]);
      expect(await isActiveTabTradingView()).toBe(false);
    });
  });

  describe("fetchChartContext (Step 5)", () => {
    it("returns null without messaging any tab when the active tab isn't TradingView", async () => {
      chromeMock.tabs.query.mockResolvedValueOnce([{ id: 1, url: "https://example.com/" }] as chrome.tabs.Tab[]);
      expect(await fetchChartContext()).toBeNull();
      expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it("asks the active TradingView tab's content script fresh, live, via chrome.tabs.sendMessage — never a cached value", async () => {
      chromeMock.tabs.query.mockResolvedValueOnce([{ id: 42, url: "https://www.tradingview.com/chart/" }] as chrome.tabs.Tab[]);
      const context = { symbol: null, timeframe: "5m", detected: true, symbolSource: null, timeframeSource: "title" as const, updatedAt: 1 };
      const tabsSendMessage = vi.fn(async () => context);
      // chrome-mock only stubs tabs.query — this test's tab-scoped
      // chrome.tabs.sendMessage is added ad hoc, just for this assertion.
      globalThis.chrome.tabs.sendMessage = tabsSendMessage as typeof chrome.tabs.sendMessage;

      expect(await fetchChartContext()).toEqual(context);
      expect(tabsSendMessage).toHaveBeenCalledWith(42, { type: "GET_CHART_CONTEXT" });
    });

    it("returns null (never throws) when the content script isn't reachable yet, e.g. mid-navigation", async () => {
      chromeMock.tabs.query.mockResolvedValueOnce([{ id: 42, url: "https://www.tradingview.com/chart/" }] as chrome.tabs.Tab[]);
      globalThis.chrome.tabs.sendMessage = vi.fn(async () => {
        throw new Error("Receiving end does not exist.");
      }) as typeof chrome.tabs.sendMessage;

      expect(await fetchChartContext()).toBeNull();
    });
  });

  describe("fetchStrategyReference (Step 6)", () => {
    it("returns a 'disconnected' failure without calling the API when there's no stored token", async () => {
      const result = await fetchStrategyReference("strat_1");
      expect(result).toEqual({ ok: false, reason: "disconnected", message: expect.any(String) });
      expect(apiClient.getStrategy).not.toHaveBeenCalled();
    });

    it("passes the stored token through to api-client.getStrategy and returns its strategy on success", async () => {
      await setStored({ apiToken: "td_live_x" });
      vi.mocked(apiClient.getStrategy).mockResolvedValue({ ok: true, data: { strategy: STRATEGY_REFERENCE } });

      const result = await fetchStrategyReference("strat_1");
      expect(apiClient.getStrategy).toHaveBeenCalledWith("td_live_x", "strat_1");
      expect(result).toEqual({ ok: true, strategy: STRATEGY_REFERENCE });
    });

    it("propagates an API failure (e.g. not found / unauthorized) as-is, never fabricating a strategy", async () => {
      await setStored({ apiToken: "td_live_x" });
      vi.mocked(apiClient.getStrategy).mockResolvedValue({ ok: false, reason: "server", message: "Traditorium returned an unexpected error (404)." });

      const result = await fetchStrategyReference("does-not-exist");
      expect(result).toEqual({ ok: false, reason: "server", message: "Traditorium returned an unexpected error (404)." });
    });
  });

  describe("submitCreateTrade (Step 7)", () => {
    it("returns an 'unauthorized' failure without calling the API when there's no stored token", async () => {
      const result = await submitCreateTrade(tradePayload(), "key-1");
      expect(result).toEqual({ ok: false, kind: "unauthorized", message: expect.any(String) });
      expect(apiClient.createTrade).not.toHaveBeenCalled();
    });

    it("passes the stored token AND the given idempotency key straight through to api-client.createTrade", async () => {
      await setStored({ apiToken: "td_live_x" });
      vi.mocked(apiClient.createTrade).mockResolvedValue({
        ok: true,
        warnings: [],
        replayed: false,
        trade: { id: "trade_1" } as never,
      });

      await submitCreateTrade(tradePayload(), "key-1");
      expect(apiClient.createTrade).toHaveBeenCalledWith("td_live_x", tradePayload(), "key-1");
    });

    it("propagates the api-client result as-is (success or failure), never reshaping it", async () => {
      await setStored({ apiToken: "td_live_x" });
      const failure = { ok: false, kind: "conflict", message: "conflict!" } as const;
      vi.mocked(apiClient.createTrade).mockResolvedValue(failure);

      expect(await submitCreateTrade(tradePayload(), "key-1")).toEqual(failure);
    });

    it("§21 — a 401 clears the stored token, so a subsequent GET_STATE naturally reports disconnected", async () => {
      await setStored({ apiToken: "td_live_x", cachedUser: { id: "u1", name: "Moses" } });
      vi.mocked(apiClient.createTrade).mockResolvedValue({ ok: false, kind: "unauthorized", message: "The Traditorium token is invalid or has been revoked." });

      await submitCreateTrade(tradePayload(), "key-1");
      expect((await getStored()).apiToken).toBeNull();
    });

    it("a non-401 failure (network/server/conflict/validation) never clears the stored token", async () => {
      await setStored({ apiToken: "td_live_x" });
      vi.mocked(apiClient.createTrade).mockResolvedValue({ ok: false, kind: "network", message: "Could not reach Traditorium." });

      await submitCreateTrade(tradePayload(), "key-1");
      expect((await getStored()).apiToken).toBe("td_live_x");
    });

    it("no CreateTradeResult variant this module can produce ever contains the substring of a real token", async () => {
      await setStored({ apiToken: "td_live_super_secret_value" });
      vi.mocked(apiClient.createTrade).mockResolvedValue({ ok: true, warnings: [], replayed: false, trade: { id: "trade_1" } as never });
      const result = await submitCreateTrade(tradePayload(), "key-1");
      expect(JSON.stringify(result)).not.toContain("td_live_super_secret_value");
    });
  });

  describe("captureActiveTradingViewTab (Step 8)", () => {
    it("returns a data URL when the active tab is TradingView and captureVisibleTab succeeds", async () => {
      chromeMock.tabs.query.mockResolvedValueOnce([{ id: 1, windowId: 7, url: "https://www.tradingview.com/chart/" }] as chrome.tabs.Tab[]);
      const result = await captureActiveTradingViewTab();
      expect(result).toEqual({ ok: true, dataUrl: expect.stringMatching(/^data:image\/png;base64,/) });
      expect(chromeMock.tabs.captureVisibleTab).toHaveBeenCalledWith(7, { format: "png" });
    });

    it("returns 'no_tab' without calling captureVisibleTab when the active tab isn't TradingView", async () => {
      chromeMock.tabs.query.mockResolvedValueOnce([{ id: 1, windowId: 7, url: "https://example.com/" }] as chrome.tabs.Tab[]);
      const result = await captureActiveTradingViewTab();
      expect(result).toEqual({ ok: false, reason: "no_tab", message: expect.any(String) });
      expect(chromeMock.tabs.captureVisibleTab).not.toHaveBeenCalled();
    });

    it("returns 'capture_failed' (never throws) if captureVisibleTab itself rejects", async () => {
      chromeMock.tabs.query.mockResolvedValueOnce([{ id: 1, windowId: 7, url: "https://www.tradingview.com/chart/" }] as chrome.tabs.Tab[]);
      chromeMock.tabs.captureVisibleTab.mockRejectedValueOnce(new Error("Cannot access contents of the page."));
      const result = await captureActiveTradingViewTab();
      expect(result).toEqual({ ok: false, reason: "capture_failed", message: expect.any(String) });
    });
  });

  describe("uploadCapture (Step 8)", () => {
    const TINY_PNG_DATA_URL = "data:image/png;base64,ZmFrZS1wbmc="; // "fake-png"

    it("returns 'unauthorized' without calling the API when there's no stored token", async () => {
      const result = await uploadCapture(TINY_PNG_DATA_URL);
      expect(result).toEqual({ ok: false, kind: "unauthorized", message: expect.any(String) });
      expect(apiClient.uploadMedia).not.toHaveBeenCalled();
    });

    it("decodes the data URL and passes the stored token + decoded bytes/mime through to api-client.uploadMedia", async () => {
      await setStored({ apiToken: "td_live_x" });
      vi.mocked(apiClient.uploadMedia).mockResolvedValue({ ok: true, media: { id: "media_1", url: "/api/media/media_1", mimeType: "image/png", fileSize: 8 } });

      await uploadCapture(TINY_PNG_DATA_URL, "chart.png");

      expect(apiClient.uploadMedia).toHaveBeenCalledWith("td_live_x", expect.any(Uint8Array), "image/png", "chart.png");
      const bytes = vi.mocked(apiClient.uploadMedia).mock.calls[0]![1];
      expect(new TextDecoder().decode(bytes)).toBe("fake-png");
    });

    it("§21 — a 401 clears the stored token, matching submitCreateTrade's rule", async () => {
      await setStored({ apiToken: "td_live_x" });
      vi.mocked(apiClient.uploadMedia).mockResolvedValue({ ok: false, kind: "unauthorized", message: "The Traditorium token is invalid or has been revoked." });

      await uploadCapture(TINY_PNG_DATA_URL);
      expect((await getStored()).apiToken).toBeNull();
    });

    it("a non-401 failure never clears the stored token", async () => {
      await setStored({ apiToken: "td_live_x" });
      vi.mocked(apiClient.uploadMedia).mockResolvedValue({ ok: false, kind: "network", message: "Could not reach Traditorium." });

      await uploadCapture(TINY_PNG_DATA_URL);
      expect((await getStored()).apiToken).toBe("td_live_x");
    });

    it("no UploadMediaResult variant this module can produce ever contains the substring of a real token", async () => {
      await setStored({ apiToken: "td_live_super_secret_value" });
      vi.mocked(apiClient.uploadMedia).mockResolvedValue({ ok: true, media: { id: "media_1", url: "/api/media/media_1", mimeType: "image/png", fileSize: 8 } });
      const result = await uploadCapture(TINY_PNG_DATA_URL);
      expect(JSON.stringify(result)).not.toContain("td_live_super_secret_value");
    });
  });

  describe("analyzeScreenshotAsset (Step 9, Part 1)", () => {
    it("returns 'unauthorized' without calling the API when there's no stored token", async () => {
      const result = await analyzeScreenshotAsset("media_1");
      expect(result).toEqual({ ok: false, kind: "unauthorized", message: expect.any(String) });
      expect(apiClient.analyzeScreenshot).not.toHaveBeenCalled();
    });

    it("passes the stored token and given mediaAssetId straight through to api-client.analyzeScreenshot", async () => {
      await setStored({ apiToken: "td_live_x" });
      vi.mocked(apiClient.analyzeScreenshot).mockResolvedValue({ ok: true, outcome: { status: "RECOGNITION_FAILED", error: "Not configured." } });

      await analyzeScreenshotAsset("media_1");
      expect(apiClient.analyzeScreenshot).toHaveBeenCalledWith("td_live_x", "media_1");
    });

    it("§21 — a 401 clears the stored token", async () => {
      await setStored({ apiToken: "td_live_x" });
      vi.mocked(apiClient.analyzeScreenshot).mockResolvedValue({ ok: false, kind: "unauthorized", message: "The Traditorium token is invalid or has been revoked." });

      await analyzeScreenshotAsset("media_1");
      expect((await getStored()).apiToken).toBeNull();
    });

    it("a non-401 failure never clears the stored token", async () => {
      await setStored({ apiToken: "td_live_x" });
      vi.mocked(apiClient.analyzeScreenshot).mockResolvedValue({ ok: false, kind: "not_found", message: "Image not found or access denied." });

      await analyzeScreenshotAsset("media_1");
      expect((await getStored()).apiToken).toBe("td_live_x");
    });

    it("no AnalyzeScreenshotResult variant this module can produce ever contains the substring of a real token", async () => {
      await setStored({ apiToken: "td_live_super_secret_value" });
      vi.mocked(apiClient.analyzeScreenshot).mockResolvedValue({ ok: true, outcome: { status: "RECOGNITION_COMPLETE", fields: [] } });
      const result = await analyzeScreenshotAsset("media_1");
      expect(JSON.stringify(result)).not.toContain("td_live_super_secret_value");
    });
  });

  // Guards against the exact class of bug §18 calls out: a raw token
  // silently riding along on a ConnectionState value passed through
  // messaging.
  it("no ConnectionState variant this module can produce ever contains the substring of a real token", async () => {
    vi.mocked(apiClient.getMe).mockResolvedValue({ ok: true, data: { user: { id: "u1", name: "Moses" } } });
    vi.mocked(apiClient.getStrategies).mockResolvedValue({ ok: true, data: { strategies: [] } });
    const token = "td_live_super_secret_value";

    const connected = await connect(token);
    const disconnected = await disconnect();
    expect(JSON.stringify(connected)).not.toContain(token);
    expect(JSON.stringify(disconnected)).not.toContain(token);
  });
});
