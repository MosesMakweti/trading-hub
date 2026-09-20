# TradingView Extension — Architecture Audit (Step 1)

> **Status: read-only investigation.** No production code, schema, migrations, or UI were changed to produce this document. Every claim below was verified by reading the actual source (imports, service calls, Prisma models) — not inferred from file names.

## Table of contents

1. [Current Add Trade architecture](#1-current-add-trade-architecture)
2. [Exact file map](#2-exact-file-map)
3. [Trade creation data flow](#3-trade-creation-data-flow)
4. [Prisma/domain model relationships](#4-prismadomain-model-relationships)
5. [Strategy configuration dependencies](#5-strategy-configuration-dependencies)
6. [Account allocation architecture](#6-account-allocation-architecture)
7. [Media/screenshot architecture](#7-mediascreenshot-architecture)
8. [Authentication architecture](#8-authentication-architecture)
9. [Existing API inventory](#9-existing-api-inventory)
10. [Business logic currently trapped in UI](#10-business-logic-currently-trapped-in-ui)
11. [Recommended shared-domain architecture](#11-recommended-shared-domain-architecture)
12. [Extension authentication considerations](#12-extension-authentication-considerations)
13. [Trade identity recommendation](#13-trade-identity-recommendation)
14. [TradingView integration considerations](#14-tradingview-integration-considerations)
15. [Risks / technical debt](#15-risks--technical-debt)
16. [Recommended implementation sequence](#16-recommended-implementation-sequence)
- [Step 2 Recommendation](#step-2-recommendation)

---

## 1. Current Add Trade architecture

Traditorium's entire application — including Add Trade — is built on **Next.js Server Actions**, not a REST/JSON API. There are exactly **4 real HTTP API routes** in the whole app (`src/app/api/**/route.ts`): NextAuth's handler, CSV trade export, and the two media routes (`upload`, `[id]`). Everything else — creating a trade, updating a trade, loading a strategy's reference data, confirming a TradingView-screenshot plan, allocating accounts — is a `"use server"` function under `src/actions/*.actions.ts`, called directly from React components via Next's RSC action protocol.

This single fact is the most important finding in this audit: **there is currently no external-client-callable surface for trade creation at all.** A browser extension cannot call a Server Action the way the web app does (see [§8](#8-authentication-architecture) and [§9](#9-existing-api-inventory)).

The good news: the business logic *behind* those Server Actions is already properly layered. `trades.actions.ts` is a thin wrapper — auth, validation, guard checks, then a single call into `trades.service.ts::createTrade`, which does all the real work (scoring, snapshotting, account allocation) inside one Prisma transaction. An extension-facing API can be a second, thin entry point into the exact same service functions, with no logic duplicated.

## 2. Exact file map

Traced by following actual imports, not guessing from names.

**UI (entry points):**
- `src/components/today/add-trade-dialog.tsx` — the "Add trade" dialog launched from Today; thin wrapper that mounts `TradeForm` in `mode="create"`.
- `src/components/journal/trade-form.tsx` (1,213 lines) — the actual form. Used for both create and edit (`mode` prop). This is the one real "Add Trade" UI; everything else opens it.
- `src/app/(app)/journal/[date]/trades/new/page.tsx` and `.../trades/[tradeId]/edit/page.tsx` — standalone full-page versions of the same form, for direct links.
- `src/components/journal/workspace/trade-idea-section.tsx` — Trade Workspace's read/edit view of an already-created trade's "idea" section.

**Validation:**
- `src/lib/validation/trades.ts` — `tradeSchema` (Zod), the single input contract `trade-form.tsx` builds against and both `createTrade`/`updateTrade` Server Actions parse with `tradeSchema.safeParse`.

**Server Actions:**
- `src/actions/trades.actions.ts` — `createTrade`, `updateTrade`, `updateTradeSection`, `loadStrategyReference`, `archiveTrade`.
- `src/actions/trade-plan.actions.ts` — the TradingView-screenshot plan flow (upload, run recognition, confirm/lock plan).
- `src/actions/opportunity.actions.ts` — Trade Opportunity (spot/miss/invalidate/link-to-executed-trade) lifecycle.
- `src/actions/trade-executions.actions.ts` — Prop Firm account execution linking ("System B").

**Services (domain + I/O, the reusable layer):**
- `src/server/services/trades.service.ts` (819 lines) — `createTrade`, `updateTrade`, `updateTradeSections`, `getTradeFormOptions`, `getTrade`, `listTradesForDay`, `archiveTrade`.
- `src/server/services/strategies.service.ts` — `getStrategyReference` (the strategy-configuration payload the form needs), `listStrategies`.
- `src/server/services/trade-plan.service.ts` — `attachPlanScreenshot`, `runRecognition`, `savePlan`, `lockPlanIfConfirmedAndUnlocked`, `resolveInstrumentSpecForSymbol`.
- `src/server/services/opportunity.service.ts` — `createOpportunity`, `linkExecutedTrade`, `logMissedOutcome`.
- `src/server/services/performance-account.service.ts` — `lockPerformanceRiskSnapshot`, `settlePerformanceTrade`, `getPerformanceConfig` (see [§6](#6-account-allocation-architecture)).
- `src/server/services/media.service.ts` — `attachMedia`, `assertOwnsMediaTarget`, `countMediaForOwner`.
- `src/lib/media-storage.ts` — Cloudflare R2 read/write/delete.
- `src/server/services/daily-asset-analysis.service.ts` — `getFinalBiasForAsset` (Today's day-bias context, frozen onto the trade at creation).

**Pure domain (framework-free, no Prisma types — reusable by design):**
- `src/domain/trades/strategy-adherence.ts::scoreStrategyAdherence`
- `src/domain/trades/setup-score.ts::scoreSetup`
- `src/domain/trades/setup-validation.ts::buildSetupValidationSnapshot`
- `src/domain/trades/lifecycle.ts::deriveStatus`, `nextClosedAt`, `nextReviewedAt`
- `src/domain/trade-plan/distance.ts`, `planned-rr.ts`, `plan-validation.ts`, `instrument-catalog.ts`
- `src/domain/prop-firms/risk.ts::computePlannedR`
- `src/domain/performance/realized-r.ts` (Performance Account R/PnL math, see [§6](#6-account-allocation-architecture))

**Auth:**
- `src/server/auth.ts` — NextAuth v5 config.
- `src/server/guards.ts::requireUser()` — page/action-oriented auth check (redirects to `/login`).

## 3. Trade creation data flow

```
User fills TradeForm (client component)
  │  live preview only — calls the SAME pure functions the server will call:
  │  scoreStrategyAdherence(), scoreSetup()  [domain/trades/*]
  ▼
react-hook-form + zodResolver(tradeSchema)   [lib/validation/trades.ts]
  ▼
createTrade(dateKey, formValues, opportunityId?)   [actions/trades.actions.ts — "use server"]
  │  1. requireUser()                     — session check, redirect if absent
  │  2. dayEditableGuard(userId, dateKey)  — is this trading day still editable?
  │  3. tradeSchema.safeParse(input)       — SERVER-SIDE re-validation, never trusts the client
  ▼
tradesService.createTrade(userId, dateKey, data)   [server/services/trades.service.ts:521]
  │  runs inside ONE prisma.$transaction:
  │  - buildAllocations()        → Performance Account (always) + any selected TradingAccounts
  │  - buildTradeSnapshots()     → freezes strategy id/name/version at save time
  │  - buildStrategyExecution()  → getStrategyReference() + scoreStrategyAdherence() + scoreSetup()
  │  - buildSetupValidation()    → Setup Type validation shield (Stage 4), if a Setup Type was chosen
  │  - getFinalBiasForAsset()    → reads today's DailyAssetAnalysis.finalBias for this asset
  │  - nextTradeNumber()         → per-user monotonic counter
  │  - tx.trade.create({ ..., allocations: { create }, psychology: { create }? })
  │  - syncExecutionsWithinTx()  → Prop Firm account links, if any ("System B")
  ▼
Prisma → Postgres: Trade row + TradeAccountAllocation row(s) + optional PsychologyQuestionnaireResponse
  ▼
if opportunityId: linkExecutedTrade(userId, opportunityId, trade.id)   [opportunity.service.ts]
  ▼
revalidatePath(/journal/[date], /journal, /dashboard, /accounts)
```

A separate, later flow settles the trade once actuals are entered (`updateTradeSections` → `lockPerformanceRiskSnapshot`/`settlePerformanceTrade` in `performance-account.service.ts`) — this is unchanged by anything an extension would do at Trade-Idea-creation time, and is already fully covered by the previous Analytics audit in this repo's history.

## 4. Prisma/domain model relationships

```
User
 ├─ TradingDay (1 per user per date, @@unique([userId, date]))
 │   └─ DailyAssetAnalysis (1 per asset per day) ── finalBias, htfBias, keyLevels, notes
 │        └─ DirectionalEvidenceItem[]
 ├─ Strategy ── entryModels[], frameworkSteps[], sessions[], checklistItems[] (CONFLUENCE | EXECUTION),
 │              tradeManagement (maxRiskPercent, customRules[], partialTakeProfits[]), setupTypes[]
 │              └─ StrategySetupType → StrategySetupScenario → StrategySetupScenarioCondition
 ├─ TradeOpportunity (the "spotted idea", optional precursor to a Trade)
 │   └─ executedTrade: Trade?  (1:1, Trade.opportunityId @unique — "one opportunity → one outcome")
 └─ Trade  ── the canonical row created by createTrade()
      ├─ direction, assetSymbol, tradeDate, executionMinutes
      ├─ plannedEntry / plannedStopLoss / plannedTarget   (simple case-file fields)
      ├─ actualEntry / actualStopLoss / actualExit         (execution fields, filled later)
      ├─ expectedRR / actualRR                             (R fields — actualRR auto-synced from settlement)
      ├─ strategyId (+ strategyNameSnapshot/strategyVersionSnapshot — frozen)
      ├─ selectedConfluences / selectedExecution (Json)    ── what the trader checked
      ├─ strategyExecutionSnapshot (Json)                  ── what was EXPECTED, frozen at save time
      ├─ confluencePercent / executionPercent / tradeQualityPercent / setupScore / setupRating / setupValid
      ├─ setupTypeId → setupScenarioId, selectedSetupConditions, setupValidationSnapshot, validationState
      ├─ dailyBiasSnapshot                                 ── frozen finalBias for this asset/day
      ├─ allocations: TradeAccountAllocation[]              ── System A (Performance Account + personal brokerages)
      ├─ propFirmExecutions: TradeAccountExecution[]         ── System B (prop firm accounts, independent PnL basis)
      ├─ performanceRiskSnapshot: PerformanceRiskSnapshot?   ── locked risk/R/PnL, see §6
      ├─ planScreenshot: TradePlanScreenshot?                ── the TradingView-screenshot plan feature, see §7
      ├─ plannedTargets: PlannedTarget[]                     ── live, editable target set
      ├─ planVersions: TradePlanVersion[]                    ── append-only confirmed-plan history
      ├─ actualPartialExits: TradeActualPartialExit[]
      └─ psychology: PsychologyQuestionnaireResponse?
```

All of the above is user-scoped by an explicit `userId` column (no reliance on implicit tenancy) and every query in the services above filters on it directly.

## 5. Strategy configuration dependencies

Already fully solved by `strategies.service.ts::getStrategyReference(userId, strategyId)` (`server/services/strategies.service.ts:510`) — one function returns everything a Trade Idea form needs about a strategy:

- `entryModels: string[]`, `frameworkSteps: string[]`
- `sessions: { name, color }[]`
- `confluences: { id, name, color, category, weight, mandatory, directionApplicability, pairId }[]` — **already carries bullish/bearish polarity** (`directionApplicability`) and mandatory/weight
- `execution: [...]` — same shape, the execution-confirmation checklist
- `tradeManagement: { maxRiskPercent, maxHoldingTime, customRules[], partialTakeProfits[] }`
- `setupTypes: { id, name }[]`

This is already called as a standalone Server Action (`loadStrategyReference` in `trades.actions.ts:113`) specifically so the client can fetch it on-demand when a strategy is selected — it is **not** baked into the initial form-options payload (`getTradeFormOptions` only returns accounts/strategies/propFirmAccounts). This on-demand shape is already extension-friendly in spirit; it just needs a REST wrapper (see [§9](#9-existing-api-inventory), [§11](#11-recommended-shared-domain-architecture)).

Scoring against the retrieved reference is done by two pure functions, `scoreStrategyAdherence` and `scoreSetup` (both in `domain/trades/*.ts`) — framework-free, no I/O, already called from both the client (live preview) and the server (authoritative, in `buildStrategyExecution`).

## 6. Account allocation architecture

- **Selection**: `TradeForm` lets the trader pick zero or more `TradingAccount`s (non-Performance) to allocate the same idea to, each with its own `riskInputType` (`PERCENT`/`AMOUNT`/`FIXED_SIZE`) and `riskValue`.
- **Performance Account participation is fully automatic, not optional.** `buildAllocations()` (`trades.service.ts:177`) unconditionally prepends a Performance Account allocation row to every trade, with `closingPnlNet: null` (never a fabricated 0) — every trade, whether or not the trader picks any other account, gets one.
- **Risk % storage**: for the Performance Account specifically, the *effective* risk % is locked once, at first actual entry, into `PerformanceRiskSnapshot` (`lockPerformanceRiskSnapshot`, `performance-account.service.ts:148`) — immutable after that (spec: "moving the stop later must never redefine the original 1R unit").
- **PnL calculation — two intentionally different bases, confirmed by reading the schema's own doc comment (`schema.prisma:1016-1031`) and the service code:**
  - **Performance Account ("System A")**: PnL is *derived from R* — `computeRealizedR()` → `computePerformancePnl(riskAmount, realizedR)` (`domain/performance/realized-r.ts`). No broker statement exists for this virtual benchmark account.
  - **Prop Firm accounts ("System B")**: PnL is the *ground truth* (from a real broker/prop-firm statement); R is derived from it (`netPnl / plannedRiskAmount`, `domain/prop-firms/risk.ts`) — the opposite direction.
- **Timing**: allocation *rows* are created at Trade Idea creation time (in the same transaction as the Trade itself); *settlement* (locking risk, computing realized R/PnL) happens later, triggered by `updateTradeSections` once `actualEntry`/exits exist — verified in the previous Analytics-pass audit in this repo (`performance-account.service.ts::settlePerformanceTrade`, called from `trades.service.ts::updateTradeSections`).
- **Owning service**: `performance-account.service.ts` for Performance Account math; `trade-executions.service.ts` for Prop Firm account math. Neither is duplicated elsewhere — confirmed in the prior audit that `PerformanceRiskSnapshot` is the single write-atomic authority (same `$transaction` writes both the snapshot and the allocation's `closingPnlNet`).

**For the extension**: Trade Idea creation should default to "Performance Account only" (the automatic behavior already matches this), with real account allocation deferred to the web app — exactly the pattern `AddTradeDialog` already uses today (`showAccountAllocation={false}` from Today's quick-add flow, `trades.service.ts` still allocates the Performance Account server-side regardless).

## 7. Media/screenshot architecture

One universal, polymorphic system — confirmed by reading the actual upload route, not assuming from the model name:

- **`MediaAsset`** — one row per uploaded file. `storageKey`/`url` point at Cloudflare R2 (confirmed live in `lib/media-storage.ts`; the schema's own inline comment claiming "UploadThing" is stale — see [§15](#15-risks--technical-debt)). Private bucket; objects are only ever served back through the authenticated `GET /api/media/[id]` proxy, never as public URLs.
- **`MediaAttachment`** — polymorphic join (`ownerType` + `ownerId`, no hard FK by design) linking a `MediaAsset` to whatever it documents (a Trade, a DailyNote, a DailyAssetAnalysis, etc.).
- **`POST /api/media/upload`** (`src/app/api/media/upload/route.ts`) — a genuine REST route (not a Server Action): `auth()` session check → 401 JSON on failure, `multipart/form-data` body (`ownerType`, `ownerId`, `category`, `caption`, `timeframe`, file), validates MIME/size/ownership via `media.service.ts`, uploads to R2, creates `MediaAsset` + `MediaAttachment`.
- **`GET /api/media/[id]`** — the only route that ever serves stored bytes back, re-checking ownership per request.

**The TradingView-screenshot-specific pipeline already exists and is explicitly named for this use case** (its own code comments literally say "TradingView Screenshot Trade Plan feature"):

- **`TradePlanScreenshot`** (`schema.prisma:2296`) — one per Trade (`@unique` on `tradeId`), points at a `MediaAsset` (the original upload) and optionally a second one (an annotated preview render, never overwriting the original). Has `recognitionProvider` (comment: `"e.g. anthropic-vision"`), `recognitionVersion`, `status: ScreenshotPlanStatus`.
- **`ScreenshotRecognitionField`** — one row per detected field (`SYMBOL`, `TIMEFRAME`, `DIRECTION`, `ENTRY`, `STOP_LOSS`, `TARGET`, `RISK_REWARD`, …), each with its own `confidence`, `boundingBox`, `rawExtractedText`, and a trader confirmation state (`PENDING`/`ACCEPTED`/`CORRECTED`/`REJECTED`).
- **`TradePlanAnnotation`** — the visual lines drawn on the screenshot (entry/stop/target/invalidation), normalized 0–1 coordinates, `confirmedPrice` as the actual source of truth (never the pixel position).
- **`PlannedTarget[]`** — the live, editable multi-target plan (TP1/TP2/…), each with a frozen `unitDistance`/`unitType`/`rMultiple` computed at confirm time from `domain/trade-plan/distance.ts` + the instrument catalog.
- **`TradePlanVersion`** — append-only, immutable snapshot created on first confirmation and on every edit of a locked plan (`editReason` required after v1). Freezes the targets and annotations as JSON so a later screenshot replacement can never rewrite history.
- **Service**: `trade-plan.service.ts` — `attachPlanScreenshot` → `runRecognition` (AI vision) → trader reviews/corrects fields → `savePlan` (writes `PlannedTarget[]` + a new `TradePlanVersion`) → `lockPlanIfConfirmedAndUnlocked`.
- **`domain/trade-plan/instrument-catalog.ts::resolveInstrumentSpecForSymbol`** — maps a detected/typed symbol to pip/tick/point size; deliberately returns `canonical: null` rather than guess when it can't confidently map one (relevant directly to [§14](#14-tradingview-integration-considerations)).

**How a TradingView extension screenshot would enter this without a second system**: capture the chart image client-side in the extension → `POST /api/media/upload` (already a real API — reusable as-is once auth is solved, [§9](#9-existing-api-inventory)) with `ownerType: "TRADE"` once a Trade exists, or stage it and call `attachPlanScreenshot`'s underlying logic once a trade ID exists → let `runRecognition` do what it already does. The extension's main value-add over the existing manual-upload flow is pre-filling `detectedSymbol`/`detectedTimeframe`/`detectedDirection` from the TradingView page itself (DOM/URL) *before* AI vision even runs, which the schema already accommodates (`recognitionSource: MANUAL | OCR | AI_VISION` — a fourth conceptual source, "page context," would slot into the same `ScreenshotRecognitionField.recognitionSource` pattern with `confidence: 1.0` and no visual recognition needed at all for those fields).

## 8. Authentication architecture

- **Library**: NextAuth v5 (`next-auth`), `PrismaAdapter`, **Credentials provider only** (email + bcrypt-hashed password) — no OAuth/social providers configured (`server/auth.ts`).
- **Session strategy**: `session: { strategy: "jwt" }` — a signed JWT in an httpOnly cookie, not a database-session lookup per request.
- **How API routes identify the user**: `const session = await auth();` then `session.user.id` — this is the *raw* pattern used in the two real API routes (`/api/media/upload`, `/api/media/[id]`), returning a manual `401` JSON on failure.
- **How pages/Server Actions identify the user**: `requireUser()` (`server/guards.ts`) — calls the same `auth()`, but **redirects to `/login`** on failure rather than returning an error value. This is the pattern every Server Action in `src/actions/*` uses. It is the wrong pattern for a JSON API (a redirect response is not useful to a programmatic client) — the two idioms already coexist in the codebase, and any new extension-facing routes must follow the `/api/media/upload` idiom, never `requireUser()`.
- **CSRF / same-origin assumptions**: Server Actions rely on Next.js's **built-in Origin-header same-origin check** (`next.config.ts` sets `serverActions.bodySizeLimit` but does **not** set `allowedOrigins` — confirmed by reading the config file — so the framework default applies: requests whose `Origin` header doesn't match the deployment's own host are rejected). A content script running on `https://www.tradingview.com` sends exactly that mismatched Origin, so **Server Actions are categorically unreachable from the extension as they exist today** — not a bug, a deliberate Next.js security default working as intended, but a hard architectural wall for this project.
- **What problems a browser extension would face**:
  1. It cannot use the Credentials-provider login flow the way the web app's `/login` page does and expect to end up with a usable, readable session — NextAuth's JWT cookie is `httpOnly` (unreadable to extension JS) and scoped to Traditorium's own origin (not sent on TradingView-origin requests even if it were readable, absent explicit cross-site cookie configuration Traditorium does not have).
  2. Even a correctly-obtained session cookie would not authorize a Server Action call from a different origin, because of the same-origin check above — this isn't just a cookie problem, it's a transport-protocol problem.
  3. There is currently **no token-based auth mechanism at all** (no API keys, no OAuth device flow, no PATs) — every existing authenticated surface assumes a same-site browser session.

## 9. Existing API inventory

| Path / function | Method | Auth | Request | Response | Service called | Classification |
|---|---|---|---|---|---|---|
| `/api/auth/[...nextauth]` | GET/POST | NextAuth internal | NextAuth protocol | NextAuth protocol | `server/auth.ts` | Web-app specific |
| `/api/export/trades` | GET (assumed from route dir) | `auth()` | query params | CSV | `export.service.ts` | Reusable as-is (read-only, already a real API) |
| `/api/media/upload` | POST | `auth()`, manual 401 | `multipart/form-data` | `MediaItemDTO` JSON | `media.service.ts` | **Reusable after refactor** — correct auth idiom already, just needs a token-auth option alongside the session cookie |
| `/api/media/[id]` | GET (assumed) | `auth()` + ownership check | — | file bytes | `media.service.ts` | Reusable after refactor (same reasoning) |
| `createTrade` (Server Action) | RSC action | `requireUser()` | `tradeSchema` | `{success, tradeId}` | `trades.service.ts::createTrade` | **Should not be exposed externally as-is** — needs a genuine REST wrapper; the underlying service is reusable, the transport is not |
| `updateTrade`, `updateTradeSection`, `archiveTrade` (Server Actions) | RSC action | `requireUser()` / guard | schema-parsed | result object | `trades.service.ts` | Same as above — service reusable, transport not |
| `loadStrategyReference` (Server Action) | RSC action | `requireUser()` | `strategyId` | `StrategyReferenceDTO` | `strategies.service.ts::getStrategyReference` | Service reusable as-is; needs a REST wrapper |
| `trade-plan.actions.ts::*` | RSC action | `requireUser()` | varies | varies | `trade-plan.service.ts` | Service reusable as-is; needs a REST wrapper (highest priority for the extension's actual use case) |
| `opportunity.actions.ts::*` | RSC action | `requireUser()` | varies | varies | `opportunity.service.ts` | Service reusable as-is; needs a REST wrapper |

No existing endpoint is safe to call directly from an extension today, because **none of them accept token-based auth** — this is a single, shared blocker across every row above, not a per-endpoint problem.

## 10. Business logic currently trapped in UI

Traced by grep-ing `trade-form.tsx` for calculation calls, not assuming from component size.

- **Not actually duplicated**: `trade-form.tsx` (lines 269–290) calls `scoreStrategyAdherence()` and `scoreSetup()` directly, client-side, for a *live preview* (`liveScores.confluencePercent`, `liveScores.executionPercent` rendered via `AdherenceMeter`, line 1064–1065) — these are the **exact same pure functions** `buildStrategyExecution()` calls server-side for the authoritative, persisted score. This is a legitimate, low-risk pattern (framework-free pure functions imported in two runtime contexts), not a duplicate implementation — flagging it here only because the audit explicitly asked to look, and because it's the *template* the extension's own live-preview UI should copy if it can bundle these same pure modules.
- **Genuinely worth watching**: `domain/trade-plan/planned-rr.ts::computeTargetRMultiples`/`computeWeightedPlannedR` and `domain/trade-plan/distance.ts::computeDistance` are called from `trade-form.tsx` for the plan-preview UI. These are also pure/framework-free, so the same "not duplicated, just invoked from two places" reasoning applies — but confirm before Step 2 that the *server-side* confirm path (`trade-plan.service.ts::savePlan`) computes its own frozen copy independently rather than trusting whatever the client already computed and submitted (not verified in this pass — flagged for Step 2 scoping, not confirmed as a bug).
- **Recommendation**: no code should move yet (per the constraints of this pass). If/when the extension needs its own live-preview UI, the right move is to either (a) publish `domain/trades/*` and `domain/trade-plan/*` as an importable shared package the extension bundle can pull in directly (they already have zero Prisma/React dependencies), or (b) skip live preview in the extension's v1 and let the server response after save be the only source of the score — simpler, and consistent with "Traditorium must remain the source of truth."

## 11. Recommended shared-domain architecture

The codebase already has the right *shape* — it's missing one layer, not restructured:

```
Traditorium Web UI (React)
  ↓ Server Actions ("use server")
  ↓
Shared Trade Services  ←──────────────┐   (trades.service.ts, strategies.service.ts,
  ↓                                    │    trade-plan.service.ts, opportunity.service.ts,
Shared Trade Domain (pure functions)  ←┤    performance-account.service.ts — UNCHANGED)
  ↓                                    │
Prisma / Postgres                     │
                                        │
TradingView Extension                  │
  ↓ HTTPS                              │
  ↓                                    │
NEW: Thin REST API layer  ─────────────┘   (src/app/api/v1/trades/*, /strategies/*, /media/*)
  (token auth, JSON in/out, calls the
   SAME service functions above —
   zero new business logic)
```

The **only new component** is the REST API layer, and it should contain *no logic beyond*: authenticate the token → map JSON to the existing `tradeSchema`/service function signatures → call the exact same service function a Server Action already calls → serialize the result. This is directly analogous to how `/api/media/upload` already sits beside the Server-Action-driven rest of the app without duplicating `media.service.ts`.

## 12. Extension authentication considerations

Not implementing — options to evaluate at Step 2 planning time, given what §8 found:

- **Personal API keys / tokens**: a new, minimal model (e.g. `ApiToken { id, userId, hashedToken, name, createdAt, lastUsedAt, revokedAt }`), issued from an authenticated web-app settings page, sent as `Authorization: Bearer <token>` by the extension, verified in the new REST layer (not via `requireUser()` — a new `requireApiUser(request)`-style helper following the `/api/media/upload` idiom of returning JSON errors, not redirects).
- **OAuth-style device/browser handoff**: the extension opens a Traditorium page in a real tab, the trader is already logged in there via the normal session, that page mints a short-lived token and hands it back to the extension (`chrome.identity`-style or a simple "connect" page). More setup, better trader UX (no manual key-copying), same underlying token-verification code either way.
- **What NOT to do**: do not attempt to read/replay the NextAuth session cookie from the extension. It's httpOnly, origin-scoped, JWT-based (no server-side revocation list without extra infrastructure), and was never designed to leave the browser's normal same-site request flow. Building around it would be fragile and would fight the framework rather than use it.

Either approach needs new auth code; neither requires changing the existing NextAuth config, session strategy, or web-app login flow (consistent with the constraint not to change auth in this pass).

## 13. Trade identity recommendation

- **Current identity**: `Trade.id` is a `cuid()` — globally unique, non-sequential, opaque. `Trade.tradeNumber` is a separate, per-user **monotonic integer** (`nextTradeNumber()`, `trades.service.ts:514`), assigned once at creation and never reused or shifted, already used as a stable chronological tie-breaker (`performance-account.service.ts::isBefore`).
- **Is the current ID appropriate for future cross-system matching?** Yes, structurally — every related table (`TradeAccountAllocation`, `PerformanceRiskSnapshot`, `TradePlanScreenshot`, `PlannedTarget`, `TradeOpportunity.executedTrade`, `ReplayComparisonLink`, CSV import mapping tables) already keys off `Trade.id` directly, and it's already the join key Analytics/Replay/Journal all use (confirmed in the prior Analytics-pass audit in this repo). **No change to the internal ID is needed or recommended.**
- **Recommendation on a human-readable external identifier**: worth adding as an **additional, display-only, derived field** — never a replacement for `id`, never a new join key. Something like `TRD-20260919-XAUUSD-0042` (date + asset + the existing `tradeNumber`, zero-padded) is trivially derivable from data the `Trade` row already has (`tradeDate`, `assetSymbol`, `tradeNumber`) — it doesn't even need a new column; it could be a pure formatting function (`domain/trades/display-id.ts` or similar) computed on read. This is genuinely useful once the extension exists (a trader referencing "the trade I logged from TradingView" in a support conversation, a screenshot filename, a log line) but is **cosmetic, not structural** — recommend deferring the actual formatting function to whenever the extension's UI first needs to display something to the trader, not building it speculatively now.

## 14. TradingView context

**Reliable browser/TradingView context** (a content script can read these directly from the page, no chart internals required):
- Current URL (`https://www.tradingview.com/chart/.../?symbol=OANDA:XAUUSD`) — the `symbol` query param is TradingView's own documented URL contract, not an internal.
- Symbol, as parsed from that URL param — maps to `resolveInstrumentSpecForSymbol()`'s job (§7), which already expects to receive a string it may or may not confidently canonicalize.
- Timestamp (`new Date()` at capture time) — trivial, reliable.
- A screenshot of the visible chart area (`chrome.tabs.captureVisibleTab` or similar Manifest V3 API) — a real browser API, not a TradingView internal; this is exactly the image the existing `TradePlanScreenshot`/recognition pipeline already expects.

**Potentially obtainable but fragile** (would require reading TradingView's DOM/internal state, which changes without notice and isn't a documented contract):
- Timeframe (visible in the UI, but as DOM text/attributes, not a stable API) — TradingView does *not* always put timeframe in the URL the way it does symbol.
- Current price — displayed in the DOM, but scraping it risks silent breakage on any TradingView UI update, and Traditorium's own domain comments (`realized-r.ts`) are already explicit that this app has "no price feed" and never wants one.
- Any drawn lines/levels the trader already has on their TradingView chart (entry/stop/target guesses) — these live in TradingView's own drawing-tools state, not exposed as a documented API.

**Should require trader confirmation** (never write these into a Trade unconfirmed, mirroring the existing `ScreenshotRecognitionField.confirmationStatus` pattern exactly):
- Anything in the "fragile" bucket above, if attempted at all.
- Direction (LONG/SHORT) — even if inferable from drawn tools, this is a trading decision, and the codebase's own philosophy (`DailyAssetAnalysis`'s doc comment: "the trader can still disagree") explicitly never auto-derives a trading decision from evidence.
- Entry/stop/target prices, even AI-vision-detected ones — this is exactly what `ScreenshotRecognitionField`/`TradePlanAnnotation` already require confirmation for today; the extension changes nothing about this rule, only how the *first guess* gets populated.

**Recommendation**: the extension should lean entirely on the "reliable" bucket for auto-fill (symbol from URL, screenshot, timestamp) and route everything else through the existing AI-vision recognition + trader-confirmation pipeline (§7) rather than attempting DOM scraping of TradingView internals.

## 15. Risks / technical debt

- **Transport gap is total, not partial** (§8, §9): every write operation in the app goes through Server Actions; zero of them are reachable externally today. Step 2 must build new surface area, not adapt existing surface area.
- **No token-auth mechanism exists anywhere in the codebase** — this is new infrastructure, not a config toggle.
- **Stale schema documentation**: `MediaAsset.storageKey`'s inline Prisma comment says "UploadThing file key"; the actual, live implementation (`lib/media-storage.ts`) is Cloudflare R2. Harmless today (doesn't affect behavior), but worth a one-line comment fix whenever that file is next touched for an unrelated reason — not urgent enough to justify touching it in this read-only pass.
- **`requireUser()`'s redirect-on-failure behavior is incompatible with JSON APIs** — a real risk if a future contributor reaches for the familiar `requireUser()` helper inside a new extension-facing route out of habit instead of the `/api/media/upload` pattern. Worth calling out explicitly in Step 2's PR description/review checklist.
- **Client-side plan-RR preview vs. server confirm** (§10): not confirmed as a bug in this pass, but not confirmed safe either — `trade-plan.service.ts::savePlan`'s trust boundary wasn't traced deeply enough here to rule out the server trusting a client-submitted R multiple rather than recomputing it. Flag for Step 2, don't assume either way.
- **`getStrategyReference`'s shape is already good but untyped-at-the-boundary for an external client** — it currently returns a plain inferred object, not a versioned/documented DTO contract. A REST wrapper should freeze this into an explicit response type before any extension code depends on its exact shape.

## 16. Recommended implementation sequence

1. **Step 2** (see below): thin, token-authenticated REST wrapper around `getStrategyReference`, `createTrade`, and the media-upload path — no extension yet, just prove the API layer works against the existing services from something other than the Next.js app itself (e.g., `curl`/Postman/an internal test script).
2. **Step 3**: token issuance UX in the web app (a Settings → "Connected Apps"/"API Keys" page) — the human side of §12.
3. **Step 4**: the actual browser extension skeleton (manifest, content script for TradingView context capture, side panel UI) — calling the Step 2 API, nothing else.
4. **Step 5**: wire the TradingView-screenshot capture into the existing recognition pipeline (§7) end-to-end.
5. **Step 6** (optional/deferred): shared pure-domain bundle for extension-side live preview (§10, §11), only if product feedback says the extension needs live scoring before save.

---

# Step 2 Recommendation

Based specifically on what this repository already has, the smallest safe Step 2 is:

**Build one new, additive REST API surface (`src/app/api/v1/*`) that does nothing but authenticate a token and call the exact service functions that already exist — `getTradeFormOptions`, `getStrategyReference`, `createTrade` (from `trades.service.ts`/`strategies.service.ts`), plus the existing `/api/media/upload` route extended to also accept token auth alongside its current session-cookie auth.** No Prisma schema change is required for the trade-creation path itself (only a new, small `ApiToken`-style model for §12 — itself additive, no changes to any existing table). No existing Server Action, page, or component needs to change. No business logic is rewritten — every calculation, validation rule, and database write stays exactly where it is today; the new routes are pure adapters.

Concretely, this means:
- A new Prisma model for token storage (additive migration only — no column changes to `Trade` or any other existing table).
- A new `requireApiUser(request)` helper (`server/guards.ts` or a sibling file) that checks `Authorization: Bearer` instead of the session cookie, returning a JSON 401 rather than redirecting — modeled on `/api/media/upload`'s existing pattern, not `requireUser()`.
- 2–3 new route files under `src/app/api/v1/` that each do: verify token → parse JSON with the existing Zod schemas (`tradeSchema`, etc.) → call the existing service function → return JSON.
- A handful of integration tests (see below) proving the new routes produce identical results to the existing Server Actions for the same input, and that they correctly reject unauthenticated/invalid-token requests.

This can be built, tested, and verified entirely without touching TradingView, without installing any extension tooling, and without putting any new business rule anywhere but the existing service layer — which is exactly what "Traditorium must remain the source of truth" requires.

**Do not implement this yet — this section describes the recommendation only, per the constraints of this pass.**
