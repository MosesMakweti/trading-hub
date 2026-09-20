# Traditorium — TradingView Companion

A Manifest V3 Chrome/Edge extension that puts a persistent Traditorium trading-journal panel beside a TradingView chart. It detects the chart's symbol/timeframe, lets a trader pick a strategy and build a trade plan (entry/stop/targets/notes), optionally captures a screenshot and runs AI-vision recognition on it to suggest plan values, and saves the result as a real Traditorium **Trade Idea** — the same kind of record the web app's own Add Trade form creates.

**This extension plans and logs trades. It never executes anything against a brokerage account.** There is no order placement, no MT4/MT5 integration, no trade-copier behavior, and no automatic Buy/Sell of any kind anywhere in this codebase — see "Known limitations" for the full list of what this extension deliberately does not do.

**Release status: release candidate `0.1.0`, not yet release-verified.** Everything in this document is backed by an automated test suite and clean builds; the one thing that has NOT happened is a real, live end-to-end run against TradingView in an actual browser (no browser automation or live TradingView access exists in the environment this was built in). See "Release checklist" before distributing this to any real trader.

## Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Features](#features)
4. [Security model](#security-model)
5. [Permissions](#permissions)
6. [Development setup](#development-setup)
7. [Build](#build)
8. [Load unpacked](#load-unpacked)
9. [Connect to Traditorium](#connect-to-traditorium)
10. [Trading workflow](#trading-workflow)
11. [Screenshot privacy](#screenshot-privacy)
12. [Recognition](#recognition)
13. [Testing](#testing)
14. [Production build & packaging](#production-build--packaging)
15. [Chrome / Edge compatibility](#chrome--edge-compatibility)
16. [Release checklist](#release-checklist)
17. [Troubleshooting](#troubleshooting)
18. [Known limitations](#known-limitations)

## Overview

Traditorium is a trading journal. This extension is a thin, purpose-built companion that lets a trader build a Trade Idea while looking at a live TradingView chart, instead of switching tabs and re-typing what they were just looking at. Everything it creates is a normal Traditorium record — Today, Journal, Analytics, and Performance Account all see an extension-created trade exactly as if it had been logged from the web app, because the extension calls the exact same domain services the web app's own Server Actions call, through a small, authenticated `/api/v1` adapter layer (`docs/extension-api.md`).

Nothing here is a second trading system. There is no `ExtensionTrade` model, no duplicated strategy database, no duplicated analytics — see "Architecture" below for how that's enforced by construction, not just by convention.

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
  build.mjs                 esbuild-based build script (bundling + manifest templating + prod validation)
  package.mjs               Deterministic release packaging (npm run package)
  icons/                    Extension icons (derived from src/app/icon.svg)
  src/
    background/              Service worker — owns the token, calls the API, routes messages
      index.ts                 Message router
      api-client.ts             Every fetch() to /api/v1/* lives here, nowhere else
      state.ts                  connect/disconnect/verify/submit/upload/analyze/capture/delete orchestration
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
      strategy.ts, trade-api.ts, media-api.ts, recognition-api.ts   Hand-typed mirrors of server wire contracts
      trade-payload.ts          The one place a draft becomes a POST /api/v1/trades request body
      recognition-suggestions.ts  Recognition outcome → PlanSuggestion (pure, never mutates a draft)
      symbol-parser.ts, timeframe-parser.ts, confluence-eligibility.ts, planned-r.ts, date-key.ts, chart-context.ts, asset-compatibility.ts
  test/
    chrome-mock.ts             Minimal chrome.* mock used by every *.test.ts
    security-boundary.test.ts  Static source-scan tests enforcing the architecture invariants below
  dist/                       Build output — load THIS folder as an unpacked extension (gitignored)
  releases/                   Packaged release ZIPs (npm run package — gitignored)
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
   │                                | "GET_STRATEGY_REFERENCE" | "CREATE_TRADE" | "CAPTURE_CHART"
   │                                | "UPLOAD_CAPTURE" | "ANALYZE_SCREENSHOT" | "DELETE_MEDIA"
   │                                | "GET_CHART_CONTEXT" | "SET_DRAFT" })
   │  ◄── typed responses, NEVER containing the raw token (see @shared/messages.ts)
   │
Side panel (panel.ts) — pure rendering + pure state-machine controllers, zero chrome.* calls of its own
```

Every message type is defined once in `src/shared/messages.ts` and imported by every actor — there is no second, ad hoc `{ type: "..." }` object anywhere in the codebase.

`isActiveTabTradingView()` (background) deliberately does **not** rely on a cache built from past `TRADINGVIEW_DETECTED` messages — an MV3 service worker is unloaded when idle and restarts on the next event, so a cache built from past messages would silently go empty on restart. It's a live `chrome.tabs.query` check every time instead. The chart context works the same way (`GET_STATE` always live-queries the active tab's content script fresh via `GET_CHART_CONTEXT`) — the background never caches chart state in memory, so a service-worker restart has nothing stale to recover from.

### API client

`src/background/api-client.ts` is the only module that ever calls `fetch()` against the Traditorium API. Every function centralizes the base URL, the `Authorization: Bearer` header, and error classification into a small closed set of reasons (`unauthorized | network | server | malformed | conflict | validation | not_found | unsupported_type | too_large | protected`) — no UI code anywhere constructs a `fetch()` call or a header itself. Functions: `getMe`, `getStrategies`, `getStrategy`, `createTrade`, `uploadMedia`, `analyzeScreenshot`, `deleteMedia`.

### API base URL — dev vs. production

`src/shared/config.ts` exports `API_BASE_URL`, sourced from a build-time constant `build.mjs` injects via esbuild's `define`:

| Command | `API_BASE_URL` | Manifest host permission | Manifest name |
|---|---|---|---|
| `npm run build:dev` | `http://localhost:3000` | `http://localhost:3000/*` | "…(Dev)" suffix |
| `npm run build` | `https://traditorium.com` | `https://traditorium.com/*` | no suffix |

`build.mjs` requires an explicit `--env=development|production` and exits with an error otherwise — it's structurally impossible to run a build with no flag and get a mystery target. A production build additionally fails outright if the actual dev host string (`http://localhost:3000` or `http://localhost:3000/*`) is found anywhere in the built `manifest.json`/`background.js`/`content.js`/`panel.js` bytes — see "Production build & packaging." The API token is never a build-time value — it's pure runtime user data entered through the UI.

### CORS

**No change was made to Traditorium's `EXTENSION_ALLOWED_ORIGINS`, and none is needed for this extension as built.** Every API call happens in the background service worker, never in the panel's or content script's own page context. An MV3 background `fetch()` to an origin listed in the manifest's `host_permissions` is exempt from browser CORS enforcement entirely. `EXTENSION_ALLOWED_ORIGINS` (`docs/extension-api.md`, `src/server/api-cors.ts`) only matters for a fetch made directly from a `chrome-extension://<id>` page context — this extension deliberately never does that, so that allowlist stays unset. If a future architecture change makes the panel fetch directly, `chrome-extension://<the-real-published-extension-id>` would need to be added at that point, not before.

### Side panel vs. popup

**Chosen: Chrome's native Side Panel API** (`chrome.sidePanel`, stable since Chrome 114) — a popup closes the instant it loses focus, unusable for "beside TradingView while I work"; a side panel stays open across tab/window focus changes until closed. `background/index.ts` calls `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` on install, wrapped defensively so an older Chromium build without the API just doesn't get the one-click convenience rather than throwing.

## Features

- **Chart detection** — symbol and timeframe, live-synced with the TradingView tab (URL, `document.title`, and a best-effort DOM fallback; see "Known limitations" for the DOM tier's honest caveat).
- **Strategy-aware Trade Idea building** — pick a real Traditorium strategy, direction, session, entry model, and direction-filtered confluences/execution confirmations, sourced live from the strategy's own configuration.
- **Trade planning** — entry, stop-loss, and multiple targets, with a live (non-authoritative) R-multiple preview; three optional note fields (Market Context, Areas of Interest, Reason for Trade).
- **Chart capture** — a one-click screenshot of the visible TradingView tab, always previewed locally before any upload.
- **AI-assisted recognition** — an optional "Analyze Chart" step that suggests entry/stop/target values read off an uploaded screenshot; always reviewable, never auto-applied (see "Recognition").
- **Canonical trade creation** — "Save Trade Idea" creates a real Traditorium Trade via the exact same `POST /api/v1/trades` contract the web app's own Add Trade form uses. **No broker order is ever placed** — the button is labeled "Save Trade Idea," never "Execute"/"Place Trade"/"Buy"/"Sell."
- **Symbol-change protection** — a draft locks onto the symbol it was started against (`originSymbol`) the moment it has real content, and warns rather than silently reassigning it if the trader's live chart later diverges. See "Trading workflow."
- **Draft persistence** — survives a side-panel close/reopen and a service-worker restart; deliberately does not survive a full browser restart. See "Trading workflow."
- **Screenshot lifecycle cleanup** — a screenshot the trader abandons before ever attaching it to a saved trade (Retake, Remove, a fresh capture over an old one, or "Start New Idea") is best-effort deleted server-side, not left as a permanent orphan. See "Screenshot privacy."
- **Token-based connection** — a self-service Settings → Extension & API Tokens page to create/revoke a scoped API token; no shared credentials, no session-cookie reuse.

## Security model

A checklist covering the token/API/media/recognition surface:

| Area | Status |
|---|---|
| Token generation | `randomBytes(32)` (256 bits), SHA-256 hashed at rest, never logged, shown to the trader exactly once at creation. Verified with real integration tests (`src/server/services/api-tokens.service.test.ts`). |
| Token transport | Bearer header only, over HTTPS in production; never a query param, cookie, or request body field. |
| Token storage (extension side) | `chrome.storage.local` only, written/read only by `src/background/storage.ts` — never `localStorage` (page-script-readable), never the DOM, a URL, a log, or an error message. The panel reads a pasted token out of its input field and hands it to one `sendMessage({ type: "CONNECT", token })` call; it never outlives that call in a variable. The content script has no import of, or access to, the token/storage modules at all — structurally cannot leak it. `chrome.storage.local` is not OS-keychain-encrypted; acceptable for this token class, worth revisiting if Traditorium ever ships a lower-privilege, shorter-lived token type. |
| Token revocation | Immediate — `revokeApiToken` sets `revokedAt`; `verifyApiToken` rejects a revoked/expired/unknown token with the SAME generic 401 body in every case (`requireApiUser`, `src/server/api-auth.ts`), so a caller can't distinguish "wrong token" from "revoked token" as a guessing oracle. A revoked token's 401 clears the extension's locally stored credential immediately (`verifyAndRefresh`/`submitCreateTrade`/`uploadCapture`/`analyzeScreenshotAsset`/`deleteOrphanedMedia`, all in `background/state.ts`) — the panel's next state check reports disconnected without any further action from the trader. |
| Ownership scoping | Every user can only manage their own tokens — `revokeApiTokenAction` called by another user is a no-op, proven with a real cross-user integration test. |
| API authorization | Every `/api/v1/*` route calls `requireApiUser`, never `requireUser()` (the session-cookie guard) — confirmed by reading every route handler in `src/app/api/v1/`, and pinned by a dedicated regression test (`src/server/api-auth.test.ts`) proving a NextAuth-shaped session cookie with no `Authorization` header is never treated as a credential. |
| Cross-user isolation | Every service function scopes its Prisma query to the authenticated `userId` (trades, strategies, media, recognition) — verified with real cross-user integration tests across every route (`src/app/api/v1/**/*.test.ts`), not just a code read. A cross-user or unknown resource resolves to the SAME 404 as a genuinely nonexistent one — no oracle. |
| Media ownership | A standalone `MediaAsset` is scoped to `userId` at creation and re-checked at every subsequent read/recognize/delete — never trusted from a prior response. |
| Media deletion safety | `deleteStandaloneMediaAsset` refuses (409) if the asset has any `MediaAttachment` or is referenced by any `TradePlanScreenshot` — an attached or already-used image is structurally unable to be deleted through this path. The extension's own cleanup (`deleteOrphanedMedia`) treats a 409 as a normal, silent, non-retried outcome — see "Screenshot privacy." |
| No client-provided `userId` | No request schema anywhere under `/api/v1` accepts a `userId` field; the authenticated token's own resolved user is always the owner, proven explicitly (`"never accepts a userId from the request body"`, `src/app/api/v1/media/route.test.ts`). |
| Recognition provider errors | Sanitized before reaching the client — `ClaudeVisionRecognitionProvider`'s error branches (auth/rate-limit/timeout/generic API/network/refusal/malformed) return fixed, generic messages, never the raw provider exception, header values, or the API key. Directly unit-tested with a constructor-injected fake client (`src/domain/trade-plan/providers/claude-vision-provider.test.ts`) covering all of those paths plus empty/partial/full structured responses. |
| CORS | Reflects `Origin` only for exact matches in `EXTENSION_ALLOWED_ORIGINS` (unset today — correct, since nothing fetches cross-origin from a page context); never `Access-Control-Allow-Origin: *`; never `Access-Control-Allow-Credentials` (auth is an explicit header, not an ambient cookie). |
| Host permissions | Scoped to exactly `tradingview.com` and the one real API origin — no `<all_urls>`. |
| `activeTab` | Only grants tab access after an explicit user click in the extension UI — never used ambiently. |
| Message validation | Every message is a typed, closed-union `{ type: "..." }` object (`@shared/messages.ts`) — the background's router is a `switch` over the same union, so an unrecognized/malformed message type is a compile-time impossibility, not a runtime guard. The background never trusts a message payload merely because it arrived from an extension context — every field is typed and every downstream call validates/classifies before use, the same discipline applied to any external input. |
| Malformed API responses | Every `api-client.ts` function validates the response shape before trusting it and returns a `malformed`/`server` failure rather than throwing or passing through `undefined` fields. |
| Bundle contents | No `eval`, no dynamically fetched/executed script, no remote code of any kind — every byte the extension runs ships inside the package. No TradingView private/undocumented API usage, no WebSocket/network interception, no injection of screenshot bytes back into the TradingView page context. |
| Logging | The content script only logs (to the page console) when pointed at `localhost` (a dev build), and never anything token-related. No telemetry or analytics exist anywhere in this extension. |
| Screenshot privacy | See "Screenshot privacy" below — full-viewport capture, always previewed before upload, never automatic, best-effort deleted if abandoned. |
| Token-management UI | Reuses the existing `createApiTokenAction`/`listApiTokensAction`/`revokeApiTokenAction` server actions verbatim — no new backend authorization logic was introduced for it. The raw token is rendered once, from the action's own return value, never re-fetched or re-displayed on a later page load; `tokenHash` is never selected into any response type reachable by this UI. |

### Rate limiting — deferred, documented as a deployment-level requirement

**Not implemented, and deliberately not faked.** No rate-limiting infrastructure (Redis, an edge middleware, a request-counting table) exists anywhere in the root Traditorium repo today — confirmed by searching the codebase directly, and no `vercel.json` currently configures one either. A bespoke in-memory limiter inside a single route handler would be actively misleading in a serverless/multi-instance deployment (each instance counts independently, giving no real protection while looking like protection exists) — this extension's scope deliberately does not add one.

The correct fix is deployment-level, applied uniformly across all of `/api/v1/*`, not invented piecemeal per route. **If/when this project is deployed on Vercel**, the recommended mechanism is the **Vercel Firewall (WAF)** — it can apply rate-limiting rules per path with no new application dependency and no code change, configured either from the project's Firewall dashboard tab or declaratively in `vercel.json`'s `firewall` configuration. Recommended targeting:

| Path | Suggested treatment |
|---|---|
| `/api/v1/trades` (POST) | Per-IP (and ideally per-token, if the platform supports header-based keying) rate limit, stricter than reads — writes are the most expensive/highest-stakes surface. |
| `/api/v1/media` (POST) | Per-IP rate limit that's also size/frequency-aware — file uploads are the single most expensive request shape in this app. |
| `/api/v1/media/:id/recognize-trade-plan` (POST) | Per-IP rate limit — this is the one endpoint that triggers a real third-party AI API call per request, so uncontrolled volume has a direct cost. |
| `/api/v1/*` generally (including `/me`, `/strategies*`) | A generous, cheap-tier limit on `requireApiUser`'s call path is the ideal single choke point if a future application-level limiter is ever built — every route already funnels through that one function. |

This is a **recommendation to evaluate**, not an infrastructure change made by this pass — enabling Vercel Firewall rules (or an equivalent on whatever platform is actually used) is a deployment/ops decision for whoever manages that project, and was not performed here.

## Permissions

`manifest.template.json` declares exactly:

| Permission | Why |
|---|---|
| `storage` | `chrome.storage.local` (token) and `chrome.storage.session` (draft) — the only two things this extension persists. |
| `sidePanel` | The persistent trading-companion panel. |
| `activeTab` | The minimal grant for `chrome.tabs.captureVisibleTab`, scoped to "only after the trader clicks something in this extension." One of the Chrome Web Store's explicitly low-friction permissions, designed for exactly this pattern. |
| Host permission: `https://www.tradingview.com/*` | Injects the detection content script and lets `chrome.tabs.query` return that tab's `url` without the broader `tabs` permission. |
| Host permission: API origin (`https://traditorium.com/*` prod, `http://localhost:3000/*` dev) | Lets the background service worker `fetch()` Traditorium's API — see "CORS" above for why this is what actually matters, not a server-side CORS change. |

**Not requested, and not needed by anything built in this project**: the broader `tabs`, `scripting`, `webRequest`, `debugger`, `desktopCapture`, `<all_urls>`, `cookies`, `clipboardRead`/`clipboardWrite`. Recognition, media deletion, and the token-management web UI are all ordinary authenticated `fetch()` calls the background already had permission to make; none of them required a new browser permission. See `STORE_SUBMISSION.md` for the store-listing-facing version of this justification.

## Development setup

```bash
cd extensions/tradingview
npm install
npm test              # vitest — mocks every chrome.* API and the network boundary
npx tsc --noEmit       # typecheck (isolated tsconfig — root repo's tsc never sees this package)
```

No running Traditorium instance or browser is required to run the test suite.

## Build

```bash
npm run build:dev      # → dist/, points at http://localhost:3000
npm run build           # → dist/, points at https://traditorium.com, plus prod validation (see below)
```

See "Production build & packaging" for what the production build additionally validates, and for `npm run package`.

## Load unpacked

1. Build a target (above).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer Mode** (top-right toggle).
4. Click **Load unpacked** and select `extensions/tradingview/dist` — the folder `dist`'s own `manifest.json` lives in, not the `tradingview` folder itself.
5. "Traditorium — TradingView Companion" (or "…(Dev)") appears in the extensions list.

## Connect to Traditorium

A trader needs a Traditorium API token to connect the extension:

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

## Trading workflow

1. Open a TradingView chart tab; open the Traditorium side panel (toolbar icon). The **Chart** card shows the detected symbol/timeframe, live-synced as the trader changes either on the chart — no reload, no manual refresh.
2. If connected, the **Strategy** card lets the trader pick a real Traditorium strategy, direction, session/entry model, and confluences/execution confirmations, all direction-filtered per Traditorium's own eligibility rules.
3. The **Chart Screenshot** card lets the trader capture the visible tab, optionally run AI recognition on it for suggested plan values (see "Recognition"), and upload it — all fully optional and independent of everything else.
4. The **Trade Plan** card holds entry/stop/targets (with a live, non-authoritative R-multiple preview per target) and three note fields (collapsible — click "Notes ▾"/"Notes ▴" — defaults open so existing notes are never hidden without an explicit click).
5. **Save Trade Idea** creates a real Traditorium Trade via the same `POST /api/v1/trades` contract the web app's own Add Trade form uses. The result is a normal Trade — Today, Journal, Analytics, and Performance Account all see it exactly as if logged from the web app.
6. On success, a compact summary appears using only the actual returned trade data — never local draft state, so it always reflects what was really persisted:

   ```
   XAUUSD · LONG · London Continuation · 2 targets · Screenshot attached
   ```

   Each segment is optional and only appears when the underlying data is present. A real "View in Traditorium" link points at the exact returned trade's `/journal/[date]/trades/[tradeId]` route. "Add Another" clears the setup-specific fields (plan, confluences, notes, screenshot) while preserving strategy/direction/session/entry model for the next setup in the same session — no cleanup call is made for that screenshot, since it's now legitimately attached to the trade that was just created.

### Symbol-change safety

A draft's `originSymbol` locks in the moment it first has real content (`hasMaterialDraftContent`/`ensureOriginSymbol` in `@shared/draft.ts`) — the first symbol the trader was actually looking at when they started building a plan. From that point on, `buildCreateTradePayload` reads the **locked** `originSymbol`, not the live chart, as the trade's `assetSymbol` — even if the trader keeps a stale draft open while the chart moves on, the payload builder itself can't accidentally submit a plan built for XAUUSD as an EURUSD trade.

If TradingView's live symbol later diverges from that locked origin, a **"Chart changed"** warning card appears with two choices:
- **Keep Draft** — acknowledges this specific new symbol (`acknowledgeSymbolMismatch`) and dismisses the warning; the draft still submits under its original locked symbol. A *further* change to a third, different symbol re-triggers the warning — acknowledging one drift doesn't silence all future ones.
- **Start New Idea** — resets the draft (plan, screenshot, recognition, submission state), best-effort deletes any orphaned screenshot the old idea had uploaded, and re-locks the origin symbol to the new chart (`startNewIdeaForSymbol`).

The trade's identity is never silently mutated either way — the trader always makes an explicit choice. A momentary detection gap (the active tab briefly isn't recognized as TradingView, or the content script isn't reachable yet) reports a `null` current symbol, which `ensureOriginSymbol`/the warning UI both treat as "nothing to compare yet," never as an implicit symbol change — the warning only ever fires on a genuine, confirmed different symbol, and a timeframe-only change never triggers it at all (only symbol identity is safety-relevant here).

### Draft persistence

The unsaved trade draft lives in `chrome.storage.session` (`src/background/draft-storage.ts`), the one module that owns this decision:

- **Survives** a side-panel close/reopen (a side panel's page is torn down when closed — a plain in-memory variable could not survive this).
- **Survives** a service-worker restart (the background's own module-level memory is wiped on idle restart).
- **Does not survive** a full browser restart — deliberate. A strategy-in-progress draft silently reappearing in a brand-new browsing session, on a different day, against whatever chart happens to be open, was judged the wrong default for something this ephemeral; starting clean was judged safer than resurrecting stale context.

The draft carries **no token and no secret** at any point (enforced by a static source-scan test) — it's plan-only, unsaved data by design.

## Screenshot privacy

**API**: `chrome.tabs.captureVisibleTab` — the browser's own screenshot primitive, a pixel snapshot of the visible tab. No DOM reconstruction, no html2canvas, no TradingView canvas/internals access, no network interception. Capture only ever happens on an explicit "Capture Chart" (or "Retake") click — never automatically, not on load, not on symbol change, not periodically, never a screen recording.

**Scope**: the full visible viewport, exactly as the trader sees it — cropping to just the chart region was investigated and not implemented, because TradingView's chart container has no stable, publicly documented boundary the extension could rely on without a brittle, unverified CSS selector. A fragile crop would be worse than no crop; this ships the honest, uncropped version. **Because the full viewport is captured, it can include whatever else is on screen** — sidebars, watchlists, notifications, account info. The local preview is always shown **before** any upload, so the trader can Remove/Retake instead of uploading something they didn't intend to share. No screenshot is ever uploaded automatically.

**Standalone upload architecture**: `POST /api/v1/media` creates a bare `MediaAsset` row with no `MediaAttachment` — capture/preview works independently of trade creation, and the resulting id is only later attached to a trade via `POST /api/v1/trades`'s existing `mediaAssetId` field.

**Deletion / lifecycle cleanup**: a standalone, never-attached screenshot can be deleted via `DELETE /api/v1/media/:id`, which refuses (409) if the asset is already attached to anything. The extension now automatically uses this: every point where the panel abandons a screenshot it had already uploaded — **Retake, Remove, capturing a fresh chart over an existing one, or "Start New Idea"** — fires a best-effort `DELETE_MEDIA` message alongside clearing the draft's local reference (`panel.ts::cleanupOrphanedMedia` → `background/state.ts::deleteOrphanedMedia`). This is deliberately **best-effort, not a guarantee**:

- **Fire-and-forget, never awaited by the panel.** A network failure, a slow response, or the browser closing mid-request never blocks the UI or leaves the draft in a half-updated state.
- **A 409 ("already attached") is a normal, silent outcome, never retried.** The server remains authoritative — if a race means the asset got attached to a real Trade in the gap between deciding to clean it up and the request landing, the server simply refuses and the asset survives, correctly.
- **Duplicate requests are avoided** at the background level (an in-memory "already attempted" set, scoped to the service worker's current lifetime) — a rapid double-click sends exactly one DELETE, not two.
- **Browser-shutdown cleanup is NOT guaranteed.** Closing the browser in the exact instant between a Retake/Remove click and the fire-and-forget request completing can leave one screenshot orphaned server-side. This is an honestly-documented gap, not a correctness or security issue — an orphaned, never-attached screenshot is inert and costs only storage. A future server-side batch job (sweeping standalone `MediaAsset` rows past some age) would close this gap completely without any extension-side change.
- **After a successful Save, no cleanup is attempted** — the asset is now legitimately attached to the real Trade that was just created.

## Recognition

Once a screenshot is uploaded, an **"Analyze Chart"** button appears. Clicking it calls `POST /api/v1/media/:id/recognize-trade-plan`, which runs through this pipeline:

```
MediaAsset (standalone, owned by the caller)
  ↓ ownership re-checked (userId + mediaAssetId, 404 if not this user's)
ClaudeVisionRecognitionProvider (gated on ANTHROPIC_API_KEY; NullRecognitionProvider otherwise)
  ↓ structured fields (RecognitionFieldResult[]) or a sanitized RECOGNITION_FAILED
toPlanSuggestion (@shared/recognition-suggestions.ts — pure mapping, fabricates nothing)
  ↓
"Recognized Trade Plan" card (read-only, with a context-conflict note if relevant)
  ↓ ONLY on explicit "Apply Suggestions" click
applyPlanSuggestion (@shared/draft.ts) → editable draft (entry/stop/targets only)
```

Same provider architecture the web app's own recognition feature uses — `recognizeStandaloneMediaAsset` extracts the trade-independent half of the existing `runRecognition` (provider resolution + invocation) into a shared `recognizeImage()` helper both paths call; nothing about the trade-scoped recognition path used elsewhere in Traditorium was changed.

**Verified failure-mode handling** (`claude-vision-provider.test.ts`, with a constructor-injected fake client — no real network call): provider unavailable (no key), unsupported image MIME, invalid/rejected credentials, rate-limited, request timeout, a generic provider API error, a model refusal, a malformed response (no structured tool call), an empty response (zero fields — a normal `COMPLETE` outcome, not a failure), a partial response (some fields dropped, others kept), and a full response (symbol/timeframe/direction/entry/stop/multiple targets). **A recognition attempt that finds nothing, or fails for a provider reason, is a normal `200 ok:true` response wrapping a `RECOGNITION_FAILED` outcome — not a request failure.** Only a genuine request-level problem (401, 404, network, 500) is treated as an error in the UI.

**Suggestions are never applied automatically, and the Trade is never auto-created from a recognition result.** `toPlanSuggestion` never fabricates a value the provider didn't actually return. `applyPlanSuggestion` is the *only* function that ever mutates the draft from a suggestion, and it only runs on the trader's explicit "Apply Suggestions" click. Applying targets replaces the target list outright (a warning is shown first if the draft already has entry/stop/target values). Applying a suggestion **never touches** strategy, direction, session, confluences, execution confirmations, or notes — by scope, not by a bolted-on check. If the recognized symbol, timeframe, or direction differs from what TradingView itself reports (or what the trader already selected), a short informational line calls that out — informational only; it never blocks or auto-resolves anything, and the chart/selection is always what's kept.

**Cross-user access** is impossible by construction — `recognizeStandaloneMediaAsset` scopes its `MediaAsset` lookup to `{ id, userId }`; a cross-user or unknown id resolves to the same 404, with no oracle distinguishing the two (tested explicitly).

**No provider credential ever reaches the extension.** `ANTHROPIC_API_KEY` is read only by `ClaudeVisionRecognitionProvider.isAvailable()`/`recognize()` (`src/domain/trade-plan/providers/claude-vision-provider.ts`), server-side, inside the root Traditorium application — never referenced by anything under `extensions/tradingview/`, never sent in any API response, and never bundled into `dist/`.

### Production recognition configuration

- **Requirement**: `ANTHROPIC_API_KEY` set in the Traditorium **server's** environment (Vercel project environment variables, or the equivalent for whatever platform actually hosts it) — never in this extension's build, never in a `.env` file committed to the repo.
- **Behavior when absent** (the current state of this development environment, confirmed by inspecting `.env`/`.env.local`): `resolveRecognitionProvider()` falls back to `NullRecognitionProvider`, which always returns a real, exercised `RECOGNITION_FAILED` outcome with the friendly message *"Automatic recognition isn't configured for this workspace yet. Enter the plan manually below."* — never an error, never a broken UI state.
- **Setting the key activates real recognition for the web app AND this extension simultaneously**, with zero additional code on either side — no vendor is hardcoded into the extension itself; it only ever calls Traditorium's own `/api/v1/media/:id/recognize-trade-plan`.
- **This pass did not, and could not, insert a real secret into source** — no `ANTHROPIC_API_KEY` value exists anywhere in this repository, committed or otherwise, and none was printed at any point during this work. Provisioning the key in the actual deployment's environment configuration is an operational step for whoever manages that deployment, not something a code change can do.

## Testing

### Automated

```bash
cd extensions/tradingview
npm test              # vitest
npx tsc --noEmit
node build.mjs --env=development
node build.mjs --env=production
npm run package        # production build + zip + package inspection
```

From the repo root, the full backend suite (`npm test`), typecheck (`npm run typecheck`), lint (`npm run lint`), and a production build (`npm run build`) are also run as part of any release pass — see `docs/tradingview-extension-resume.md` for the exact counts as of the most recent one.

### What "passing" does NOT prove

The automated suite mocks every `chrome.*` API and the network boundary. It does **not** prove the DOM-detection fallback tier works against TradingView's actual current markup, and it does **not** prove the real Anthropic Claude Vision provider correctly recognizes a real chart image (only its request/response wiring and error-mapping are tested, against a fake client — never a live network call). See "Release checklist" for the one thing that closes that gap.

## Production build & packaging

`npm run build` (production target) additionally **validates its own output** before declaring success: it scans the built `manifest.json`/`background.js`/`content.js`/`panel/panel.js` bytes for the actual development host strings (`http://localhost:3000`, `http://localhost:3000/*`) and fails the build if either appears, and confirms the manifest was correctly templated to the real production API base URL. (A bare substring search for the word "localhost" would false-positive on `tradingview-detect.ts`'s own dev-logging guard, `API_BASE_URL.includes("localhost")` — which legitimately contains that word as a comparison target, evaluated to `false` once `API_BASE_URL` is the production URL — so the check targets the real host strings specifically, not the word.)

`npm run package` (`package.mjs`) always runs a **fresh** production build first (never packages a stale or development `dist/`), then zips exactly `dist/`'s own contents — never `src/`, `test/`, `node_modules/`, `.env`, secrets, logs, or any other development artifact, because `dist/` never contains any of those in the first place (it's already the minimal runtime output `build.mjs` produces). The result lands at `extensions/tradingview/releases/traditorium-tradingview-<version>.zip` (gitignored, like `dist/`). The script then lists every entry in the produced ZIP and fails if anything outside the known runtime set (`manifest.json`, `background.js`, `content.js`, `icons/`, `panel/`) or matching a forbidden pattern (`.env*`, `node_modules`, `*.test.ts`, `*.map`, `.git*`) is present.

A dedicated secret scan (bearer/`td_live_` tokens, `ANTHROPIC_API_KEY`, `AUTH_SECRET`, AWS/R2 credentials, a live `DATABASE_URL`) was run against both `dist/` and the packaged ZIP as part of this release-candidate pass — clean, no matches. Re-run this scan on every future package before considering it distributable.

## Chrome / Edge compatibility

Manifest V3 APIs this extension actually depends on:

| API | Minimum Chromium version | Notes |
|---|---|---|
| Manifest V3 (`manifest_version: 3`) | 88 | Baseline. |
| `chrome.sidePanel` | 114 | The hard floor — the extension's entire UI delivery mechanism. Wrapped defensively (`?.`) so an older build just doesn't get the one-click "open on toolbar click" convenience rather than throwing, but the panel itself needs this API to exist at all. |
| Service worker background (`"type": "module"`) | 88+ (MV3 baseline) | Native ESM import/export in the service worker. |
| `chrome.storage.session` | 102 | Backs draft persistence. |
| `chrome.storage.local` | Long-standing | Backs token storage. |
| `chrome.tabs.captureVisibleTab` | Long-standing | Backs chart capture. |
| `activeTab` | Long-standing | Backs both of the above's permission grant. |

**Practical minimum: Chrome/Chromium 114**, set by `chrome.sidePanel` — everything else this extension uses is available well before that version. `build.mjs`'s esbuild target (`chrome114`) matches this exactly, so the JavaScript syntax emitted is never more modern than what the minimum supported version can run.

**Supported**: Google Chrome and Chromium-based Microsoft Edge, both 114+. One package serves both — Edge implements the same `chrome.*` extension APIs (including `sidePanel`) with no separate build, submission, or code path needed; there is no real technical reason to maintain two.

**Not supported, and not claimed anywhere in this project**: Firefox (no Manifest V3 Side Panel equivalent) and Safari (a fundamentally different extension model). No compatibility shims or polyfills for either exist or are planned.

## Release checklist

Things that are true as of this release candidate, and the one thing that isn't yet:

- [x] Full automated test suite passing (extension + relevant root suites)
- [x] Clean TypeScript across both the extension and the root repo
- [x] Clean development and production builds
- [x] Deterministic package (`npm run package`) producing an inspected, secret-scanned ZIP
- [x] Security audit (token, API, media, recognition, manifest permissions) — see "Security model"
- [x] Canonical architecture confirmed — no duplicate domain models (see `docs/tradingview-extension-resume.md`)
- [ ] **Real, live TradingView end-to-end verification** — not yet performed in this environment

**The extension must not be considered release-verified (Chrome Web Store submission, or handing it to a real trader) until the checklist below has actually been run, manually, in a real browser against a live TradingView chart.** This replaces every earlier, overlapping step-by-step manual-verification list in this document's history — this is the one to use:

```text
1. Start Traditorium locally.
2. Create a TradingView extension token.
3. Build/load the production or release-candidate extension.
4. Open TradingView.
5. Open XAUUSD on 5m.
6. Open the Traditorium side panel.
7. Connect.
8. Verify XAUUSD · 5m detection.
9. Select a compatible real strategy.
10. Select LONG/SHORT.
11. Select session and entry model.
12. Select confluences and confirmations.
13. Capture the visible TradingView tab.
14. Inspect the screenshot before upload.
15. Upload.
16. Run Analyze if recognition is configured.
17. Review/edit the suggested plan.
18. Add at least two targets.
19. Add notes.
20. Save the Trade Idea.
21. Verify a success response.
22. Open it in Traditorium.
23. Verify the Trade/plan/targets/screenshot/Performance Account.
24. Verify no execution/PnL was created.
25. Change the TradingView symbol while a second draft exists and verify the symbol-change warning + protection.
26. Test Retake/Remove and confirm the old screenshot is cleaned up (or, if it wasn't, confirm it's an orphaned-but-harmless standalone asset, never something attached to a trade it shouldn't be).
27. Revoke the extension's token from Settings → Extension & API Tokens.
28. Verify the extension loses API access on its next check.
```

Never paste a bearer token into any log, screenshot, or note while doing this walkthrough.

## Troubleshooting

- **"Chart context unavailable" while a chart is clearly loaded** — the DOM-detection tier (`src/content/chart-detector.ts`'s `queryFirstText` selectors) is best-effort and was built without live-browser access; open DevTools on the TradingView page, right-click the symbol/interval, "Inspect," and compare against the selectors in that file. URL and `document.title` detection (tiers 1–2) should still work for most charts even if DOM selectors need adjusting. **This extension reports "unavailable" rather than a guessed/wrong symbol on purpose — see "Known limitations."**
- **Panel shows disconnected after being connected** — the stored token was rejected (401) somewhere, most often because it was revoked from Settings → Extension & API Tokens. Reconnect with a fresh token.
- **"Analyze Chart" always says nothing was detected** — check whether `ANTHROPIC_API_KEY` is set in the Traditorium deployment's environment; without it, recognition always returns the same honest "not configured" outcome by design, not a bug.
- **A captured screenshot looks wrong / shows things you didn't want to share** — click "Retake" or "Remove" before clicking "Upload Screenshot"; nothing is sent until that explicit second click.
- **Extension doesn't appear after "Load unpacked"** — make sure you selected `extensions/tradingview/dist`, not `extensions/tradingview` itself; `dist` is only created after a successful `npm run build`/`build:dev`.
- **Changes to source don't show up in the browser** — rebuild (`npm run build:dev`), then click the refresh icon on the extension's card at `chrome://extensions` (a rebuild alone doesn't hot-reload).
- **`npm run package` fails with "zip: command not found"** — the script shells out to the system `zip`/`unzip` binaries (present by default on macOS/Linux); install them (or run on a machine that has them) rather than adding a bundler dependency for a one-shot developer command.

## Known limitations

- **Live TradingView end-to-end has not yet been performed.** No browser automation or live TradingView access exists in the environment this was built in. See "Release checklist" — this is the one hard gate before calling this release-verified.
- **The DOM-detection fallback tier is unverified against live TradingView markup.** URL and `document.title` detection are the ones actually confirmed reliable. The DOM tier is best-effort, and — per this pass's own audit — deliberately conservative: it never guesses or invents a symbol/timeframe it isn't confident about. `Unavailable` is the correct, honest outcome when detection genuinely can't determine a value; a wrong asset silently assumed would be far worse than a trader seeing "chart context unavailable" and knowing to check manually.
- **Rate limiting is deferred, by decision, not by oversight.** See "Security model" for the full reasoning and the recommended deployment-level (Vercel Firewall) mechanism — no application-level limiter was added.
- **Distribution is unpacked/manual only** — no Chrome Web Store or Edge Add-ons submission has happened (`STORE_SUBMISSION.md` documents what's prepared and what's still needed: a privacy policy, store screenshots, and a support URL, at minimum).
- **Recognition depends on provider configuration.** With `ANTHROPIC_API_KEY` unset (the current dev state), "Analyze Chart" always returns an honest "nothing detected / not configured" result — correct, expected behavior, but it means the real vision-recognition code path has never been exercised against a real chart image in this environment (only its error-handling and wiring are unit-tested against a fake client).
- **The TradingView Long/Short Position drawing tool is investigated but intentionally not implemented.** TradingView renders drawn tools on a `<canvas>`, not as DOM elements — there is no "read the text out of a DOM node" tier available for it the way there is for the symbol legend or interval toolbar. The only real options would be TradingView's private/undocumented chart-object APIs (out of scope by this project's own rules) or canvas pixel inference (which screenshot recognition already provides, generically, for anything drawn on the chart). Manual entry and screenshot recognition remain fully available regardless; nothing else in the extension depends on Position-tool detection.
- **`chrome.storage.local` is not OS-keychain-encrypted** — acceptable for this token class today, worth revisiting if Traditorium ever ships a lower-privilege, shorter-lived token type.
- **No broker order execution of any kind, anywhere.** No MT4/MT5 integration, no trade-copier behavior, no automatic Buy/Sell, no realized PnL entry, Trade Review, or Trade Execution feature, no changes to Journal/Analytics/Replay beyond receiving a normally-created Trade. No network interception, no screen recording, no periodic/automatic screenshotting, no telemetry or analytics. "Save Trade Idea" is the only save label used anywhere — never "Execute," "Place Trade," "Buy," or "Sell."
