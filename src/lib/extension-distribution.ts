/**
 * Traditorium for TradingView — how the browser extension is distributed.
 * The single source of truth for Settings → Integrations' install card.
 *
 * Private beta: a versioned static ZIP served from `public/downloads/`
 * (published by `npm run release:web` in extensions/tradingview), installed
 * by the trader via Chrome's Developer mode → "Load unpacked". The package
 * holds no secrets (the API base URL is public and auth is a per-user token
 * created after install), so a static file is the simplest secure option —
 * no route handler, no filesystem reads at request time.
 *
 * Chrome Web Store later: set `EXTENSION_DISTRIBUTION` to
 * `{ channel: "chrome-web-store", storeUrl: "<real listing URL>" }` — the
 * card swaps its CTA to "Install from Chrome Web Store" and drops the
 * Developer-mode steps; nothing else changes.
 */

/** Must equal extensions/tradingview/package.json + manifest version
 *  (enforced by extension-distribution.test.ts). */
export const EXTENSION_VERSION = "0.1.0";
export const EXTENSION_RELEASE_LABEL = "Private Beta";
export const EXTENSION_MIN_CHROME_VERSION = 114;
export const EXTENSION_FILENAME = `traditorium-tradingview-${EXTENSION_VERSION}.zip`;

export type ExtensionDistribution =
  | { channel: "direct-download"; downloadPath: string }
  | { channel: "chrome-web-store"; storeUrl: string };

export const EXTENSION_DISTRIBUTION: ExtensionDistribution = {
  channel: "direct-download",
  downloadPath: `/downloads/${EXTENSION_FILENAME}`,
};

export type ExtensionCta = { label: string; href: string; download: string | null; external: boolean };

export function extensionCta(distribution: ExtensionDistribution): ExtensionCta {
  return distribution.channel === "chrome-web-store"
    ? { label: "Install from Chrome Web Store", href: distribution.storeUrl, download: null, external: true }
    : { label: "Download Extension", href: distribution.downloadPath, download: EXTENSION_FILENAME, external: false };
}

/** Developer-mode install — shown only for the direct-download channel. */
export const DIRECT_INSTALL_STEPS: readonly string[] = [
  "Download the extension ZIP.",
  "Unzip it — you'll get a folder named traditorium-tradingview-" + EXTENSION_VERSION + ".",
  "Open Google Chrome.",
  "Go to chrome://extensions (type it into the address bar).",
  "Turn on Developer mode (top-right toggle).",
  "Click Load unpacked.",
  "Select the unzipped folder (the one containing manifest.json).",
  "Pin Traditorium from the puzzle-piece Extensions menu.",
  "Open a chart on TradingView.",
  "Click the Traditorium icon to open the Traditorium Companion side panel.",
];

export const CONNECT_STEPS: readonly string[] = [
  "Install the extension.",
  "Create an extension token below.",
  "Copy the token.",
  "Open the Traditorium Companion on TradingView.",
  "Click Paste Token, paste it, and click Connect.",
];
