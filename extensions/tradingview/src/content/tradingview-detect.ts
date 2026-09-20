/**
 * Traditorium TradingView Extension — Step 5. Runs on
 * https://www.tradingview.com/* (see manifest `content_scripts`). Owns ALL
 * TradingView context detection (§10) — the side panel never scrapes the
 * page directly and never receives direct page access; it only ever sees
 * whatever this file chooses to send as a typed ExtensionMessage.
 *
 * §11 — this file has no import of, or access to, the API token. It only
 * ever imports @shared/chart-context and @shared/messages (plain types +
 * pure helpers) and chrome.runtime messaging. Nothing here can leak a
 * credential it structurally never has.
 *
 * §8 — TradingView is a SPA: symbol/timeframe changes and most navigation
 * never fire a real page load, so this does not rely on `DOMContentLoaded`
 * alone. Three independent triggers cause a re-detect:
 *   1. Initial script execution (document_idle).
 *   2. A MutationObserver on <title> — cheap (one node), fires the instant
 *      TradingView's own JS updates the tab title for a new symbol/interval.
 *   3. history.pushState/replaceState interception + a `popstate` listener
 *      — catches TradingView's client-side routing changing the URL (e.g.
 *      following a `?symbol=` deep link) without a real navigation. This
 *      patches the BROWSER'S OWN History API from this content script's
 *      own isolated execution context — it does not touch, wrap, or rely
 *      on any TradingView application code (§2's ban on monkey-patching
 *      TradingView itself does not apply to this well-established,
 *      TradingView-independent technique).
 *   4. A light 3-second reconciliation timer, as a safety net ONLY, for
 *      whatever falls through the first three (§7: "if a small fallback
 *      reconciliation timer is genuinely required, justify it and keep it
 *      inexpensive" — one regex + a couple of narrow querySelectors every
 *      3s is negligible work, not polling the DOM aggressively).
 *
 * Every trigger re-runs the SAME detectChartContext() and only sends
 * CHART_CONTEXT_CHANGED when chartContextsEqual() says the result actually
 * changed (§18 — no message spam).
 */
import { chartContextsEqual, type TradingViewChartContext } from "@shared/chart-context";
import type { ExtensionMessage, TradingViewDetectedMessage } from "@shared/messages";
import { API_BASE_URL } from "@shared/config";
import { detectChartContext } from "./chart-detector";

const RECONCILE_INTERVAL_MS = 3000;

// §16 — debug logging only in a dev build (config.ts's API_BASE_URL is the
// one existing signal for "this is a dev build" — no new mechanism, and no
// token is ever in scope here to accidentally log in the first place.
const DEBUG = API_BASE_URL.includes("localhost");

let lastSent: TradingViewChartContext | null = null;

function send(message: ExtensionMessage) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Background may be briefly asleep/restarting — not load-bearing here;
    // the next detect cycle (MutationObserver/reconcile timer) will retry.
  });
}

function reportIfChanged() {
  const context = detectChartContext({ location: window.location, document });
  if (lastSent && chartContextsEqual(lastSent, context)) return;
  lastSent = context;

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.debug("[Traditorium] chart context:", {
      symbol: context.symbol?.raw ?? null,
      display: context.symbol?.display ?? null,
      exchange: context.symbol?.exchange ?? null,
      timeframe: context.timeframe,
      symbolSource: context.symbolSource,
      timeframeSource: context.timeframeSource,
    });
  }

  send({ type: "CHART_CONTEXT_CHANGED", context });
}

function installSpaNavigationHooks() {
  const notify = () => reportIfChanged();

  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function patched(...args: Parameters<History[typeof method]>) {
      const result = original.apply(this, args);
      notify();
      return result;
    };
  }
  window.addEventListener("popstate", notify);
}

function installTitleObserver() {
  const titleEl = document.querySelector("title");
  if (!titleEl) return;
  new MutationObserver(() => reportIfChanged()).observe(titleEl, { childList: true, characterData: true, subtree: true });
}

const detected: TradingViewDetectedMessage = { type: "TRADINGVIEW_DETECTED" };
send(detected);

reportIfChanged();
installTitleObserver();
installSpaNavigationHooks();
setInterval(reportIfChanged, RECONCILE_INTERVAL_MS);

// §13 recovery — the background may ask for a fresh read at any time
// (e.g. after its own service-worker restart wiped whatever it last knew).
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "GET_CHART_CONTEXT") {
    sendResponse(detectChartContext({ location: window.location, document }));
    return false; // synchronous response
  }
  return false;
});
