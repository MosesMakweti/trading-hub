/**
 * Traditorium TradingView Extension — Step 4. The one typed message
 * contract shared by the content script, side panel, and background
 * service worker (chrome.runtime.sendMessage/onMessage). Every actor
 * imports these types instead of hand-rolling `{ type: string, ... }`
 * objects inline, so a typo in a message `type` string is a compile error,
 * not a silent no-op at runtime.
 */
import type { TradingViewChartContext } from "./chart-context";
import type { TradeDraftContext } from "./draft";
import type { StrategySummary } from "./strategy";
import type { CreateTradeRequest } from "./trade-api";

/** Sent by the TradingView content script the moment it loads on a matched
 *  page. Carries nothing else — page detection only (no chart context). */
export interface TradingViewDetectedMessage {
  type: "TRADINGVIEW_DETECTED";
}

/** Step 5 — pushed by the content script whenever its own detection
 *  produces a genuinely different result (see chartContextsEqual —
 *  deduplicated at the source, never spammed). Content script → background
 *  (and, per Chrome's own extension-messaging model, incidentally also
 *  delivered to any open side panel — the panel treats this ONLY as a
 *  "something changed, re-fetch through the background" trigger, never as
 *  an authoritative value it renders directly, so "background owns state"
 *  still holds in spirit). */
export interface ChartContextChangedMessage {
  type: "CHART_CONTEXT_CHANGED";
  context: TradingViewChartContext;
}

/** Sent BY the background TO a specific tab's content script (via
 *  chrome.tabs.sendMessage) asking for a fresh read right now — the §13
 *  service-worker-restart recovery mechanism: rather than trusting
 *  whatever the background last remembered, ask the content script again. */
export interface GetChartContextMessage {
  type: "GET_CHART_CONTEXT";
}

/** Sent by the side panel whenever it wants the current, freshly-computed
 *  state (on open, on focus, after CONNECT/DISCONNECT resolve). */
export interface GetStateMessage {
  type: "GET_STATE";
}

/** The ONLY message that ever carries the raw token, and it travels in
 *  exactly one direction: panel → background, once, at connect time. The
 *  background never echoes it back in any response (see api-client.test.ts
 *  and panel.test.ts's message-shape assertions). */
export interface ConnectMessage {
  type: "CONNECT";
  token: string;
}

export interface DisconnectMessage {
  type: "DISCONNECT";
}

export interface RefreshStrategiesMessage {
  type: "REFRESH_STRATEGIES";
}

/** Step 6, §2/§18 — the panel never fetches strategy detail itself; it asks
 *  the background for it, which is the only context holding the token. */
export interface GetStrategyReferenceMessage {
  type: "GET_STRATEGY_REFERENCE";
  strategyId: string;
}

/** Step 6, §4/§18 — the panel computes the NEXT draft value itself (via
 *  @shared/draft.ts's pure reducers) and sends the whole resulting object
 *  here purely to be persisted; background applies no business rule of its
 *  own to it (see draft-storage.ts's doc comment). */
export interface SetDraftMessage {
  type: "SET_DRAFT";
  draft: TradeDraftContext;
}

/**
 * Step 7, §2/§27 — the ONLY way the panel ever triggers a
 * `POST /api/v1/trades` call: a typed message to the background, which
 * alone holds the token and calls `api-client.ts::createTrade`. The panel
 * never constructs a fetch/Authorization header itself (see
 * test/security-boundary.test.ts). `idempotencyKey` is generated and owned
 * by the panel's `trade-submission.ts` (§17) — the background does not
 * generate or track it, it only forwards whatever key it's given.
 */
export interface CreateTradeMessage {
  type: "CREATE_TRADE";
  payload: CreateTradeRequest;
  idempotencyKey: string;
}

/** Step 8, §13/§17 — sent only in direct response to the trader's own
 *  "Capture Chart" click (never automatically). The background performs
 *  the actual `chrome.tabs.captureVisibleTab` call and returns a
 *  `CaptureResult` (see @shared/... — not re-exported here; the panel
 *  imports it structurally via the response type at the call site) whose
 *  success case carries a `data:image/png;base64,...` URL — never a raw
 *  Blob/ArrayBuffer over the message channel (a data URL is just a
 *  string, trivially serializable, and directly usable as an `<img src>`
 *  for the local preview with no extra decoding in the panel). */
export interface CaptureChartMessage {
  type: "CAPTURE_CHART";
}

/** Step 8, §17/§27 — the panel sends the data URL it already has (from a
 *  prior CAPTURE_CHART response) back to the background for upload; the
 *  background decodes it to bytes and attaches the token — the panel
 *  never touches the token, same boundary as CREATE_TRADE. */
export interface UploadCaptureMessage {
  type: "UPLOAD_CAPTURE";
  dataUrl: string;
  fileName: string;
}

/** Step 9, Part 1 — the panel's "Analyze Chart" click. Only ever sent for
 *  an already-uploaded screenshot (a real `mediaAssetId` the trader just
 *  got back from UPLOAD_CAPTURE) — recognition is never attempted against
 *  a local, not-yet-uploaded capture. */
export interface AnalyzeScreenshotMessage {
  type: "ANALYZE_SCREENSHOT";
  mediaAssetId: string;
}

/** Step 10 — best-effort cleanup of a standalone screenshot the trader is
 *  abandoning (Retake/Remove/replace-with-new-capture/Start New Idea)
 *  BEFORE it was ever attached to a saved Trade Idea. Fire-and-forget from
 *  the panel's perspective (see panel.ts's `cleanupOrphanedMedia`) — the
 *  local draft is already cleared by the time this is sent, so neither a
 *  network failure nor a 409 ("already attached" — see
 *  `background/state.ts::deleteOrphanedMedia`) ever affects the draft. */
export interface DeleteMediaMessage {
  type: "DELETE_MEDIA";
  mediaAssetId: string;
}

export type ExtensionMessage =
  | TradingViewDetectedMessage
  | ChartContextChangedMessage
  | GetChartContextMessage
  | GetStateMessage
  | ConnectMessage
  | DisconnectMessage
  | RefreshStrategiesMessage
  | GetStrategyReferenceMessage
  | SetDraftMessage
  | CreateTradeMessage
  | CaptureChartMessage
  | UploadCaptureMessage
  | AnalyzeScreenshotMessage
  | DeleteMediaMessage;

/** Every field here is safe to render directly in the UI or log — NEVER add
 *  a token/secret field to this type. Step 6 upgrades `strategyCount` to the
 *  real `strategies` list — the picker (§2) needs actual id/name/status,
 *  not a number; a display count is just `strategies.length` (view.ts). */
export type ConnectionState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; user: { id: string; name: string | null }; strategies: StrategySummary[] }
  | { status: "error"; message: string };

export interface StateResponse {
  connection: ConnectionState;
  tradingViewDetected: boolean;
  /** Step 5 — null when the active tab isn't TradingView, or a content
   *  script isn't reachable there yet (page still loading, etc.). Always a
   *  FRESH read (background asks the content script live — §13), never a
   *  value trusted from a stale in-memory cache. */
  chartContext: TradingViewChartContext | null;
  /** Step 6, §4 — the persisted trade draft (session-scoped — see
   *  draft-storage.ts). Present regardless of connection status, same as
   *  `chartContext`: the trader's selections shouldn't vanish just because
   *  Traditorium needs re-verifying. */
  draft: TradeDraftContext;
}
