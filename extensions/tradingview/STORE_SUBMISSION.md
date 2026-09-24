# Chrome Web Store submission prep

**Status: preparation only. Nothing here has been submitted.** This document collects everything a real submission needs so that step can happen quickly and deliberately in a future session — it does not itself publish, upload, or register anything with the Chrome Web Store or Microsoft Edge Add-ons.

## Extension name

**Traditorium — TradingView Companion**

(Production `manifest.json`'s `name`; the dev build appends `" (Dev)"` — see `build.mjs` — and would never be the one submitted.)

## Short description (≤132 characters, Chrome Web Store limit)

> Log Traditorium Trade Ideas straight from TradingView — strategy context, plan, screenshot, and AI-assisted recognition.

(131 characters.)

## Long description

> Traditorium — TradingView Companion connects your Traditorium trading journal to TradingView, so you can build a Trade Idea without leaving the chart you're already looking at.
>
> **What it does**
> - Detects the symbol and timeframe of the TradingView chart you have open.
> - Lets you pick one of your own Traditorium strategies and build a strategy-aware Trade Idea: direction, session, entry model, confluences, and execution confirmations — all pulled from your real strategy configuration, not reinvented here.
> - Lets you plan entry, stop-loss, and multiple targets, with R-multiples computed server-side by Traditorium itself.
> - Lets you capture a screenshot of the visible chart, preview it before uploading anything, and optionally run AI-assisted recognition to suggest entry/stop/target values read off the chart — always shown as an editable suggestion you explicitly apply, never saved automatically.
> - Saves the result as a real Traditorium Trade Idea, visible in your existing Traditorium account exactly like one created on the web app.
>
> **What it does NOT do**
> - It never places an order, connects to a brokerage, or executes any trade. This is a planning and journaling tool only — see "What this extension deliberately does not do" in the extension's own README for the full list.
> - It never reads, modifies, or interacts with TradingView's own trading tools, orders, or account data.
> - It never sends your Traditorium credentials anywhere except your own Traditorium account, via a token you create and can revoke at any time.
>
> **Requirements**
> A Traditorium account (traditorium.com) and an API token, created from Settings → Extension & API Tokens.

## Permissions justification

Production `manifest.json` (`extensions/tradingview/manifest.template.json`) requests exactly:

| Permission | Why it's requested |
|---|---|
| `storage` | Persists the Traditorium API token (`chrome.storage.local`) and the in-progress trade draft (`chrome.storage.session`) locally in the browser — nothing is synced to a Google account or any third party. See "Draft persistence" in the README. |
| `sidePanel` | Renders the extension's UI as a native Chrome side panel next to the TradingView tab, instead of a popup that closes on every click away. |
| `activeTab` | Declared as a low-friction, reviewer-familiar grant, but does not reliably authorize `chrome.tabs.captureVisibleTab` in this extension's actual UX — see the `<all_urls>` entry below for why. |

### Host permissions

| Host | Why it's requested |
|---|---|
| `https://www.tradingview.com/*` | Required for the content script (`content_scripts` in the manifest) that detects the chart's symbol/timeframe — this is the entire reason the extension exists. |
| `https://traditorium.com/*` (production) | Required for the background service worker's `fetch()` calls to Traditorium's own `/api/v1/*` API — the ONLY server this extension ever talks to. (The development build instead requests `http://localhost:3000/*`, and is never the build submitted to a store — see `build.mjs`'s production-only `localhost` validation.) |
| `<all_urls>` | Required by `chrome.tabs.captureVisibleTab` (the "Capture Chart" screenshot feature). Chrome only authorizes this call with the literal `<all_urls>` host permission or a currently-valid `activeTab` grant — and `activeTab` is only granted by a direct action-icon click, context-menu item, keyboard shortcut, or omnibox suggestion, explicitly excluding a click on a button already inside an open side panel (Chrome's own documented behavior, reproduced live during a release-gate test: `captureVisibleTab` threw `Either the '<all_urls>' or 'activeTab' permission is required.` even when the toolbar icon was clicked immediately before "Capture Chart" on the same tab). This is the same pattern nearly every screenshot/clipping extension on the Store uses for the same reason. The manifest grant is broader than the feature conceptually needs, but the extension's own code (`getActiveTradingViewTab`/`TRADINGVIEW_ORIGIN` in `background/state.ts`) still refuses to call `captureVisibleTab` on anything but a `tradingview.com` tab, regardless of what the manifest technically permits. |

**No broad `tabs` permission, no `cookies`, no `webRequest`, no `debugger`, no `desktopCapture`.** The extension cannot read or act on any page other than TradingView (via the declared content script) and, functionally, the tab the trader is actively looking at when they use a feature that needs it — even though the `<all_urls>` grant is technically broader, per the capture-permission note above.

## Screenshot privacy disclosure

The extension can capture the **full visible viewport** of the active TradingView tab (`chrome.tabs.captureVisibleTab`) — not just the chart region, since TradingView exposes no stable, publicly documented boundary for the chart container alone. This means a captured screenshot can include whatever else is visible on screen at that moment: sidebars, watchlists, notifications, or other on-page content.

Mitigations already built in:
- Capture only ever happens on an explicit "Capture Chart" / "Retake" click — never automatically, never on a timer, never on page load.
- The captured image is always shown as a local preview **before** any upload — the trader can Remove or Retake instead of uploading something they didn't intend to share.
- No screenshot is ever uploaded, analyzed, or sent anywhere until the trader clicks "Upload Screenshot".

This should be disclosed plainly in the store listing's privacy section (a possible line: *"Chart screenshots you explicitly capture and upload are sent only to your own Traditorium account, and may include anything else visible on the TradingView tab at the moment of capture."*).

## Data-use summary

| Data | Where it goes | Retention |
|---|---|---|
| Traditorium API token | `chrome.storage.local`, this browser only | Until the trader disconnects (local only) or revokes it from Traditorium (server-side) |
| In-progress trade draft (strategy/direction/plan/notes selections) | `chrome.storage.session`, this browser only | Cleared on full browser restart; never sent anywhere until Save |
| Chart screenshot | Sent to `POST https://traditorium.com/api/v1/media` only after an explicit upload click | Stored in the trader's own Traditorium account (Cloudflare R2), same as any other Traditorium-uploaded image |
| Detected symbol/timeframe | Read from the TradingView page locally; sent to Traditorium only as part of a trade the trader explicitly saves | N/A until saved |

No data is sold, shared with advertisers, or sent to any analytics/tracking service. The only network destination this extension's background service worker ever calls is `https://traditorium.com` (or the trader's configured host, for a self-hosted/dev build).

## Recognition / AI disclosure

Optional, explicit, off by default in the sense that it only runs on a trader's own "Analyze Chart" click against a screenshot the trader already chose to upload. Recognition is performed server-side by Traditorium (Claude Vision, via Anthropic's API — see "Recognition Production Audit" in `docs/tradingview-extension-resume.md`), not by the extension itself; the extension only displays the resulting suggestion and never applies it to the trade draft without an explicit "Apply Suggestions" click. This should be disclosed in the store listing: *"Chart screenshots you choose to analyze are processed by an AI vision model server-side, to suggest (never auto-apply) entry/stop/target values."*

## Privacy policy requirement

The Chrome Web Store requires a privacy policy URL for any extension that handles user data (this one does: the API token and, on request, a screenshot). **A dedicated, publicly hosted privacy policy page does not yet exist for this extension** and must be written and published (likely at a `traditorium.com/privacy` or similar URL, possibly extending an existing Traditorium privacy policy if one already covers the web app) before a real submission can be completed. This is a hard submission blocker, not optional.

## Required store assets

Not yet produced — needed before submission:
- **Icon**: already have `icons/icon128.png` (used in the manifest); the Store additionally wants a **128×128** icon supplied separately in the Developer Dashboard (same file works).
- **Screenshots**: Chrome Web Store requires at least one, recommends several, at **1280×800** or **640×400**. None exist yet — these should be captured from a real, working session against live TradingView (the side panel connected, showing the chart card, a strategy selected, a plan filled in, and ideally the screenshot-capture and recognition-suggestion states) once the live release-gate test (see the README's Release Gate) has actually been run.
- **Small promo tile** (440×280) — optional but recommended; not yet produced.
- **Marquee/large promo tile** — optional; not produced, not currently planned.

## Support URL requirement

The Store requires a support contact (a URL or email). Not yet decided — options: a `traditorium.com/support` page, a support email address, or a GitHub issues link if the repository is public. This needs a decision from the Traditorium product owner, not something this document invents on the extension's behalf.

## Review considerations

Things a Chrome Web Store reviewer is likely to specifically check, flagged here so they're not a surprise:
- **Remote code**: none. All JavaScript ships inside the package (`content.js`, `background.js`, `panel/panel.js`) — there is no `eval`, no dynamically fetched/executed script, and no CDN-loaded library (see "Extension Security Audit" in the resume doc). This is the single most common Manifest V3 rejection reason and this extension is clean on it.
- **Single, narrow content-script match**: `https://www.tradingview.com/*` only — reviewers scrutinize broad content-script matches; this one is about as narrow as the feature allows.
- **`<all_urls>` for `captureVisibleTab`**: a well-understood, reviewer-familiar pattern (many screenshot/clipping extensions use exactly this, since `activeTab` alone doesn't cover a side-panel-triggered capture) — should not itself raise flags given the disclosure above is present in the listing and the permissions justification explains why `activeTab` alone wasn't sufficient.
- **Data handling disclosure form**: the Store's own "Privacy practices" questionnaire (separate from the privacy policy URL) will need to be filled out accurately — declare that the extension handles authentication tokens and user-uploaded images sent to a single, disclosed remote server (Traditorium), and that recognition is AI-based.
- **Functionality requiring an account**: the extension is non-functional without a Traditorium account and token — this is expected and fine, but the listing description should say so plainly (already reflected above) so a reviewer isn't confused by "nothing happens" on first install.

## What this document does not do

It does not create a Chrome Web Store developer account, does not pay the one-time developer registration fee, does not upload a package, and does not fill out or submit the Store's listing form. Those are the literal next actions once this document's remaining gaps (privacy policy, screenshots, support URL) are resolved and a live TradingView E2E pass (see the README's Release Gate) has actually been performed — not before.
