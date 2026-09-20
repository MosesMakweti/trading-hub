# Traditorium — TradingView Companion

A Manifest V3 Chrome/Edge extension that puts a persistent Traditorium trading-journal panel beside a TradingView chart. It detects the chart's symbol/timeframe, lets a trader pick a strategy and build a trade plan (entry/stop/targets/notes), optionally captures a screenshot and runs AI-vision recognition on it to suggest plan values, and saves the result as a real Traditorium **Trade Idea** — the same kind of record the web app's own Add Trade form creates.

**This extension plans and logs trades. It never executes anything against a brokerage account.** There is no order placement, no MT4/MT5 integration, no trade-copier behavior, and no automatic Buy/Sell of any kind anywhere in this codebase — see "What this extension deliberately does not do" at the end of this document.

## Contents

- [Architecture](#architecture)
- [Development](#development)
- [Building](#building)
- [Loading the extension (unpacked)](#loading-the-extension-unpacked)
- [Connecting to Traditorium](#connecting-to-traditorium)
- [Normal workflow](#normal-workflow)
- [Screenshot capture & recognition](#screenshot-capture--recognition)
- [Symbol-change safety](#symbol-change-safety)
- [Draft persistence](#draft-persistence)
- [The Long/Short Position tool — investigated, not implemented](#the-longshort-position-tool--investigated-not-implemented)
- [Permissions](#permissions)
- [Security](#security)
- [Error handling](#error-handling)
- [Success experience](#success-experience)
- [Troubleshooting](#troubleshooting)
- [Testing](#testing)
- [What this extension deliberately does not do](#what-this-extension-deliberately-does-not-do)

## Architecture

### Why this lives outside `src/`

Kept in `extensions/tradingview/` as a fully self-contained package (own `package.json`, own `node_modules`, own build, own `tsconfig.json`/`eslint.config.mjs` excluded from the root repo's) rather than inside the Next.js app tree, so it:

- never depends on Next.js/React/Prisma or any of the main app's build tooling — it's a Manifest V3 extension, a fundamentally different runtime (service worker + content script + extension page, no server, no SSR);
- can be built and loaded into a browser independently of `npm run dev`/`npm run build` in the root project;
- can't accidentally import a server-only module (Prisma client, `next/server`, etc.) into code that ships to every trader's browser.

The only thing it shares with the root repo is the **API contract** (`docs/extension-api.md`) — it talks to Traditorium exclusively over `fetch()` to `/api/v1/*`, the same way any other external client would. There is no shared npm package or generated types between the two; `src/shared/*-api.ts` files are hand-typed mirrors of the server's wire contracts, verified by reading the server source directly, with no automatic drift protection beyond that discipline and the documented fixtures in `docs/extension-api.md`.

### Directory structure

```
extensions/tradingview/
  manifest.template.json    MV3 manifest, templated per build target (see build.mjs)
  build.mjs                 esbuild-based build script (bundling + manifest templating)
  icons/                    Extension icons (derived from src/app/icon.svg)
  src/
    background/              Service worker — owns the token, calls the API, routes messages
      index.ts                 Message router
      api-client.ts             Every fetch() to /api/v1/* lives here, nowhere else
      state.ts                  connect/disconnect/verify/submit/upload/analyze/capture orchestration
      storage.ts                The ONLY module touching chrome.storage.local (the token)
      draft-storage.ts          The ONLY module touching chrome.storage.session (the draft)
    content/
      tradingview-detect.ts     Runs on tradingview.com; detects, sends messages, reads nothing back
      chart-detector.ts         Pure symbol/timeframe detection logic (URL → title → DOM tiers)
    panel/
      panel.html / panel.css / panel.ts   The side panel UI
      view.ts / strategy-view.ts / trade-view.ts   Pure state → view-model mappers (unit-testable, no DOM)
      strategy-loader.ts / trade-submission.ts / screenshot.ts / recognition.ts   Pure state-machine controllers
    shared/
      messages.ts               Typed message contracts (content/panel ↔ background)
      config.ts                 API_BASE_URL (injected at build time)
      draft.ts                  TradeDraftContext — the pure, unsaved draft model and its reducers
      strategy.ts, trade-api.ts, recognition-api.ts   Hand-typed mirrors of server wire contracts
      trade-payload.ts          The one place a draft becomes a POST /api/v1/trades request body
      recognition-suggestions.ts  Recognition outcome → PlanSuggestion (pure, never mutates a draft)
      symbol-parser.ts, timeframe-parser.ts, confluence-eligibility.ts, planned-r.ts, date-key.ts, chart-context.ts, asset-compatibility.ts
  test/
    chrome-mock.ts             Minimal chrome.* mock used by every *.test.ts
    security-boundary.test.ts  Static source-scan tests enforcing the architecture invariants below
  dist/                       Build output — load THIS folder as an unpacked extension (gitignored)
```

### The core architectural invariant: the background owns everything sensitive

The panel and content script never call `fetch()`, never touch `chrome.storage.local` or `chrome.storage.session` directly, and never see the API token. Every privileged action goes through one typed message to the background service worker, which is the only place `api-client.ts`, `storage.ts`, and `draft-storage.ts` are ever imported. `test/security-boundary.test.ts` enforces this as a static source-text scan (not just a runtime behavioral test) — a future accidental "quick fetch from the panel" would fail that test even if it happened to never fire during a behavioral test run.

```
TradingView page
   │  (content script: reads nothing, decides nothing)
   ▼
chrome.runtime.sendMessage({ type: "TRADINGVIEW_DETECTED" | "CHART_CONTEXT_CHANGED" })
   │
   ▼
Background service worker  ── owns: token, draft, every API call, connection state
   ▲
   │  chrome.runtime.sendMessage({ type: "GET_STATE" | "CONNECT" | "DISCONNECT" | "REFRESH_STRATEGIES"
   │                                | "GET_STRATEGY_REFERENCE" | "SUBMIT_TRADE" | "CAPTURE_CHART"
   │                                | "UPLOAD_SCREENSHOT" | "ANALYZE_SCREENSHOT" | "GET_CHART_CONTEXT" })
   │  ◄── typed responses, NEVER containing the raw token (see @shared/messages.ts)
   │
Side panel (panel.ts) — pure rendering + pure state-machine controllers, zero chrome.* calls of its own
```

Every message type is defined once in `src/shared/messages.ts` and imported by every actor — there is no second, ad hoc `{ type: "..." }` object anywhere in the codebase.

`isActiveTabTradingView()` (background) deliberately does **not** rely on a cache built from past `TRADINGVIEW_DETECTED` messages — an MV3 service worker is unloaded when idle and restarts on the next event, so a cache built from past messages would silently go empty on restart. It's a live `chrome.tabs.query` check every time instead. The chart context works the same way (`GET_STATE` always live-queries the active tab's content script fresh via `GET_CHART_CONTEXT`) — the background never caches chart state in memory, so a service-worker restart has nothing stale to recover from.

### Token storage — security reasoning

The raw token is stored **only** in `chrome.storage.local`, written and read **only** by `src/background/storage.ts`:

- **Not `localStorage`.** `localStorage` is scoped to a page's origin and readable by any script running in that page's context, including a compromised or malicious TradingView page script. `chrome.storage.local` is extension-owned and isolated from every web page and every other extension.
- **Not in the DOM, a URL, a log, or an error message.** `panel.ts` reads the token out of the input field and passes it straight into one `sendMessage({ type: "CONNECT", token })` call — it never outlives that call in a variable. Every `api-client.ts` error path returns a fixed, generic message string, never the caught error object or the raw request — verified by tests asserting a fake token substring embedded in a mocked failure never leaks into the returned message.
- **Never reaches the TradingView page context.** The content script never imports `storage.ts`/`api-client.ts` and sends exactly one fire-and-forget detection message; it has no code path that could read the token even if it wanted to.
- **Honest limitation.** `chrome.storage.local` is not OS-keychain-encrypted — it's "as safe as Chrome's own per-extension storage sandboxing," the standard mechanism most credential-holding Chrome extensions use, not "cryptographically sealed against a compromised machine." Acceptable for this token class; worth revisiting if Traditorium ever ships a lower-privilege, shorter-lived token type.

### API client

`src/background/api-client.ts` is the only module that ever calls `fetch()` against the Traditorium API. Every function centralizes the base URL, the `Authorization: Bearer` header, and error classification into a small closed set of reasons (`unauthorized | network | server | malformed | conflict | validation | not_found | unsupported_type | too_large`) — no UI code anywhere constructs a `fetch()` call or a header itself. Functions: `getMe`, `getStrategies`, `getStrategy`, `createTrade`, `uploadMedia`, `analyzeScreenshot`, `deleteMedia`.

### API base URL — dev vs. production

`src/shared/config.ts` exports `API_BASE_URL`, sourced from a build-time constant `build.mjs` injects via esbuild's `define`:

| Command | `API_BASE_URL` | Manifest host permission | Manifest name |
|---|---|---|---|
| `npm run build:dev` | `http://localhost:3000` | `http://localhost:3000/*` | "…(Dev)" suffix |
| `npm run build` | `https://traditorium.com` | `https://traditorium.com/*` | no suffix |

`build.mjs` requires an explicit `--env=development|production` and exits with an error otherwise — it's structurally impossible to run a build with no flag and get a mystery target. A production build's `dist/manifest.json` never contains `localhost` anywhere, including `host_permissions`. The API token is never a build-time value — it's pure runtime user data entered through the UI.

### CORS

**No change was made to Traditorium's `EXTENSION_ALLOWED_ORIGINS`, and none is needed for this extension as built.** Every API call happens in the background service worker, never in the panel's or content script's own page context. An MV3 background `fetch()` to an origin listed in the manifest's `host_permissions` is exempt from browser CORS enforcement entirely. `EXTENSION_ALLOWED_ORIGINS` (`docs/extension-api.md`, `src/server/api-cors.ts`) only matters for a fetch made directly from a `chrome-extension://<id>` page context — this extension deliberately never does that, so that allowlist stays unset. If a future architecture change makes the panel fetch directly, `chrome-extension://<the-real-published-extension-id>` would need to be added at that point, not before.

### Side panel vs. popup

**Chosen: Chrome's native Side Panel API** (`chrome.sidePanel`, stable since Chrome 114) — a popup closes the instant it loses focus, unusable for "beside TradingView while I work"; a side panel stays open across tab/window focus changes until closed. `background/index.ts` calls `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` on install, wrapped defensively so an older Chromium build without the API just doesn't get the one-click convenience rather than throwing. Side Panel is Chrome/Chromium-only — Firefox and Safari have no MV3 equivalent; a cross-browser build is out of scope.

## Development

```bash
cd extensions/tradingview
npm install
npm test              # vitest — mocks every chrome.* API and the network boundary
npx tsc --noEmit       # typecheck (isolated tsconfig — root repo's tsc never sees this package)
```

No running Traditorium instance or browser is required to run the test suite.

## Building

```bash
npm run build:dev      # → dist/, points at http://localhost:3000
npm run build           # → dist/, points at https://traditorium.com
```

## Loading the extension (unpacked)

1. Build a target (above).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer Mode** (top-right toggle).
4. Click **Load unpacked** and select `extensions/tradingview/dist` — the folder `dist`'s own `manifest.json` lives in, not the `tradingview` folder itself.
5. "Traditorium — TradingView Companion" (or "…(Dev)") appears in the extensions list.

## Connecting to Traditorium

A trader needs a Traditorium API token to connect the extension. As of this step, there's a real web UI for this — no CLI required for a normal (non-development) trader:

1. In Traditorium, go to **Settings → Extension & API Tokens** (`/settings/integrations`).
2. Click **Create Token**, give it a name (e.g. "TradingView extension"), and click Create.
3. The raw token is shown **exactly once**, in a copyable field, with the exact copy: *"Copy this token now. For security, Traditorium cannot display it again."* Traditorium's database only ever stores a SHA-256 hash of it (`ApiToken.tokenHash`) — there is no "reveal" or "reset and view" affordance anywhere, by design.
4. In the extension's side panel, click **"Connect Traditorium,"** paste the token, and click **Connect**.
5. Every panel state that mentions Settings (the disconnected view, the connect form's hint, and the footer's "Manage Tokens" link) links directly to this real `${API_BASE_URL}/settings/integrations` page — never an invented URL, and always built from the same `API_BASE_URL` the rest of the extension uses (dev token management points at `localhost:3000`, production at `traditorium.com`).
6. To revoke access later (lost device, rotating credentials, done testing), go back to that same Settings page and click **Revoke** next to the token — a confirmation dialog explains that anything using it, including a connected extension, stops working immediately. Revocation is irreversible; there is no "un-revoke."

A developer-only alternative remains for local testing without going through the browser UI:
```bash
npm run create:dev-api-token -- --email=you@example.com --name="Extension dev" --confirm=CREATE-DEV-TOKEN
```

Once connected, the panel shows "● Connected to Traditorium," the trader's name, and their real strategy count. The connection persists across panel close/reopen and browser restarts (`chrome.storage.local`) — it re-verifies the stored token against `GET /api/v1/me` in the background rather than trusting a cache; a 401 anywhere (including a revoked token discovered mid-session) clears the stored token immediately and the panel returns to disconnected.

## Normal workflow

1. Open a TradingView chart tab; open the Traditorium side panel (toolbar icon). The **Chart** card shows the detected symbol/timeframe, live-synced as the trader changes either on the chart — no reload, no manual refresh.
2. If connected, the **Strategy** card lets the trader pick a real Traditorium strategy, direction, session/entry model, and confluences/execution confirmations, all direction-filtered per Traditorium's own eligibility rules.
3. The **Chart Screenshot** card lets the trader capture the visible tab, optionally run AI recognition on it for suggested plan values (see below), and upload it — all fully optional and independent of everything else.
4. The **Trade Plan** card holds entry/stop/targets (with a live, non-authoritative R-multiple preview per target) and three note fields (collapsible — click "Notes ▾"/"Notes ▴" — defaults open so existing notes are never hidden without an explicit click).
5. **Save Trade Idea** creates a real Traditorium Trade via the same `POST /api/v1/trades` contract the web app's own Add Trade form uses. The result is a normal Trade — Today, Journal, Analytics, and Performance Account all see it exactly as if logged from the web app. **No broker order is ever placed** — the button is labeled "Save Trade Idea," never "Execute"/"Place Trade"/"Buy"/"Sell."
6. On success, a compact summary appears using only the actual returned trade data (see "Success experience" below), with a real "View in Traditorium" link and an "Add Another" button that clears the setup-specific fields (plan, confluences, notes) while preserving strategy/direction/session/entry model for the next setup in the same session.

## Screenshot capture & recognition

### Capture

**API**: `chrome.tabs.captureVisibleTab` — the browser's own screenshot primitive, a pixel snapshot of the visible tab. No DOM reconstruction, no html2canvas, no TradingView canvas/internals access, no network interception. Capture only ever happens on an explicit "Capture Chart" (or "Retake") click — never automatically, not on load, not on symbol change, not periodically.

**Scope**: the full visible viewport, exactly as the trader sees it — cropping to just the chart region was investigated and not implemented, because TradingView's chart container has no stable, publicly documented boundary the extension could rely on without a brittle, unverified CSS selector. A fragile crop would be worse than no crop; this ships the honest, uncropped version.

**Privacy**: because the full viewport is captured, it can include whatever else is on screen — sidebars, watchlists, notifications, account info. The local preview is always shown **before** any upload, so the trader can "Remove"/"Retake" instead of uploading something they didn't intend to share. No screenshot is ever uploaded automatically.

**Standalone upload architecture**: `/api/media/upload` (the web app's existing route) requires an already-existing owner (a Trade) at upload time — but capture is deliberately decoupled from trade creation, so a trader can capture/preview before deciding to save anything. `POST /api/v1/media` (new) calls `createStandaloneMediaAsset()`, which creates a bare `MediaAsset` row with no `MediaAttachment` — valid as a `mediaAssetId` with zero owner record required. That id is later sent as a top-level field on `POST /api/v1/trades`, and `attachPlanScreenshot` (unmodified) resolves it — no new "attach" endpoint was needed.

### Recognition (AI vision suggestions)

Once a screenshot is uploaded, an **"Analyze Chart"** button appears. Clicking it calls `POST /api/v1/media/:id/recognize-trade-plan`, which runs the same provider architecture the web app's own recognition feature uses (`ClaudeVisionRecognitionProvider`, gated on `ANTHROPIC_API_KEY`, falling back to a `NullRecognitionProvider` that always fails with a friendly "not configured" message when the key is unset — **unset in this development environment**, confirmed by inspecting `.env`/`.env.local`). This is a genuinely new server-side function, `recognizeStandaloneMediaAsset`, built the same way `createStandaloneMediaAsset` was: it extracts the trade-independent half of the existing `runRecognition` (provider resolution + invocation) into a shared helper and skips persistence entirely, since a pre-trade asset has no `Trade`/`TradePlanScreenshot` row to persist a result against. The trade-scoped recognition path used elsewhere in Traditorium is completely unchanged.

**A recognition attempt that finds nothing, or fails for a provider reason (no API key, rate limit, model error), is a normal `200 ok:true` response wrapping a `RECOGNITION_FAILED` outcome — not a request failure.** Only a genuine request-level problem (401, 404, network, 500) is treated as an error in the UI. This means "Analyze Chart" always resolves to either a suggestion or a plain, honest "nothing was detected" message — never a scary error state for what is, functionally, just "the AI didn't find anything usable."

**Suggestions are never applied automatically.** `toPlanSuggestion` is a pure mapping from the raw recognition result to symbol/timeframe/direction/entry/stop/targets, never fabricating a value the provider didn't actually return. The recognized fields are shown read-only in a "Recognized Trade Plan" card with **"Apply Suggestions"** and **"Dismiss"** buttons — `applyPlanSuggestion` (`@shared/draft.ts`) is the *only* function that ever mutates the draft from a suggestion, and it only runs on that explicit click. Applying targets replaces the target list outright (not a merge); a warning ("This will replace values you've already entered") is shown first if the draft already has entry/stop/target values. Applying a suggestion **never touches** strategy, direction, session, confluences, execution confirmations, or notes — by scope, not by a bolted-on check, so a recognized symbol/direction can never silently override the trader's own chart-derived context. If the recognized symbol/direction differs from what TradingView itself reports, a short informational line calls that out next to the suggestion (`describeContextConflict`) — informational only; it never blocks or auto-resolves anything.

**Deletion**: a standalone, never-attached screenshot can be deleted via `DELETE /api/v1/media/:id`. `deleteStandaloneMediaAsset` refuses (409) if the asset has *any* `MediaAttachment` row or is referenced by *any* `TradePlanScreenshot` (as either `mediaAssetId` or `previewMediaAssetId`) — an attached or already-used image can never be deleted through this path, by construction. This exists for future orphan cleanup tooling; the extension itself doesn't currently call it (Retake/Remove leave the old asset orphaned server-side, same as before this step — see "Retake / Remove" below).

### Retake / Remove

- **Retake/Remove before upload**: local state only, no server call, no orphan.
- **Retake/Remove after upload**: the draft's local `mediaAssetId` reference is cleared immediately (so a Save click in the gap before a new upload finishes can't silently attach a stale image), but the old `MediaAsset` remains on the server, unattached. Deleting it is now technically possible (`DELETE /api/v1/media/:id`, above) but the panel doesn't call it automatically on Retake/Remove — a click meaning "I don't want this attached to a trade" is not necessarily the same intent as "delete my data," so this extension leaves that as a deliberate non-decision rather than silently deleting on the trader's behalf. A future cleanup pass (server-side batch job, or a "clean up unused screenshots" affordance) can safely reuse the same endpoint.

## Symbol-change safety

A draft's `originSymbol` locks in the moment it first has real content (`hasMaterialDraftContent`/`ensureOriginSymbol` in `@shared/draft.ts`) — the first symbol the trader was actually looking at when they started building a plan. From that point on, `buildCreateTradePayload` reads the **locked** `originSymbol`, not the live chart, as the trade's `assetSymbol` — this is what makes the warning UI meaningful rather than cosmetic: even if the trader keeps a stale draft open while the chart moves on, the payload builder itself can't accidentally submit a plan built for XAUUSD as an EURUSD trade.

If TradingView's live symbol later diverges from that locked origin, a **"Chart changed"** warning card appears with two choices:
- **Keep Draft** — acknowledges this specific new symbol (`acknowledgeSymbolMismatch`) and dismisses the warning; the draft still submits under its original locked symbol. A *further* change to a third, different symbol re-triggers the warning — acknowledging one drift doesn't silence all future ones.
- **Start New Idea** — resets the draft (plan, screenshot, recognition, submission state) and re-locks the origin symbol to the new chart (`startNewIdeaForSymbol`).

The trade's identity is never silently mutated either way — the trader always makes an explicit choice.

## Draft persistence

The unsaved trade draft lives in `chrome.storage.session` (`src/background/draft-storage.ts`), the one module that owns this decision:

- **Survives** a side-panel close/reopen (a side panel's page is torn down when closed — a plain in-memory variable could not survive this).
- **Survives** a service-worker restart (the background's own module-level memory is wiped on idle restart).
- **Does not survive** a full browser restart — deliberate. A strategy-in-progress draft silently reappearing in a brand-new browsing session, on a different day, against whatever chart happens to be open, was judged the wrong default for something this ephemeral; starting clean was judged safer than resurrecting stale context. `chrome.storage.local` (which does survive a restart) remains available if this decision is ever revisited — changing `draft-storage.ts` alone would do it; no other module knows or cares which storage area backs the draft.

The draft carries **no token and no secret** at any point (enforced by a static source-scan test) — it's plan-only, unsaved data by design.

## The Long/Short Position tool — investigated, not implemented

TradingView's Long/Short Position drawing tool was investigated as a possible richer source of entry/stop/target values than manual entry or screenshot recognition. **Conclusion: not implemented, and not planned without further live-browser access to actually verify a mechanism.**

Reasoning: every detection tier this extension successfully uses elsewhere (symbol/timeframe's URL query param, `document.title`, and even the best-effort DOM legend/toolbar selectors) works because TradingView exposes that information as either a documented URL contract or ordinary, text-bearing DOM nodes. A drawn chart object like the Position tool is fundamentally different — TradingView renders its charts, including drawn tool overlays, onto an HTML `<canvas>`, not as separate DOM elements with readable attributes. There is no analogous "read the text out of a DOM node" tier available for a drawn tool's entry/stop/target price levels the way there is for the symbol legend or the interval toolbar.

The only ways to actually read a drawn tool's values would be:
1. **TradingView's internal/private JS chart-object APIs** — explicitly out of scope (this project's own rules prohibit relying on private/undocumented TradingView APIs), and also the least stable option since it isn't a documented, versioned surface.
2. **Pixel/image inference from the canvas** — i.e., running recognition on it, which is exactly what screenshot recognition (above) already does, generically, for any visible chart annotation a trader has drawn, not just the Position tool specifically.

Given that, and given no live TradingView browser session was available during this project to even attempt a DOM-based investigation, forcing an implementation here would mean either violating the "no private API" rule or shipping an unverified, likely-broken feature — both worse than not having it. Screenshot recognition remains the sanctioned mechanism for anything a trader has drawn on the chart, including a Position tool; manual entry remains fully available regardless. The extension is fully functional end-to-end without Position-tool detection — it was never a dependency of anything else built here.

## Permissions

`manifest.template.json` declares exactly:

| Permission | Why |
|---|---|
| `storage` | `chrome.storage.local` (token) and `chrome.storage.session` (draft) — the only two things this extension persists. |
| `sidePanel` | The persistent trading-companion panel. |
| `activeTab` | The minimal grant for `chrome.tabs.captureVisibleTab`, scoped to "only after the trader clicks something in this extension." One of the Chrome Web Store's explicitly low-friction permissions, designed for exactly this pattern. |
| Host permission: `https://www.tradingview.com/*` | Injects the detection content script and lets `chrome.tabs.query` return that tab's `url` without the broader `tabs` permission. |
| Host permission: API origin (`https://traditorium.com/*` prod, `http://localhost:3000/*` dev) | Lets the background service worker `fetch()` Traditorium's API — see "CORS" above for why this is what actually matters, not a server-side CORS change. |

**Not requested, and not needed by anything built in this project**: the broader `tabs`, `scripting`, `webRequest`, `debugger`, `desktopCapture`, `<all_urls>`, `cookies`, `clipboardRead`/`clipboardWrite`. This list is unchanged since the extension's foundation — recognition, media deletion, and the token-management web UI are all ordinary authenticated `fetch()` calls the background already had permission to make; none of them required a new browser permission.

## Security

A checklist covering the token/API/media/recognition surface, re-verified as of this pass:

| Area | Status |
|---|---|
| Token generation | `randomBytes(32)` (256 bits), SHA-256 hashed at rest, never logged, shown to the trader exactly once at creation. |
| Token transport | Bearer header only, over HTTPS in production; never a query param, cookie, or request body field. |
| Token revocation | Immediate — `revokeApiToken` sets `revokedAt`; `verifyApiToken` rejects a revoked/expired/unknown token with the SAME generic 401 body in every case (`requireApiUser`, `src/server/api-auth.ts`), so a caller can't distinguish "wrong token" from "revoked token" as a guessing oracle. |
| API authorization | Every `/api/v1/*` route calls `requireApiUser`, never `requireUser()` (the session-cookie guard) — confirmed by reading every route handler in `src/app/api/v1/`. |
| Cross-user isolation | Every service function scopes its Prisma query to the authenticated `userId` (trades, strategies, media, recognition) — verified directly for the two newest paths (`recognizeStandaloneMediaAsset`, `deleteStandaloneMediaAsset`) with real cross-user integration tests, not just a code read. |
| Media ownership | A standalone `MediaAsset` is scoped to `userId` at creation and re-checked at every subsequent read/recognize/delete — never trusted from a prior response. |
| Media deletion safety | `deleteStandaloneMediaAsset` refuses (409) if the asset has any `MediaAttachment` or is referenced by any `TradePlanScreenshot` — an attached or already-used image is structurally unable to be deleted through this path. |
| Recognition provider errors | Sanitized before reaching the client — `ClaudeVisionRecognitionProvider`'s error branches (auth/rate-limit/API/network) return fixed, generic messages, never the raw provider exception, header values, or the API key. |
| CORS | Reflects `Origin` only for exact matches in `EXTENSION_ALLOWED_ORIGINS` (unset today — correct, since nothing fetches cross-origin from a page context); never `Access-Control-Allow-Origin: *`; never `Access-Control-Allow-Credentials` (auth is an explicit header, not an ambient cookie). |
| Host permissions | Scoped to exactly `tradingview.com` and the one real API origin — no `<all_urls>`. |
| `activeTab` | Only grants tab access after an explicit user click in the extension UI — never used ambiently. |
| Message validation | Every message is a typed, closed-union `{ type: "..." }` object (`@shared/messages.ts`) — the background's router is a `switch` over the same union, so an unrecognized/malformed message type is a compile-time impossibility, not a runtime guard. |
| Malformed API responses | Every `api-client.ts` function validates the response shape before trusting it and returns a `malformed`/`server` failure rather than throwing or passing through `undefined` fields. |
| Logging | The content script only logs (to the page console) when pointed at `localhost` (a dev build), and never anything token-related — it has no import of, or access to, the token/storage modules at all. No telemetry or analytics exist anywhere in this extension. |
| Screenshot privacy | Disclosed above under "Screenshot capture & recognition" — full-viewport capture, always previewed before upload, never automatic. |
| Token-management UI | Reuses the existing `createApiTokenAction`/`listApiTokensAction`/`revokeApiTokenAction` server actions verbatim — no new backend authorization logic was introduced for it. The raw token is rendered once, from the action's own return value, never re-fetched or re-displayed on a later page load; `tokenHash` is never selected into any response type reachable by this UI. |

### Rate limiting — deferred, documented

**Not implemented.** No rate-limiting infrastructure (Redis, an edge middleware, a request-counting table) exists anywhere in the root Traditorium repo today — confirmed by searching the codebase directly. Building a bespoke in-memory limiter inside a single route handler would be actively misleading in a serverless/multi-instance deployment (each instance would count independently, giving no real protection while looking like protection exists). The correct fix is deployment-level (a platform rate limiter, or a shared store like Redis/Upstash) applied uniformly across all of `/api/v1/*`, not something this extension's own scope should invent piecemeal. This is the same conclusion `docs/extension-api.md` already reached for the base API — nothing about the recognition/deletion/token-management additions changes it.

## Error handling

Every failure surface a trader can actually hit, and how it's handled — never a stack trace, never the raw provider/database error, and the trader's in-progress work (draft, uploaded screenshot reference, pending idempotency key) is preserved wherever a retry is the correct next action:

| Scenario | Behavior |
|---|---|
| Invalid/revoked token entered | "The Traditorium token is invalid or has been revoked." + Try again. |
| Token becomes invalid mid-session (revoked elsewhere) | Any 401 from any endpoint clears the stored token immediately; the panel returns to disconnected on its next state check. |
| Network unreachable (any call) | "Could not reach Traditorium." — draft/pending state preserved, retry is safe. |
| Server 500 / unexpected status | "Traditorium returned an unexpected error (`<status>`)." |
| Malformed response body | "Traditorium sent an unexpected response." — never a JSON-parse exception surfacing raw. |
| Trade save: 409 conflict | Shown distinctly ("this request conflicts with a previous submission") — never silently retried with a new idempotency key. |
| Trade save: 422 validation | The server's structured `issues[]` rendered directly; a 422 with no issues array still shows the server's own message. |
| Trade save: network/500 | Draft AND the pending idempotency key both preserved — "Try again" resubmits the exact same logical attempt, never creating a duplicate trade. |
| Screenshot upload: unsupported type / too large | The server's own specific message (`errorMessageOf`), not a generic one — the trader knows exactly what to fix. |
| Screenshot upload: network/server error | Local preview and capture state preserved — "Upload Screenshot" can be retried without recapturing. |
| Recognition: no provider configured / found nothing | **Not an error** — a normal "nothing was detected on this screenshot" message (see "Screenshot capture & recognition" above). |
| Recognition: request-level failure (401/404/network) | A real error state, distinct from the above, with a retry path via "Analyze Chart" again. |
| Chart not detected | "Chart context unavailable" or a partial line naming which half is missing — never a fabricated symbol/timeframe. |
| No TradingView tab open/active | "Open a TradingView chart tab to capture it." |
| Capture fails (tab not visible, etc.) | "Could not capture the chart. Make sure the TradingView tab is visible and try again." |
| Chart symbol drifts from the draft's locked origin | The "Chart changed" warning card (see "Symbol-change safety") — never a silent identity change, never a hard error either. |
| Strategy load fails | A scoped error under the Strategy card only — doesn't take down the rest of the panel. |
| Empty token submitted | "Enter a Traditorium API token." — caught client-side before any network call. |

## Success experience

On a successful save, the panel shows a compact summary built **only from the actual returned trade DTO** — never from local draft state, so it always reflects what was really persisted (including a replayed/idempotent-retry response, which correctly reports the trade's true state rather than assuming "yes" to everything just because the local session thinks it uploaded a screenshot):

```
XAUUSD · LONG · London Continuation · 2 targets · Screenshot attached
```

Each segment is optional and only appears when the underlying data is present: strategy name is omitted for a strategy-less trade, "Screenshot attached" only appears when the returned `hasPlanScreenshot` is `true`. Any non-fatal warning from the save (e.g. "plan: Could not save the planned targets.") is shown separately, distinctly, from the same response — the trade is still saved even when a plan sub-step didn't fully succeed, matching the server's own leniency exactly. "View in Traditorium" links to the real, existing `/journal/[date]/trades/[tradeId]` route built from the trade's own returned `dateKey`/`id` — never a guessed URL.

## Troubleshooting

- **"Chart context unavailable" while a chart is clearly loaded** — the DOM-detection tier (`src/content/chart-detector.ts`'s `queryFirstText` selectors) is best-effort and was built without live-browser access; open DevTools on the TradingView page, right-click the symbol/interval, "Inspect," and compare against the selectors in that file. URL and `document.title` detection (tiers 1–2) should still work for most charts even if DOM selectors need adjusting.
- **Panel shows disconnected after being connected** — the stored token was rejected (401) somewhere, most often because it was revoked from Settings → Extension & API Tokens. Reconnect with a fresh token.
- **"Analyze Chart" always says nothing was detected** — check whether `ANTHROPIC_API_KEY` is set in the Traditorium deployment's environment; without it, recognition always returns the same honest "not configured" outcome by design, not a bug.
- **A captured screenshot looks wrong / shows things you didn't want to share** — click "Retake" or "Remove" before clicking "Upload Screenshot"; nothing is sent until that explicit second click.
- **Extension doesn't appear after "Load unpacked"** — make sure you selected `extensions/tradingview/dist`, not `extensions/tradingview` itself; `dist` is only created after a successful `npm run build`/`build:dev`.
- **Changes to source don't show up in the browser** — rebuild (`npm run build:dev`), then click the refresh icon on the extension's card at `chrome://extensions` (a rebuild alone doesn't hot-reload).

## Testing

### Automated

```bash
cd extensions/tradingview
npm test              # vitest — 26 test files, 351 tests as of this pass
npx tsc --noEmit
node build.mjs --env=development
node build.mjs --env=production
```

All of the above pass cleanly as of this documentation pass. From the repo root, the full backend suite (`npx vitest run`), typecheck (`npx tsc --noEmit`), lint (`npm run lint`), and a production build (`npm run build`) were also run — see the final report in the session this step was completed in for exact counts.

### Manual end-to-end verification

**Live browser/TradingView E2E was not performed as part of building this step** — this environment has no browser automation or live TradingView access available. Everything above (architecture, message flow, error/success rendering, security boundaries) is verified by the automated suite, which mocks every `chrome.*` API and the network boundary; it does **not** prove the DOM-detection tier works against TradingView's actual current markup, nor does it prove the real Anthropic Claude Vision provider correctly recognizes a real chart image (only its request/response wiring is tested with a mocked API).

To verify manually, a trader/developer with a browser should:

1. Follow "Loading the extension (unpacked)" and "Connecting to Traditorium" above end-to-end.
2. Open a real TradingView chart and confirm the Chart card shows the correct symbol/timeframe, and that changing either on the chart updates the panel within a few seconds with no reload.
3. Pick a strategy, direction, and a few confluences/execution confirmations; confirm direction-filtering behaves as described above.
4. Click "Capture Chart," confirm the preview matches what's on screen, click "Upload Screenshot," then click "Analyze Chart":
   - If `ANTHROPIC_API_KEY` is set server-side, confirm real suggested values appear and that "Apply Suggestions" only changes entry/stop/targets, never strategy/direction/notes.
   - If it's not set, confirm the honest "nothing was detected" message appears rather than an error.
5. Change the chart's symbol after starting a plan and confirm the "Chart changed" warning appears with working "Keep Draft"/"Start New Idea" buttons.
6. Fill out a full Trade Plan and click "Save Trade Idea"; confirm the success summary matches this document's "Success experience" section, and that the trade appears correctly in Traditorium's Journal/Today/Analytics with the screenshot attached.
7. Delete the throwaway trade(s) afterward.
8. Go to Settings → Extension & API Tokens, create a token, confirm it shows exactly once with a working Copy button, then revoke it and confirm the extension disconnects on its next check.

Never paste a bearer token into any log, screenshot, or note while doing this walkthrough.

## What this extension deliberately does not do

No broker order execution of any kind. No MT4/MT5 integration. No trade-copier behavior. No automatic Buy/Sell. No realized PnL entry, Trade Review, or Trade Execution feature. No changes to Journal, Analytics, or Replay. No TradingView drawing/Position-tool parsing (see above — investigated, not implemented). No private/undocumented TradingView API usage. No network interception. No screen recording or periodic/automatic screenshotting — capture only ever happens on an explicit click. No telemetry or analytics. "Save Trade Idea" is the only save label used anywhere — never "Execute," "Place Trade," "Buy," or "Sell," because this extension creates a Trade Idea, a plan, never an order against a brokerage account.
