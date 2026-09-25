/**
 * Traditorium TradingView Extension — Step 5. Detection logic only — no
 * messaging, no chrome.* calls, so it's testable against a plain jsdom
 * Document/Location without mocking the extension APIs at all.
 *
 * RELIABILITY HIERARCHY (release-gate finding, live-verified against a real
 * https://www.tradingview.com/chart/ page — replaces an earlier, never
 * live-tested design; see git history for what this looked like before):
 *
 * SYMBOL, in the order tried:
 *   1. URL query parameter (`?symbol=...`) — TradingView's own public,
 *      documented deep-link contract. Read via `URLSearchParams`, zero DOM
 *      access. Only present when the page was reached via an explicit deep
 *      link; a trader's normal saved-layout URL (`/chart/<layoutId>/`) does
 *      NOT carry it — confirmed live: navigating to a saved layout with no
 *      `?symbol=` still renders the trader's chart with an empty `search`.
 *   2. `document.title` — the PRIMARY practical tier (URL is absent for most
 *      real usage). TradingView's live `/chart/` page title is NOT the
 *      "SYMBOL, INTERVAL — TradingView" format an earlier version of this
 *      module assumed (that format only appears on TradingView's static SEO
 *      pages, never confirmed live against the interactive app) — it's
 *      "SYMBOL <price> <arrow> <change>% <source>", e.g.
 *      "XAUUSD 4,272.955 ▼ −0.02% BANKS" (live-confirmed, also confirmed for
 *      a futures continuous contract: "ES1! 7,755.25 ▼ −0.15% BANKS").
 *      Parsed conservatively: a symbol-shaped token at the very start of the
 *      title, terminated by whitespace or end-of-string — never a comma,
 *      since the live price itself routinely contains one
 *      (thousands-separator) and matching on that would misidentify a
 *      fragment of the PRICE as the symbol. No exchange prefix is available
 *      at this tier (the title never carries one), but this was live-
 *      confirmed to consistently return the bare ticker across every symbol
 *      tested, unlike tier 3.
 *   3. DOM: `[aria-label="Change symbol"]` — last resort, not the primary
 *      tier. This toolbar button's `textContent` (a stable accessibility
 *      attribute, not a hashed/generated class) was INITIALLY assumed to
 *      reliably carry the full "EXCHANGE:SYMBOL" text (confirmed for
 *      "OANDA:XAUUSD", "FX:EURUSD", "CME_MINI:ES1!" on a fresh load) — but
 *      further live testing found it can ALSO render a human-readable
 *      description instead of a ticker ("Gold Spot / U.S. Dollar", "S&P 500
 *      E-mini Futures"), reproducibly, on the same page for the same
 *      symbol at a different point in the session. The exact trigger (a
 *      legend/symbol display-format setting, apparently) was not fully
 *      isolated. `document.title` was NOT observed to vary this way for any
 *      symbol tested, which is why it — not this DOM tier — is tier 2. This
 *      tier is kept only as a last-resort net: `parseTradingViewSymbol`
 *      degrades a non-ticker string to `{ display: <the whole string>,
 *      exchange: null }` rather than throwing, so a descriptive-name hit
 *      here still reports SOMETHING detected rather than corrupting state,
 *      just not a clean, Traditorium-canonical symbol.
 *
 * TIMEFRAME, in the order tried:
 *   1. DOM: `[aria-label="Change interval"]` — the toolbar's own interval
 *      button, live-confirmed to expose TradingView's raw resolution string
 *      as its text content (e.g. "5" for a 5-minute chart) via a stable
 *      accessibility attribute.
 *   2. Nothing else. There is deliberately no title-based timeframe tier.
 *      An earlier version of this module scanned `document.title` for a
 *      ", <interval>" token — but the live title's price routinely contains
 *      a comma too (see above), and that regex would silently match a
 *      FRAGMENT OF THE PRICE as if it were the timeframe (e.g. "4,272.955"
 *      → captured "272" → normalized to a fabricated "272m"), which is
 *      worse than reporting no timeframe: a confidently WRONG value instead
 *      of an honest "unavailable" one. Since tier 1 (DOM) is confirmed
 *      reliable, this tier was removed rather than patched — no title-based
 *      signal is safe enough to keep as a fallback for a bare number.
 *
 * Never used: hashed CSS class names as a PRIMARY signal, React internals,
 * private TradingView JS objects, WebSocket/network interception, or
 * monkey-patching TradingView's own code (history.pushState interception —
 * see tradingview-detect.ts — patches a BROWSER API from this extension's
 * own execution context, not TradingView's application code).
 *
 * MULTI-CHART LIMITATION (§8): `document.querySelector` returns the FIRST
 * DOM match. On a multi-pane/multi-chart layout there may be more than one
 * `[aria-label="Change symbol"]`/`[aria-label="Change interval"]` button
 * (one per pane), and the first one in DOM order is not guaranteed to be
 * the trader's currently-focused pane. This was not live-verified against a
 * real multi-chart layout. Single-chart layouts (the only configuration
 * live-tested) are unaffected.
 */
import type { DetectionSource, TradingViewChartContext, TradingViewSymbol } from "@shared/chart-context";
import { parseTradingViewSymbol } from "@shared/symbol-parser";
import { normalizeTradingViewInterval } from "@shared/timeframe-parser";

export interface DetectionEnv {
  location: Pick<Location, "search">;
  document: Pick<Document, "title" | "querySelector">;
}

function detectSymbol(env: DetectionEnv): { symbol: TradingViewSymbol; source: DetectionSource } | null {
  // Tier 1 — URL. Only present on an explicit deep link; absent for a
  // trader's normal saved-layout URL (live-confirmed).
  const params = new URLSearchParams(env.location.search);
  const urlSymbol = params.get("symbol");
  if (urlSymbol && urlSymbol.trim().length > 0) {
    return { symbol: parseTradingViewSymbol(urlSymbol), source: "url" };
  }

  // Tier 2 — document.title, the primary practical tier (see module doc
  // comment for why this outranks the DOM tier). Matches a symbol-shaped
  // token at the very start of the title, terminated by whitespace or
  // end-of-string (never a comma — the live price that follows routinely
  // contains one as a thousands separator, e.g.
  // "XAUUSD 4,272.955 ▼ −0.02% BANKS"). Deliberately conservative: requires
  // the token to be built entirely from uppercase letters/digits (plus an
  // optional EXCHANGE: prefix) so it doesn't misfire on an all-lowercase
  // generic title like "Advanced charting platform".
  const titleMatch = /^([A-Z0-9.!_-]+(?::[A-Z0-9.!_-]+)?)(?:\s|$)/.exec(env.document.title.trim());
  if (titleMatch) {
    return { symbol: parseTradingViewSymbol(titleMatch[1]!), source: "title" };
  }

  // Tier 3 — DOM: the toolbar's own "Change symbol" button, last resort
  // (see module doc comment for its reliability caveat).
  const domSymbol = queryFirstText(env.document, ['[aria-label="Change symbol"]']);
  if (domSymbol) {
    return { symbol: parseTradingViewSymbol(domSymbol), source: "dom" };
  }

  return null;
}

function detectTimeframe(env: DetectionEnv): { timeframe: string; source: DetectionSource } | null {
  // The ONLY tier — DOM: the toolbar's own "Change interval" button,
  // live-confirmed to carry TradingView's raw resolution string as its text
  // (e.g. "5" for a 5-minute chart). There is deliberately no title-based
  // fallback here — see module doc comment for why a title scan for a bare
  // number is unsafe (it can match a fragment of the live price instead).
  const domInterval = queryFirstText(env.document, ['[aria-label="Change interval"]']);
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
