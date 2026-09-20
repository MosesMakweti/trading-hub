/**
 * Traditorium TradingView Extension — Step 5. Detection logic only — no
 * messaging, no chrome.* calls, so it's testable against a plain jsdom
 * Document/Location without mocking the extension APIs at all.
 *
 * RELIABILITY HIERARCHY ACTUALLY APPLIED (§2), in the order tried:
 *
 *   1. URL query parameter (`?symbol=...`) — TradingView's own public,
 *      documented deep-link contract (the same mechanism its own "Share
 *      chart" link uses). Read via `URLSearchParams`, zero DOM access.
 *      SYMBOL ONLY — TradingView's chart URL does not reliably encode the
 *      selected interval/timeframe as a query parameter (verified: a
 *      `?symbol=` deep link controls the initial symbol only; the interval
 *      is workspace/session UI state). This is the one place §4 and §6
 *      genuinely differ in what's available at this tier.
 *   2. `document.title` — TradingView updates the browser tab title from
 *      its own client-side JS once a chart is loaded (confirmed indirectly:
 *      TradingView's server-rendered SEO pages already embed the symbol in
 *      <title>, e.g. "XAUUSD Chart — Gold Spot Price Today — TradingView";
 *      the interactive /chart/ page's *initial* HTML title is generic
 *      until hydration, after which TradingView's own app sets a live,
 *      chart-specific title the same way most trading tools do for
 *      multi-tab usability). Parsed with a best-effort, clearly-scoped
 *      regex — this module never assumes a single exact title format and
 *      degrades to null rather than mis-parsing.
 *   3. DOM — a narrowly-scoped, defensive query for a toolbar element that
 *      might expose the interval as visible text. THIS TIER IS UNVERIFIED
 *      against the live TradingView site (no live browser access was
 *      available while building this) and is documented as best-effort in
 *      extensions/tradingview/README.md — it must be checked, and likely
 *      adjusted, during manual verification. It is wrapped so a wrong or
 *      missing selector degrades to null, never throws.
 *
 * Never used: hashed CSS class names as a PRIMARY signal, React internals,
 * private TradingView JS objects, WebSocket/network interception, or
 * monkey-patching TradingView's own code (history.pushState interception —
 * see tradingview-detect.ts — patches a BROWSER API from this extension's
 * own execution context, not TradingView's application code).
 */
import type { DetectionSource, TradingViewChartContext, TradingViewSymbol } from "@shared/chart-context";
import { parseTradingViewSymbol } from "@shared/symbol-parser";
import { normalizeTradingViewInterval } from "@shared/timeframe-parser";

export interface DetectionEnv {
  location: Pick<Location, "search">;
  document: Pick<Document, "title" | "querySelector">;
}

function detectSymbol(env: DetectionEnv): { symbol: TradingViewSymbol; source: DetectionSource } | null {
  // Tier 1 — URL.
  const params = new URLSearchParams(env.location.search);
  const urlSymbol = params.get("symbol");
  if (urlSymbol && urlSymbol.trim().length > 0) {
    return { symbol: parseTradingViewSymbol(urlSymbol), source: "url" };
  }

  // Tier 2 — document.title. Matches an EXCHANGE:SYMBOL or bare SYMBOL
  // token near the start of the title, stopping at a separator TradingView
  // commonly uses ("," "·" "—" "-"). Deliberately conservative: requires
  // 2+ uppercase letters/digits so it doesn't misfire on an all-lowercase
  // generic title like "Advanced charting platform".
  const titleMatch = /^([A-Z0-9]+(?::[A-Z0-9.!_-]+)?)\s*[,·—-]/.exec(env.document.title.trim());
  if (titleMatch) {
    return { symbol: parseTradingViewSymbol(titleMatch[1]!), source: "title" };
  }

  // Tier 3 — DOM (best-effort, unverified — see module doc comment).
  const domSymbol = queryFirstText(env.document, [
    '[data-name="legend-source-item"] [data-name="legend-source-title"]',
    '[data-name="legend-series-item"]',
  ]);
  if (domSymbol) {
    return { symbol: parseTradingViewSymbol(domSymbol), source: "dom" };
  }

  return null;
}

function detectTimeframe(env: DetectionEnv): { timeframe: string; source: DetectionSource } | null {
  // Tier 2 — document.title (tier 1/URL is not reliably available for
  // interval — see module doc comment). Looks for ", <interval>" or
  // "· <interval>" shortly after the symbol token.
  const titleMatch = /[,·]\s*([0-9]+[SDWMsdwm]?|[DWM])\b/.exec(env.document.title.trim());
  if (titleMatch) {
    const normalized = normalizeTradingViewInterval(titleMatch[1]!);
    if (normalized) return { timeframe: normalized, source: "title" };
  }

  // Tier 3 — DOM (best-effort, unverified — see module doc comment).
  const domInterval = queryFirstText(env.document, [
    '[data-name="header-toolbar-intervals"] [data-value]',
    '[aria-label="Change interval"]',
    '[data-name="header-toolbar-intervals"]',
  ]);
  if (domInterval) {
    const normalized = normalizeTradingViewInterval(domInterval);
    if (normalized) return { timeframe: normalized, source: "dom" };
  }

  return null;
}

function queryFirstText(document: Pick<Document, "querySelector">, selectors: string[]): string | null {
  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      const text = el?.textContent?.trim();
      if (text) return text;
    } catch {
      // An invalid/unsupported selector must never crash detection.
    }
  }
  return null;
}

export function detectChartContext(env: DetectionEnv, now: () => number = Date.now): TradingViewChartContext {
  const symbolResult = detectSymbol(env);
  const timeframeResult = detectTimeframe(env);

  return {
    symbol: symbolResult?.symbol ?? null,
    timeframe: timeframeResult?.timeframe ?? null,
    detected: symbolResult != null || timeframeResult != null,
    symbolSource: symbolResult?.source ?? null,
    timeframeSource: timeframeResult?.source ?? null,
    updatedAt: now(),
  };
}
