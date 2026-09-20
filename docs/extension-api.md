# Traditorium Extension API (Step 2 + Step 3)

> Implements the "smallest secure API foundation" from `docs/tradingview-extension-architecture-audit.md` (Step 1), then adds the first write path (Step 3: `POST /api/v1/trades`). This document is the reference for everything under `src/app/api/v1/*`. It does not describe the browser extension itself — that's Step 4+.

## Purpose

Traditorium's web application runs entirely on Next.js Server Actions — same-origin, session-cookie-authenticated, unreachable from an external client like a browser extension (see the Step 1 audit, §8/§9). This API gives an external client (starting with the future TradingView extension) a way to authenticate and read data **without changing how the web app works at all.**

## Architecture

```text
Traditorium Web UI  →  Server Actions  →  Existing Services  →  Database   (UNCHANGED)

External Client  →  /api/v1/*  →  API Authentication  →  SAME Existing Services  →  Database
```

**The rule that governs every route under `/api/v1`:** a route is an *adapter*, never a second implementation. Every route in this step does exactly three things — authenticate the bearer token, call an existing service function (the same one a Server Action already calls), serialize the result. No query, scoring, or validation logic lives in a route file.

| Layer | File | Reused from |
|---|---|---|
| Token auth | `src/server/api-auth.ts` | new (isolated from NextAuth) |
| Token model/verification | `src/server/services/api-tokens.service.ts` | new |
| CORS | `src/server/api-cors.ts` | new |
| `/api/v1/me` | `src/app/api/v1/me/route.ts` | `prisma.user` (read-only) |
| `/api/v1/strategies` | `src/app/api/v1/strategies/route.ts` | `strategies.service.ts::listStrategies` — **unchanged, already used by the web app** |
| `/api/v1/strategies/:id` | `src/app/api/v1/strategies/[id]/route.ts` | `strategies.service.ts::getStrategyReference` — **the exact function `loadStrategyReference` (Server Action) already calls for the Add Trade form** |
| `/api/v1/trades` (POST) | `src/app/api/v1/trades/route.ts` | `trades.service.ts::createTrade`, `trade-plan.service.ts::savePlan`/`attachPlanScreenshot`, `trades.service.ts::updateTradeSections` — **the exact functions `trades.actions.ts`/`trade-plan.actions.ts` already call** |
| `/api/v1/media` (POST) | `src/app/api/v1/media/route.ts` | `lib/media-storage.ts::saveMediaFile` (same R2 bucket, unmodified) + `media.service.ts::createStandaloneMediaAsset` — **new function, see "Screenshot handling" below for why it's not `attachMedia`** |
| `/api/v1/media/:id/recognize-trade-plan` (POST) | `src/app/api/v1/media/[mediaAssetId]/recognize-trade-plan/route.ts` | `trade-plan.service.ts::recognizeStandaloneMediaAsset` — shares `recognizeImage()` with the web app's `runRecognition`, no second recognition system |
| `/api/v1/media/:id` (DELETE) | `src/app/api/v1/media/[mediaAssetId]/route.ts` | `media.service.ts::deleteStandaloneMediaAsset` — refuses to delete anything already attached |

The normal Traditorium website is unaffected: NextAuth config, `requireUser()`, every Server Action, and every existing page continue to work exactly as before. Nothing under `/api/v1` is reachable from, or interferes with, the session-cookie-based web app.

## Token authentication

External clients authenticate with a **bearer token**, entirely separate from the NextAuth session cookie:

```http
GET /api/v1/me HTTP/1.1
Host: traditorium.com
Authorization: Bearer td_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Format: `td_live_` followed by 32 cryptographically random bytes, base64url-encoded (~43 characters) — generated with Node's `crypto.randomBytes(32)`.
- The `td_live_` prefix is **not secret** — it exists only so a token is recognizable at a glance (in a log line, a support ticket, an accidental commit-scan) and so `verifyApiToken` can reject anything that isn't shaped like a Traditorium token before touching the database.
- Tokens never expire by default (`expiresAt` is optional and nullable), but the model supports expiry for any future flow that wants it (e.g. a short-lived token minted during an OAuth-style handoff — see "Future extension authentication flow" below).

**Never send the token as:**
- a query parameter (`?token=...`) — logged in server access logs, browser history, and Referer headers
- a route parameter
- a cookie set by the extension
- anywhere in a URL

Only the `Authorization: Bearer` header, per the constraint in Step 2's instructions.

## Token storage/security

- **The raw token is never stored.** Only `sha256(rawToken)` (hex, 64 chars) is persisted, in `ApiToken.tokenHash` (`@unique` — verification is an indexed equality lookup, not a scan).
- **The raw token is returned to the caller exactly once**, at creation (`createApiToken`'s return value) — never logged, never re-readable afterward. If it's lost, the only recovery is revoking it and creating a new one.
- **Hash algorithm: SHA-256, not bcrypt.** This is a deliberate, documented choice (see the doc comment in `api-tokens.service.ts`): bcrypt exists to slow down brute-forcing a *low-entropy* human password. A generated token already carries 256 bits of randomness — astronomically unguessable regardless of hash speed — so a fast, collision-resistant hash is the correct and standard choice for this class of credential (the same approach GitHub/Stripe/AWS-style API tokens use). `bcryptjs` remains exactly where it already was, hashing login passwords only (`server/auth.ts`) — this doesn't touch that code path.
- **`tokenPrefix`** (e.g. `td_live_a1b2c3d4`) is stored purely for display (a future "Connected Apps" UI showing "...c3d4" instead of nothing) — it is never sufficient on its own to authenticate.
- **Every failure mode returns the same generic `401 {"error": "Unauthorized"}`** — missing header, malformed scheme, unknown token, revoked token, expired token are indistinguishable to the caller. This is deliberate: a more specific error (e.g. "token revoked") would let an attacker confirm a *specific* token string used to exist.
- **Ownership is enforced by construction, not by an extra check.** `getStrategyReference(userId, id)` (unchanged, existing code) already scopes its Prisma query to `{ id, userId }` — a strategy belonging to a different user resolves to `null` exactly like a non-existent one, which the route maps to `404`. See `src/app/api/v1/strategies/[id]/route.ts`'s comment for the exact reasoning.

## `GET /api/v1/me`

Connection-check endpoint — lets a client confirm its token is valid and see who it's connected as, nothing more.

**Request**
```http
GET /api/v1/me HTTP/1.1
Authorization: Bearer td_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Response — 200**
```json
{
  "user": {
    "id": "cku3x9f8a0000abcd1234efgh",
    "name": "Jane Trader"
  }
}
```

No email, no account/profile fields — deliberately the minimum needed to render "Connected as Jane Trader" in a future extension UI.

**Response — 401** (any auth failure)
```json
{ "error": "Unauthorized" }
```

## Strategy endpoint(s)

### `GET /api/v1/strategies`

Lists the authenticated user's non-archived strategies (id/name/version/status only — enough to build a picker).

**Response — 200**
```json
{
  "strategies": [
    { "id": "cku4...", "name": "London Liquidity Sweep", "version": 3, "status": "ACTIVE" },
    { "id": "cku5...", "name": "NY Open Continuation", "version": 1, "status": "DRAFT" }
  ]
}
```

### `GET /api/v1/strategies/:id`

Full configuration for one strategy — the same shape `getStrategyReference()` has always returned to the web app's Add Trade form (entry models, framework steps, sessions, confluences with weight/mandatory/bullish-bearish polarity, execution confirmations, trade-management rules, setup types).

**Response — 200**
```json
{
  "strategy": {
    "id": "cku4...",
    "name": "London Liquidity Sweep",
    "version": 3,
    "applicableAssets": ["XAUUSD", "EURUSD"],
    "entryModels": ["Breaker", "FVG Retest"],
    "frameworkSteps": ["HTF bias", "Liquidity sweep", "MSS confirmation", "Entry"],
    "sessions": [{ "name": "London", "color": "BLUE" }],
    "confluences": [
      {
        "id": "chk_1",
        "name": "Liquidity sweep",
        "color": "GRAY",
        "category": "Structure",
        "weight": 40,
        "mandatory": true,
        "directionApplicability": "BULLISH",
        "pairId": null
      }
    ],
    "execution": [
      { "id": "chk_2", "name": "Confirmed entry trigger", "color": "GRAY", "category": null, "weight": 20, "mandatory": false, "directionApplicability": "BOTH", "pairId": null }
    ],
    "tradeManagement": {
      "maxRiskPercent": 1,
      "maxHoldingTime": "2 hours",
      "customRules": ["Move to break-even after TP1"],
      "partialTakeProfits": [{ "trigger": "TP1", "percentToClose": 50 }]
    },
    "setupTypes": [{ "id": "st_1", "name": "Type A" }]
  }
}
```

**Response — 404** — strategy doesn't exist, is soft-deleted, **or belongs to a different user.** These three cases are intentionally indistinguishable (see "User isolation" below).

## `POST /api/v1/trades`

Creates a Trade Idea — the first write path for an external client. **This route is an adapter, not a second implementation.** It composes up to four calls, every one of them the exact, unmodified function the web app's own Server Actions already use:

```text
createTrade()            — trades.service.ts (same as trades.actions.ts)
  → savePlan()?           — trade-plan.service.ts (same as trade-plan.actions.ts::confirmPlanAction)
  → updateTradeSections()? — trades.service.ts (same as trades.actions.ts::updateTradeSection)
  → attachPlanScreenshot()? — trade-plan.service.ts
```

`createTrade` is the only step that's atomic/all-or-nothing (it already runs inside its own Prisma transaction). The three `?` steps are optional, independent follow-ups — exactly the same multi-step shape the web app itself uses (a trader creates a trade idea, then separately confirms its plan, then separately adds notes). If one of those optional steps fails, the trade itself is **not** rolled back; the failure is reported as a `warnings` entry in the response, and the caller can retry that one step against the now-known trade id.

### Canonical trade-creation contract

No new trade model was introduced. The request body reuses two existing Zod schemas verbatim:

- `trade` — `lib/validation/trades.ts::tradeSchema`, the exact input `trades.service.ts::createTrade` has always accepted (the same schema `trades.actions.ts::createTrade` parses before calling the service).
- `plan` (optional) — `lib/validation/trade-plan.ts::confirmPlanSchema`, minus its `direction` field (derived from `trade.direction` instead, so the two can never disagree).

The composed schema lives in `lib/validation/api-trades.ts`. One small, deliberate extraction was needed to keep this honest: `marketContext`/`areasOfInterest`/`reasonForTrade` reuse the exact same `workspaceNote` field validator `lib/validation/trades.ts`'s own `tradeWorkspaceSectionSchema` uses internally — it's now exported from that file instead of being redefined.

**Important, traced from the actual schema, not assumed:** `tradeSchema` does **not** include `plannedEntry`/`plannedStopLoss`/`plannedTarget`/`timeframe` — those have always belonged exclusively to `TradePlanVersion` (via `savePlan`), for both the web app and this API. A request with only `trade` (no `plan`) creates a valid, unplanned Trade Idea — exactly like clicking "Add trade" on the web without yet confirming a plan.

### Headers

```http
POST /api/v1/trades HTTP/1.1
Authorization: Bearer td_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
Idempotency-Key: 3fa2b1c4-9e21-4b7a-8c3d-1a2b3c4d5e6f   (optional, recommended)
```

### Example request

```json
{
  "dateKey": "2026-09-19",
  "trade": {
    "assetSymbol": "XAUUSD",
    "executionMinutes": 570,
    "direction": "LONG",
    "higherTimeframeBias": "BULLISH",
    "biasConfidencePercent": 80,
    "strategyId": "cku4...",
    "selectedSession": "London",
    "selectedEntryModel": "Breaker",
    "selectedConfluences": ["Liquidity sweep", "MSS confirmation"],
    "selectedExecution": ["Confirmed entry trigger"]
  },
  "plan": {
    "timeframe": "15m",
    "entry": 1900.5,
    "stopLoss": 1890,
    "targets": [
      { "targetOrder": 1, "label": "TP1", "targetPrice": 1910, "plannedClosePercent": 50 },
      { "targetOrder": 2, "label": "TP2", "targetPrice": 1930 }
    ]
  },
  "notes": {
    "marketContext": "London sweep of Asia low, reclaiming the range.",
    "reasonForTrade": "Liquidity sweep + MSS on the 15m, aligned with daily bias."
  }
}
```

`dateKey` defaults to the server's current date when omitted. `plan`, `notes`, and `mediaAssetId` (an already-uploaded `MediaAsset` id this user owns — see "Screenshot handling" below) are all optional.

### Example response — `201 Created`

```json
{
  "trade": {
    "id": "cku9...",
    "tradeNumber": 142,
    "dateKey": "2026-09-19",
    "assetSymbol": "XAUUSD",
    "direction": "LONG",
    "timeframe": "15m",
    "selectedSession": "London",
    "strategyId": "cku4...",
    "strategyName": "London Liquidity Sweep",
    "selectedEntryModel": "Breaker",
    "selectedConfluences": ["Liquidity sweep", "MSS confirmation"],
    "selectedExecution": ["Confirmed entry trigger"],
    "plannedEntry": 1900.5,
    "plannedStopLoss": 1890,
    "plannedTargets": [
      { "targetOrder": 1, "label": "TP1", "targetPrice": 1910, "rMultiple": 0.9, "plannedClosePercent": 50 },
      { "targetOrder": 2, "label": "TP2", "targetPrice": 1930, "rMultiple": 2.81, "plannedClosePercent": null }
    ],
    "expectedRR": 1.86,
    "setupScore": 100,
    "setupRating": "A",
    "setupValid": true,
    "confluencePercent": 100,
    "executionPercent": 100,
    "hasPlanScreenshot": false,
    "createdAt": "2026-09-19T14:32:10.000Z"
  }
}
```

`expectedRR` and every `rMultiple` are computed **entirely server-side** by `domain/trade-plan/planned-rr.ts` (`computeTargetRMultiples`/`computeWeightedPlannedR`, which wrap `domain/prop-firms/risk.ts::computePlannedR` — the same formula/function the web app's Trade Plan confirmation has always used). The request body has no field for a client-submitted RR at all — there is nothing to "trust" or distrust, by construction.

If an optional step failed, the response also includes a `warnings` array, e.g. `{ "trade": {...}, "warnings": ["plan: Stop-loss cannot be the same price as entry — stop distance must be greater than zero."] }` — the trade (id `cku9...` in that example) still exists and can be fetched/retried against.

An idempotent replay (see below) returns `200` instead of `201`, with `"replayed": true` alongside the same `trade` object.

### Validation errors

| Status | Meaning | Example body |
|---|---|---|
| `400` | Malformed JSON body | `{ "error": "Malformed JSON body." }` |
| `401` | Missing/invalid/revoked/expired token | `{ "error": "Unauthorized" }` |
| `422` | Schema validation failed | `{ "error": "Validation failed.", "issues": [{ "path": "trade.assetSymbol", "message": "Enter the asset / symbol you traded." }] }` |
| `422` | `strategyId` not found or not owned by this user | `{ "error": "strategyId not found." }` |
| `422` | Trading day is archived/closed | `{ "error": "<the exact message trades.actions.ts already surfaces to the web app>" }` |
| `409` | `Idempotency-Key` reused with a different request body | `{ "error": "This Idempotency-Key was already used with a different request body." }` |
| `500` | Unexpected server error | `{ "error": "Internal server error." }` — never a stack trace, Prisma error, or other internal detail |

`issues[].path` is dot-joined (e.g. `trade.selectedConfluences.0`) so the future extension can map an error directly back to the form field that produced it.

### Strategy/user ownership protection

`trades.service.ts::buildTradeSnapshots` already re-verifies `strategyId` ownership itself (`where: { id, userId }`) and silently drops an unowned id to `null` rather than erroring — this existing behavior is **unchanged**, and protects both the web app and this API identically, because both call the same function. This route additionally performs the same ownership check *up front* and fails the whole request with `422` for a foreign `strategyId`, rather than silently proceeding — a stricter, API-layer-only ergonomics decision (a programmatic client benefits far more from an explicit error than from silently getting back a trade that quietly dropped its strategy link), built on the exact same `getStrategyReference` primitive, not a new authorization rule.

The authenticated token's user is **always** the trade's owner — there is no `userId` field anywhere in the request schema, and the route never reads one from the body.

### Strategy-scoped configuration validation (confluences, entry model, direction)

All reused, none reimplemented:

- **Entry model** — `buildTradeSnapshots` looks up `selectedEntryModel` scoped to `{ strategy: { id: strategyId, userId } }`; a name that doesn't belong to the selected strategy (or belongs to someone else's) resolves to `null` on the stored trade, silently, for both this API and the web app.
- **Confluences/execution confirmations** — `domain/trades/strategy-adherence.ts::scoreStrategyAdherence` only credits a submitted name if it's in the strategy's own expected set; an unrecognized name simply scores 0, it does not error the request (matches existing web-app behavior — nothing has ever validated the raw array server-side, for either path).
- **Direction-aware eligibility** — `domain/trades/setup-score.ts::scoreSetup` (via `confluence-score.ts::isConfluenceEligible`) filters confluences to `<direction> + BOTH` **before** scoring. A LONG trade gets zero credit for a BEARISH-only confluence, and — this is the subtle, tested case — the mandatory-confluence gate (`setupValid`) is **not** failed by an ineligible mandatory confluence going unmet, since there's nothing eligible to be "missing" for that direction. Tested explicitly in `src/app/api/v1/trades/route.test.ts`.
- **Session** — traced and confirmed: `selectedSession` has never been validated against the strategy's own `StrategySession` list, for either the web app or this API. It's stored as submitted. This is existing, unchanged behavior, not a gap introduced here.

### Multi-target planned targets

`plan.targets` maps directly onto the canonical `PlannedTarget[]`/`TradePlanVersion` architecture via `trade-plan.service.ts::savePlan` — the exact function the web app's screenshot-plan confirmation flow already calls. Multiple targets, explicit `targetOrder`, persisted and returned in order; `Trade.plannedTarget` (the legacy single-price column) is kept in sync with target #1 automatically by that same existing function, purely for old readers of that field — it is never this API's primary representation.

### Idempotency

Opt-in via the `Idempotency-Key` header (any client-generated string, a UUID is recommended). Scoped per user (`ApiIdempotencyKey`, `@@unique([userId, key])` — two different traders may reuse the exact same key value independently).

| Situation | Behavior |
|---|---|
| No `Idempotency-Key` header | No protection — each request creates its own trade. Simple default for a caller that doesn't need it. |
| New key | Trade is created normally; the key is recorded against the resulting trade id. |
| Same user + same key + **identical** request body | `200`, returns the **original** trade, `"replayed": true` — no second trade is created. |
| Same user + same key + **different** request body | `409` — a deterministic conflict, never a second trade and never a silent overwrite. |
| Same key concurrently in flight (race) | The second request observes the reserved-but-not-yet-resolved key and returns `409` rather than racing its own trade creation. |
| Different users, same key value | Fully independent — no interaction at all. |

The request body's hash (not the body itself) is what's stored, via a stable (key-sorted) JSON stringification — see `src/server/api-idempotency.ts`.

### Screenshot handling

**Implemented in Step 8** (`POST /api/v1/media`, `src/app/api/v1/media/route.ts`): bearer-authenticated chart-capture upload, purpose-built for the exact constraint this section used to flag as unsolved.

**The constraint, as traced from `/api/media/upload`'s actual code (still true, still unchanged there):** that route requires an `ownerId` at upload time, and `ownerType: "TRADE"` requires a **real, already-existing** Trade row to attach to — there is no "unattached/staging" owner type in that route's model. Rather than forcing the extension to create the Trade first (which Step 8's own design explicitly avoids — capture must work independently of trade creation), `POST /api/v1/media` sidesteps the constraint at its root: it calls a new `createStandaloneMediaAsset()` (`media.service.ts`) that creates a bare `MediaAsset` row with **no** `MediaAttachment` at all. This works because `attachPlanScreenshot` (`trade-plan.service.ts`, unmodified) only ever checks `MediaAsset.userId` — never a `MediaAttachment` — so a standalone asset is immediately usable as a `mediaAssetId` with zero owner record required yet.

The actual, implemented flow:

```text
TradingView Extension
      ↓ capture chart (chrome.tabs.captureVisibleTab, background only)
POST /api/v1/media                     (multipart, field "file") — Step 8
      ↓
MediaAsset created (standalone, no MediaAttachment yet)
      ↓ { id, url, mimeType, fileSize }
      ↓
POST /api/v1/trades                    (this field already existed — Step 3)
{ ..., mediaAssetId: "<the id above>" }
      ↓
existing createTrade() → attachPlanScreenshot() — UNCHANGED
```

No follow-up "attach" endpoint was needed — Step 3's existing `mediaAssetId` field on `POST /api/v1/trades` already does exactly this, unmodified.

**Response — 201**
```json
{ "id": "media_abc123", "url": "/api/media/media_abc123", "mimeType": "image/png", "fileSize": 482913 }
```

**Validation**: image MIME only (`ACCEPTED_IMAGE_MIME` — png/jpeg/webp/gif/svg+xml/avif/bmp; never the PDF-accepting set `/api/media/upload` allows for Prop Firm evidence), 8MB cap (`MAX_FILE_SIZE`, the same constant), MIME judged by the browser-reported `File.type`, never a filename extension. `400` (missing/empty file, malformed multipart), `415` (unsupported MIME), `413` (oversized), `401` (missing/invalid token) — same generic-401 rule as every other `/api/v1` route.

**Known, documented limitation**: because no `MediaAttachment` is created, a screenshot uploaded this way does not appear in a `MediaAttachment`-scoped gallery (e.g. the Trades Album's before-trade photo list) unless something later attaches it that way. It renders correctly everywhere the canonical `TradePlanScreenshot` relation is used directly (the Trade Workspace's own plan view) and is served correctly by the existing auth-scoped `GET /api/media/[id]` route (which looks up by `MediaAsset.id` + `userId` only).

`/api/media/upload` itself was **not modified** — it still authenticates only via the NextAuth session cookie, still requires `ownerType`/`ownerId`, and still serves the web app's own upload flows exactly as before. `POST /api/v1/media` is an additive, parallel adapter, not a replacement.

### Screenshot recognition (Step 9, Part 1)

`POST /api/v1/media/:mediaAssetId/recognize-trade-plan` (`src/app/api/v1/media/[mediaAssetId]/recognize-trade-plan/route.ts`) — runs the SAME recognition provider the web app's trade-scoped `runRecognition` (`trade-plan.service.ts`) already uses, against a standalone (not-yet-attached-to-a-trade) `MediaAsset`. The provider resolution/invocation itself was extracted into a shared `recognizeImage()` helper both functions call — no second recognition system.

Why a new function was needed at all: `runRecognition` is keyed by `tradeId` and persists its result onto an existing `TradePlanScreenshot` row — neither exists for a screenshot captured before a Trade exists. The new `recognizeStandaloneMediaAsset(userId, mediaAssetId)` therefore returns the raw `ScreenshotRecognitionOutcome` directly to the caller rather than persisting `ScreenshotRecognitionField` rows. **This is a deliberate, documented scope boundary**: recognition history for extension-created trades is not retroactively persisted the way the web app's trade-scoped flow persists it — the extension uses the result purely as a client-side suggestion the trader reviews before Save.

**Response — 200** (recognition failure is a normal response body, never an HTTP error — matches `runRecognition`'s own "recognition failure must not block the trader" philosophy):
```json
{ "status": "RECOGNITION_COMPLETE", "fields": [ { "fieldType": "ENTRY", "detectedValue": "3640", "confidence": 0.92, "rawExtractedText": "3640.00" } ] }
```
or
```json
{ "status": "RECOGNITION_FAILED", "error": "Automatic recognition isn't configured for this workspace yet. Enter the plan manually below." }
```

**Provider configuration**: `resolveRecognitionProvider()` prefers `ClaudeVisionRecognitionProvider` (gated on `ANTHROPIC_API_KEY`) and falls back to `NullRecognitionProvider` otherwise — unchanged from the existing web-app architecture, and **not modified by this step**. In this development environment, `ANTHROPIC_API_KEY` is unset, so recognition always resolves through the Null provider (a real, exercised path, not a stub). Setting that one environment variable activates real Claude Vision recognition for the web app AND the extension simultaneously, with zero additional code — no vendor is hardcoded into the extension.

**Ownership/errors**: `404` for an unknown or cross-user `mediaAssetId` (no oracle distinguishing the two). Provider errors are already sanitized at the source (`claude-vision-provider.ts` never returns a raw API error, credential, or stack trace) — this route adds no further detail and forwards nothing else.

### Media deletion (Step 9, Part 9)

`DELETE /api/v1/media/:mediaAssetId` (`src/app/api/v1/media/[mediaAssetId]/route.ts`) — deletes a standalone `MediaAsset` the caller uploaded but never used (Retake/Remove after upload, or an abandoned Trade Idea — both identified as orphan sources in Step 8). Backed by a new `media.service.ts::deleteStandaloneMediaAsset`, which refuses to delete anything already referenced by a `MediaAttachment` OR a `TradePlanScreenshot` (as either `mediaAssetId` or `previewMediaAssetId`) — a screenshot already wrapped into a canonical Trade Plan can never be deleted through this route, regardless of what the caller asks for.

**Responses**: `204` (deleted), `404` (unknown/cross-user id — no oracle), `409` (`{"error": "This image is already attached to a trade and can't be deleted here."}` — exists but is protected), `401` (missing/invalid token).

## Error format

Every error response from `/api/v1/*` is `{ "error": "<message>" }` (Step 3's `POST /api/v1/trades` additionally includes `issues` for `422` schema-validation failures — see that section). Step 2's read-only endpoints only ever produce `401`/`404`; Step 3 adds `400`, `409`, and `422`.

## User isolation

Proven by three layers, each independently tested (`src/app/api/v1/strategies/route.test.ts`):

1. `requireApiUser` resolves a token to exactly one `userId` — there is no code path where a token authenticates as more than one user or as no user with a 200 response.
2. Every service call is scoped with that `userId` — `listStrategies(userId)` and `getStrategyReference(userId, id)` are the *same, unchanged* functions the web app uses, which already filter by `userId` in their Prisma `where` clause.
3. A cross-user fetch (User A's token, User B's strategy id) resolves to `404`, not `403` — the API never confirms that the requested resource exists at all under another identity.

## CORS considerations

`/api/v1/*` is **not** `Access-Control-Allow-Origin: *`. These are authenticated, per-user endpoints; a wildcard would let any website's JavaScript read a response from any browser tab that happened to have a valid token available to it. Instead (`src/server/api-cors.ts`):

- `Access-Control-Allow-Origin` is only ever set to the exact request `Origin`, and only when that origin appears in the `EXTENSION_ALLOWED_ORIGINS` environment variable (comma-separated).
- That variable is **unset today** — meaning no cross-origin browser-JS read access is permitted yet, which is the correct default: no extension exists to allow.
- `Access-Control-Allow-Credentials` is deliberately never set — auth here is an explicit `Authorization` header the caller attaches, never an ambient cookie, so credentialed CORS mode is neither needed nor enabled.
- **Step 3 update**: `Access-Control-Allow-Methods` now includes `POST` (previously `GET, OPTIONS` only) and `Access-Control-Allow-Headers` now includes `Idempotency-Key`, so a preflight for `POST /api/v1/trades` resolves correctly once an origin is actually allowlisted. `EXTENSION_ALLOWED_ORIGINS` itself was **not** broadened — it's still unset by default, exactly as Step 2 left it.

**Important nuance for Step 4:** this allowlist only matters if the extension's *page-context* code (a side panel or content script, running at origin `chrome-extension://<extension-id>`) calls `fetch()` directly. A Manifest V3 **background/service-worker** fetch with the right `host_permissions` in the extension's manifest is not subject to CORS at all. Which pattern the extension ends up using determines whether `EXTENSION_ALLOWED_ORIGINS` needs a real value — decide this in Step 4 once the extension's actual manifest exists, then add `chrome-extension://<the-real-id>` to that variable. Nothing else in `api-cors.ts` needs to change.

## Future extension authentication flow

Not built in this step — options to evaluate before Step 3/4, per the Step 1 audit:

1. **Manual token copy** (what Step 2 enables today): the trader creates a token via `createApiTokenAction` (currently only callable from an authenticated web session, no dedicated UI yet) and pastes it into the extension once.
2. **Guided handoff**: the extension opens a Traditorium tab where the trader is already logged in via their normal session; that page calls the same action and hands the token back to the extension programmatically (`chrome.identity`-style or a simple "Connect" page) — better UX, same underlying token code.

Either way, this reuses `createApiToken`/`api-tokens.actions.ts` as-is — no new auth code is anticipated for either flow, only UI.

## Token revocation

`revokeApiToken(userId, tokenId)` (`api-tokens.service.ts`) — sets `revokedAt`, never deletes the row (an intentional audit trail: "what could this token access, and when did it stop being able to"). Revocation is idempotent (revoking an already-revoked token is a no-op) and ownership-scoped (`revokeApiTokenAction`, called by another user, silently affects nothing — proven in `api-tokens.service.test.ts`). `verifyApiToken` treats a revoked token exactly like one that never existed.

There is no UI for this yet (Step 3). Until then, revoke a token directly:

```ts
import { revokeApiToken } from "@/server/services/api-tokens.service";
await revokeApiToken(userId, tokenId);
```

## Rate-limit follow-up (not implemented in Step 2)

No rate-limiting infrastructure exists anywhere in this repository today (confirmed by search — no Redis/Upstash dependency, no existing middleware). Documented here as a deliberate deferral, not an oversight:

| Surface | Where it should eventually sit | Why |
|---|---|---|
| Token verification (`requireApiUser`, every route) | Per-token and per-IP, at the `requireApiUser` call site or in front of it (edge middleware) | Prevents brute-forcing token guesses; every route already funnels through this one function, so it's a single choke point |
| `/api/v1/strategies*` reads | Per-token, generous (these are cheap reads) | Abuse/cost control, not a security boundary |
| `POST /api/v1/trades` (built in Step 3, **not yet rate-limited**) | Per-token, stricter than reads | Writes are more expensive and higher-stakes than reads |
| Future screenshot upload (Step 4+) | Per-token, request-size- and frequency-aware | File uploads are the most expensive request shape in this app |

Recommended mechanism when this is built: a small Upstash Redis (or equivalent) token-bucket check inside `requireApiUser` itself, so every route gets it for free — do not duplicate a rate-limit check into each route file.

## Local development/testing procedure

1. Ensure your dev database has the new migration: `npm run test:db:setup` applies it to the dedicated test DB automatically for `npm test`; for your own dev DB, `prisma migrate dev` (already applied if you're reading this after Step 2 landed).
2. Mint a token for an existing dev user:
   ```bash
   npm run create:dev-api-token -- --email=you@example.com --name="Local testing" --confirm=CREATE-DEV-TOKEN
   ```
   This prints the raw token to your terminal **once** — copy it immediately, it is not recoverable afterward (only its hash is stored). Never paste it into a commit, a log aggregator, or this file.
3. Exercise the endpoints:
   ```bash
   curl -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/me
   curl -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/strategies
   curl -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/strategies/<strategy-id>

   curl -X POST http://localhost:3000/api/v1/trades \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d '{"trade":{"assetSymbol":"XAUUSD","executionMinutes":570,"direction":"LONG","higherTimeframeBias":"BULLISH","biasConfidencePercent":80}}'
   ```
4. The automated test suite (`npx vitest run src/server/services/api-tokens.service.test.ts src/server/api-idempotency.test.ts src/app/api/v1`) covers authentication (missing/malformed/unknown/revoked/expired/valid), user isolation (including cross-user strategy/media references), that the strategy endpoint's output is byte-for-byte what `getStrategyReference()` already returns, that trade creation via the API produces identical scoring to a direct `createTrade()` call, multi-target persistence/ordering, automatic Performance Account allocation, and every idempotency scenario (replay, conflict, cross-user, no-header) — run this instead of manual `curl` checks for anything beyond a one-off sanity check.

**Never**: commit a real token anywhere in this repo, seed a fixed token for any environment, or add an unauthenticated token-creation path. Every example token in this document is a placeholder (`td_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`), never a real one.
