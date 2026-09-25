/**
 * Traditorium TradingView Extension — Step 5. Runs against jsdom fixtures
 * (window/document/history), never live TradingView — see chart-detector.ts
 * and the README's "Known limitations" section for why the DOM tier is
 * unverified against the real site.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installChromeMock } from "../../test/chrome-mock";

describe("tradingview-detect content script", () => {
  // installSpaNavigationHooks() wraps history.pushState/replaceState on
  // every import; jsdom keeps a single `history` object for the whole test
  // FILE (not per test), so without restoring the pristine methods here,
  // each test's `vi.resetModules()` + re-import would stack ANOTHER wrapper
  // on top of the previous tests' — a pure test-isolation artifact of
  // repeatedly re-importing a "runs once per real page load" content script,
  // not a production bug (a real page only ever loads this module once).
  let originalPushState: History["pushState"];
  let originalReplaceState: History["replaceState"];

  beforeAll(() => {
    originalPushState = history.pushState;
    originalReplaceState = history.replaceState;
  });

  beforeEach(() => {
    vi.resetModules();
    document.title = "";
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.history.replaceState(null, "", "/");
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends TRADINGVIEW_DETECTED once, and one initial CHART_CONTEXT_CHANGED report, on load", async () => {
    const { chromeMock } = installChromeMock();
    await import("./tradingview-detect");

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(chromeMock.runtime.sendMessage).toHaveBeenNthCalledWith(1, { type: "TRADINGVIEW_DETECTED" });
    expect(chromeMock.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      type: "CHART_CONTEXT_CHANGED",
      context: expect.objectContaining({ detected: false, symbol: null, timeframe: null }),
    });
  });

  it("does not throw if the background service worker is unreachable (e.g. mid-restart)", async () => {
    const { chromeMock } = installChromeMock();
    chromeMock.runtime.sendMessage.mockRejectedValue(new Error("Receiving end does not exist."));

    await expect(import("./tradingview-detect")).resolves.toBeDefined();
  });

  it("picks up an initial symbol from the URL and reports it on load", async () => {
    window.history.replaceState(null, "", "/chart/?symbol=OANDA:XAUUSD");
    const { chromeMock } = installChromeMock();
    await import("./tradingview-detect");

    expect(chromeMock.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      type: "CHART_CONTEXT_CHANGED",
      context: expect.objectContaining({
        symbol: { raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" },
        symbolSource: "url",
        detected: true,
      }),
    });
  });

  it("re-detects and reports again on a pushState-driven SPA navigation, deduping only when unchanged", async () => {
    window.history.replaceState(null, "", "/chart/?symbol=OANDA:XAUUSD");
    const { chromeMock } = installChromeMock();
    await import("./tradingview-detect");
    chromeMock.runtime.sendMessage.mockClear();

    // Same symbol again — a pushState that doesn't actually change detected
    // context must NOT emit a second CHART_CONTEXT_CHANGED (§18 dedup).
    window.history.pushState(null, "", "/chart/?symbol=OANDA:XAUUSD");
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalled();

    // A genuinely different symbol must emit exactly one new report.
    window.history.pushState(null, "", "/chart/?symbol=OANDA:EURUSD");
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: "CHART_CONTEXT_CHANGED",
      context: expect.objectContaining({ symbol: { raw: "OANDA:EURUSD", display: "EURUSD", exchange: "OANDA" } }),
    });
  });

  it("Step 10 — re-detects on a replaceState-driven SPA navigation (not just pushState)", async () => {
    window.history.replaceState(null, "", "/chart/?symbol=OANDA:XAUUSD");
    const { chromeMock } = installChromeMock();
    await import("./tradingview-detect");
    chromeMock.runtime.sendMessage.mockClear();

    window.history.replaceState(null, "", "/chart/?symbol=OANDA:EURUSD");

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: "CHART_CONTEXT_CHANGED",
      context: expect.objectContaining({ symbol: { raw: "OANDA:EURUSD", display: "EURUSD", exchange: "OANDA" } }),
    });
  });

  it("Step 10 — the 3s reconciliation timer catches a change none of the other three triggers observed", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/chart/?symbol=OANDA:XAUUSD");
      const { chromeMock } = installChromeMock();
      await import("./tradingview-detect");
      chromeMock.runtime.sendMessage.mockClear();

      // Change the URL via the ORIGINAL, unpatched replaceState (captured in
      // beforeAll, before installSpaNavigationHooks ever wrapped it) — this
      // updates window.location exactly like a real navigation would, but
      // deliberately bypasses the pushState/replaceState hook's own notify()
      // call, and touches no <title> either. Only the reconciliation timer
      // is left to catch it — simulates whatever "falls through the first
      // three" triggers the doc comment describes.
      originalReplaceState.call(window.history, null, "", "/chart/?symbol=OANDA:EURUSD");

      await vi.advanceTimersByTimeAsync(3000); // matches RECONCILE_INTERVAL_MS in tradingview-detect.ts

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: "CHART_CONTEXT_CHANGED",
        context: expect.objectContaining({ symbol: { raw: "OANDA:EURUSD", display: "EURUSD", exchange: "OANDA" } }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-detects on a popstate (back/forward) navigation", async () => {
    window.history.replaceState(null, "", "/chart/?symbol=OANDA:XAUUSD");
    const { chromeMock } = installChromeMock();
    await import("./tradingview-detect");
    chromeMock.runtime.sendMessage.mockClear();

    window.history.replaceState(null, "", "/chart/?symbol=OANDA:EURUSD");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: "CHART_CONTEXT_CHANGED",
      context: expect.objectContaining({ symbol: { raw: "OANDA:EURUSD", display: "EURUSD", exchange: "OANDA" } }),
    });
  });

  it("re-detects when TradingView's own JS rewrites the tab title (MutationObserver)", async () => {
    document.title = "TradingView";
    const { chromeMock } = installChromeMock();
    await import("./tradingview-detect");
    chromeMock.runtime.sendMessage.mockClear();

    // Release-gate finding — this is TradingView's REAL live /chart/ page
    // title format ("SYMBOL <price> <arrow> <change>% <source>"), not the
    // "SYMBOL, INTERVAL — TradingView" format assumed before that format was
    // live-verified (see chart-detector.ts's module doc comment). There is
    // no title-based timeframe tier anymore, so only the symbol changes here.
    document.title = "EURUSD 1.13766 ▼ −0.03% BANKS";
    // MutationObserver callbacks fire as a microtask — flush the queue.
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: "CHART_CONTEXT_CHANGED",
      context: expect.objectContaining({
        symbol: { raw: "EURUSD", display: "EURUSD", exchange: null },
      }),
    });
  });

  it("responds synchronously to GET_CHART_CONTEXT with a fresh detection, never a cached value", async () => {
    window.history.replaceState(null, "", "/chart/?symbol=OANDA:XAUUSD");
    const { chromeMock } = installChromeMock();
    await import("./tradingview-detect");

    const listener = chromeMock.runtime.onMessage.addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean;
    expect(listener).toBeTypeOf("function");

    // A symbol change happens on the page BETWEEN the initial load and this
    // GET_CHART_CONTEXT ask — the response must reflect it fresh, not the
    // context captured at load time.
    window.history.replaceState(null, "", "/chart/?symbol=OANDA:EURUSD");

    const sendResponse = vi.fn();
    const keepChannelOpen = listener({ type: "GET_CHART_CONTEXT" }, {}, sendResponse);

    expect(keepChannelOpen).toBe(false); // synchronous response, no async channel needed
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: { raw: "OANDA:EURUSD", display: "EURUSD", exchange: "OANDA" } }),
    );
  });
});
