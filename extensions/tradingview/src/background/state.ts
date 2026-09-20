/**
 * Traditorium TradingView Extension — Step 4. Connection-state transitions.
 * Every function here is the single source of truth for one transition;
 * background/index.ts's message router only calls these, it never mutates
 * storage or connection status inline.
 */
import type { ConnectionState, GetChartContextMessage } from "@shared/messages";
import type { TradingViewChartContext } from "@shared/chart-context";
import type { StrategyReferenceResult } from "@shared/strategy";
import type { CreateTradeRequest, CreateTradeResult } from "@shared/trade-api";
import type { DeleteMediaResult, UploadMediaResult } from "@shared/media-api";
import type { CaptureResult } from "@shared/capture-api";
import type { AnalyzeScreenshotResult } from "@shared/recognition-api";
import { analyzeScreenshot, createTrade, deleteMedia, getMe, getStrategies, getStrategy, uploadMedia } from "./api-client";
import { clearStored, getStored, setStored } from "./storage";

const TRADINGVIEW_ORIGIN = /^https:\/\/www\.tradingview\.com\//;

/** Step 8 — returns the full Tab (not just its id), since captureVisibleTab
 *  needs a windowId too. */
async function getActiveTradingViewTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !TRADINGVIEW_ORIGIN.test(tab.url)) return null;
  return tab;
}

async function getActiveTradingViewTabId(): Promise<number | null> {
  return (await getActiveTradingViewTab())?.id ?? null;
}

/** §15: never trust cached user data blindly — this always calls
 *  GET /api/v1/me (and, if that succeeds, GET /api/v1/strategies) before
 *  reporting "connected." An invalid/revoked token clears itself out of
 *  storage automatically, so a stale credential can't linger silently. */
export async function verifyAndRefresh(): Promise<ConnectionState> {
  const { apiToken } = await getStored();
  if (!apiToken) return { status: "disconnected" };

  const me = await getMe(apiToken);
  if (!me.ok) {
    if (me.reason === "unauthorized") await clearStored();
    return { status: "error", message: me.message };
  }

  const strategies = await getStrategies(apiToken);
  const strategyList = strategies.ok ? strategies.data.strategies : [];
  await setStored({ cachedUser: me.data.user, cachedStrategies: strategyList });

  return { status: "connected", user: me.data.user, strategies: strategyList };
}

/** Cheap path for GET_STATE when there is no stored token at all — skips
 *  the network round trip verifyAndRefresh would otherwise always make. */
export async function getConnectionState(): Promise<ConnectionState> {
  const { apiToken } = await getStored();
  if (!apiToken) return { status: "disconnected" };
  return verifyAndRefresh();
}

export async function connect(token: string): Promise<ConnectionState> {
  const trimmed = token.trim();
  if (!trimmed) return { status: "error", message: "Enter a Traditorium API token." };
  await setStored({ apiToken: trimmed });
  return verifyAndRefresh();
}

export async function disconnect(): Promise<ConnectionState> {
  // §16: local-only. Never calls any revoke endpoint — the server-side
  // token stays valid until the trader explicitly revokes it in
  // Traditorium itself. Local disconnect and server-side revocation are
  // deliberately different concepts.
  await clearStored();
  return { status: "disconnected" };
}

/** §11/§12: robust to service-worker restarts on purpose — this is a live
 *  query against the currently active tab, not a cached "detected tabs"
 *  set that an MV3 service worker's normal idle-unload would silently
 *  wipe. Requires no `tabs` permission: `url` is populated on the returned
 *  Tab because `https://www.tradingview.com/*` is already declared under
 *  `host_permissions` for the content script. */
export async function isActiveTabTradingView(): Promise<boolean> {
  return (await getActiveTradingViewTabId()) != null;
}

/**
 * Step 6, §2/§18 — fetches one strategy's full configuration through the
 * background, the only context holding the token (the panel never calls
 * api-client.ts directly). Not "always re-verify" the way connection state
 * is — a single on-demand call per strategy selection, not part of the
 * polling GET_STATE cycle (a full strategy config is heavier than the
 * connection/chart-context checks and is only needed once a strategy is
 * actually picked).
 */
export async function fetchStrategyReference(strategyId: string): Promise<StrategyReferenceResult> {
  const { apiToken } = await getStored();
  if (!apiToken) return { ok: false, reason: "disconnected", message: "Not connected to Traditorium." };

  const result = await getStrategy(apiToken, strategyId);
  if (!result.ok) return result;
  return { ok: true, strategy: result.data.strategy };
}

/**
 * Step 5, §13 — the service-worker-restart recovery mechanism: rather than
 * trusting any value the background might have cached in memory (which an
 * MV3 restart can silently wipe), this always asks the active tab's
 * content script for a FRESH read, live, on every call. Returns null when
 * the active tab isn't TradingView, or its content script isn't reachable
 * yet (page still loading, extension just installed, etc.) — never a
 * fabricated or stale context.
 */
export async function fetchChartContext(): Promise<TradingViewChartContext | null> {
  const tabId = await getActiveTradingViewTabId();
  if (tabId == null) return null;

  const message: GetChartContextMessage = { type: "GET_CHART_CONTEXT" };
  try {
    const context = (await chrome.tabs.sendMessage(tabId, message)) as TradingViewChartContext | undefined;
    return context ?? null;
  } catch {
    // No content script listening yet (page mid-navigation, etc.) — a
    // normal, expected transient state, not an error to surface.
    return null;
  }
}

/**
 * Step 7, §2/§21. `POST /api/v1/trades` through the background — the only
 * context holding the token. No business rule lives here: the payload was
 * already built and validated by @shared/trade-payload.ts in the panel;
 * this function only attaches the stored token (or reports "unauthorized"
 * if there isn't one — functionally identical to the server's own 401 for
 * this caller's purposes, since either way there's no valid credential to
 * submit with) and forwards to api-client.ts::createTrade.
 *
 * On a 401, clears the stored token — the exact same "an invalid/revoked
 * token clears itself out automatically" rule `verifyAndRefresh` already
 * applies, so the panel's next `GET_STATE` naturally reports disconnected
 * (§21: "transition to the existing disconnected/auth error behavior... do
 * not keep attempting writes") without submitCreateTrade needing to know
 * anything about UI state itself.
 */
export async function submitCreateTrade(payload: CreateTradeRequest, idempotencyKey: string): Promise<CreateTradeResult> {
  const { apiToken } = await getStored();
  if (!apiToken) return { ok: false, kind: "unauthorized", message: "Not connected to Traditorium." };

  const result = await createTrade(apiToken, payload, idempotencyKey);
  if (!result.ok && result.kind === "unauthorized") await clearStored();
  return result;
}

/**
 * Step 8, §9/§10/§13. Captures the VISIBLE viewport of the active
 * TradingView tab via `chrome.tabs.captureVisibleTab` — the browser's own
 * screenshot primitive, a pixel snapshot of what's actually rendered. No
 * DOM reconstruction, no html2canvas, no TradingView canvas/internals
 * access, no network interception (§9's explicit ban list). Only ever
 * runs in response to an explicit `CAPTURE_CHART` message from the panel
 * (§13 — the panel only sends that on the trader's own "Capture Chart"
 * click; nothing here fires automatically).
 *
 * §10 — requires `activeTab` (granted implicitly by the trader's own click
 * that opened/focused the side panel) — not `<all_urls>`, not a broader
 * `tabs` permission, not `desktopCapture`. `no_tab` covers "the active tab
 * isn't TradingView" (mirrors isActiveTabTradingView's own check);
 * `capture_failed` covers a permission/timing failure captureVisibleTab
 * itself can throw (e.g. the tab isn't focused/visible right now).
 */
export async function captureActiveTradingViewTab(): Promise<CaptureResult> {
  const tab = await getActiveTradingViewTab();
  if (!tab || tab.windowId == null) {
    return { ok: false, reason: "no_tab", message: "Open a TradingView chart tab to capture it." };
  }
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, reason: "capture_failed", message: "Could not capture the chart. Make sure the TradingView tab is visible and try again." };
  }
}

/** A `data:<mime>;base64,<data>` URL — exactly what `captureVisibleTab`
 *  returns — decoded into raw bytes for the multipart upload. `atob` is a
 *  standard Web API, available in the MV3 service worker global scope. */
function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid capture data.");
  const [, mimeType, base64] = match;
  const binary = atob(base64!);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mimeType: mimeType! };
}

/**
 * Step 8, §17/§21. `POST /api/v1/media` through the background — same
 * token/401 handling as `submitCreateTrade`. Decodes the captured data URL
 * to raw bytes here (never in the panel — the panel only ever holds the
 * data URL for its own local `<img>` preview, see panel.ts) and forwards
 * to api-client.ts::uploadMedia.
 */
export async function uploadCapture(dataUrl: string, fileName = "chart.png"): Promise<UploadMediaResult> {
  const { apiToken } = await getStored();
  if (!apiToken) return { ok: false, kind: "unauthorized", message: "Not connected to Traditorium." };

  const { bytes, mimeType } = decodeDataUrl(dataUrl);
  const result = await uploadMedia(apiToken, bytes, mimeType, fileName);
  if (!result.ok && result.kind === "unauthorized") await clearStored();
  return result;
}

/**
 * Step 9, Part 1. `POST /api/v1/media/:mediaAssetId/recognize-trade-plan`
 * through the background — same token/401 handling as `submitCreateTrade`/
 * `uploadCapture`. No recognition logic lives here; this only attaches the
 * stored token and forwards to api-client.ts::analyzeScreenshot.
 */
export async function analyzeScreenshotAsset(mediaAssetId: string): Promise<AnalyzeScreenshotResult> {
  const { apiToken } = await getStored();
  if (!apiToken) return { ok: false, kind: "unauthorized", message: "Not connected to Traditorium." };

  const result = await analyzeScreenshot(apiToken, mediaAssetId);
  if (!result.ok && result.kind === "unauthorized") await clearStored();
  return result;
}

/**
 * Step 10 — completes the screenshot lifecycle: best-effort deletion of a
 * standalone `MediaAsset` the panel is abandoning (Retake/Remove/replace/
 * Start New Idea, all BEFORE a Save ever attached it to a real Trade — see
 * panel.ts's call sites, all gated on "was this id ever set on the
 * draft"). Same token/401 handling as every other background→API call.
 *
 * DEDUP (service-worker lifetime only, not persisted — a fresh restart
 * simply re-attempts, which is harmless: the server's own delete is
 * naturally idempotent, a second DELETE for an already-gone id just
 * returns 404): `attempted` remembers every mediaAssetId this call has
 * already been made for, so a rapid double-click (e.g. Remove fired twice
 * before the first request's response updates the UI) sends exactly one
 * network request, not two.
 */
const attemptedDeletions = new Set<string>();

export async function deleteOrphanedMedia(mediaAssetId: string): Promise<DeleteMediaResult> {
  if (attemptedDeletions.has(mediaAssetId)) return { ok: true };
  attemptedDeletions.add(mediaAssetId);

  const { apiToken } = await getStored();
  if (!apiToken) return { ok: false, kind: "unauthorized", message: "Not connected to Traditorium." };

  const result = await deleteMedia(apiToken, mediaAssetId);
  if (!result.ok && result.kind === "unauthorized") await clearStored();
  return result;
}
