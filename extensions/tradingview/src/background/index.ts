/**
 * Traditorium TradingView Extension — Step 4. The service worker: the ONLY
 * place that reads the stored token or calls the Traditorium API. The
 * content script and side panel never touch either directly (§6) — they
 * send a typed ExtensionMessage and get back a StateResponse, which by
 * construction (see @shared/messages.ts) can never contain the token.
 */
import type { ExtensionMessage, StateResponse } from "@shared/messages";
import { getDraft, setDraft } from "./draft-storage";
import {
  analyzeScreenshotAsset,
  captureActiveTradingViewTab,
  connect,
  deleteOrphanedMedia,
  disconnect,
  fetchChartContext,
  fetchStrategyReference,
  getConnectionState,
  isActiveTabTradingView,
  submitCreateTrade,
  uploadCapture,
  verifyAndRefresh,
} from "./state";

chrome.runtime.onInstalled.addListener(() => {
  // Clicking the toolbar icon opens the side panel directly — no popup, no
  // extra click. Wrapped defensively: sidePanel is Chrome 114+; an older
  // Chromium build simply won't get this convenience (the panel can still
  // be opened via the browser's side panel menu).
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

async function respondWithState(sendResponse: (r: StateResponse) => void, connectionPromise: Promise<StateResponse["connection"]>) {
  const [connection, tradingViewDetected, chartContext, draft] = await Promise.all([
    connectionPromise,
    isActiveTabTradingView(),
    fetchChartContext(), // §13 — always a fresh, live read, never a cache
    getDraft(), // Step 6 — the persisted draft, independent of connection status
  ]);
  sendResponse({ connection, tradingViewDetected, chartContext, draft });
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.type) {
    case "TRADINGVIEW_DETECTED":
      // Acknowledged only (§11 demonstrates the messaging architecture).
      // The authoritative "is TradingView the active tab" signal is
      // isActiveTabTradingView()'s live tab query, not a cache built from
      // this message — see state.ts's doc comment for why.
      sendResponse({ ok: true });
      return false;

    case "CHART_CONTEXT_CHANGED":
      // Step 5 — acknowledged only. The background is deliberately
      // stateless for chart context (see fetchChartContext's doc comment):
      // GET_STATE always asks the active tab's content script live rather
      // than trusting anything cached from a past push, so there is
      // nothing to store here. The side panel, which also receives this
      // same broadcast per Chrome's messaging model, uses it purely as a
      // "re-fetch now" trigger — see panel.ts.
      sendResponse({ ok: true });
      return false;

    case "GET_STATE":
      respondWithState(sendResponse, getConnectionState());
      return true; // keep the message channel open for the async response

    case "CONNECT":
      respondWithState(sendResponse, connect(message.token));
      return true;

    case "DISCONNECT":
      respondWithState(sendResponse, disconnect());
      return true;

    case "REFRESH_STRATEGIES":
      respondWithState(sendResponse, verifyAndRefresh());
      return true;

    case "GET_STRATEGY_REFERENCE":
      // Not routed through respondWithState — this is a StrategyReferenceResult,
      // not a StateResponse (§2/§18: one on-demand fetch per selection, not
      // part of the general connection/chart-context poll).
      fetchStrategyReference(message.strategyId).then(sendResponse);
      return true;

    case "SET_DRAFT":
      // §4 — persist only, ack only (never a full respondWithState — that
      // would re-verify the connection over the network on every single
      // checkbox click, which the panel has no need for: it already knows
      // the draft it just computed and sent). Every business rule already
      // ran in the panel via @shared/draft.ts's pure reducers.
      setDraft(message.draft).then(() => sendResponse({ ok: true }));
      return true;

    case "CREATE_TRADE":
      // Step 7, §2/§27 — the ONE call in this whole codebase that can
      // create a real Traditorium trade. Not routed through
      // respondWithState — this returns a CreateTradeResult, not a
      // StateResponse; the panel's own trade-submission.ts owns the
      // idempotency-key lifecycle and reacts to this result directly.
      submitCreateTrade(message.payload, message.idempotencyKey).then(sendResponse);
      return true;

    case "CAPTURE_CHART":
      // Step 8, §9/§13/§17 — the browser capture API can only be called
      // from an extension context with the right permission grant; doing
      // it here (background) keeps the panel from ever needing tab access
      // itself and matches the established "background owns privileged
      // browser APIs" pattern (chart context, the token).
      captureActiveTradingViewTab().then(sendResponse);
      return true;

    case "UPLOAD_CAPTURE":
      uploadCapture(message.dataUrl, message.fileName).then(sendResponse);
      return true;

    case "ANALYZE_SCREENSHOT":
      // Step 9, Part 1 — always a fresh, on-demand call, never cached.
      analyzeScreenshotAsset(message.mediaAssetId).then(sendResponse);
      return true;

    case "DELETE_MEDIA":
      // Step 10 — best-effort orphan cleanup; see state.ts::deleteOrphanedMedia.
      deleteOrphanedMedia(message.mediaAssetId).then(sendResponse);
      return true;

    default:
      return false;
  }
});
