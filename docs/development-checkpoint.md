# Traditorium — Development Checkpoint

**Checkpoint date:** 2026-09-13
**Branch:** `feat/r2-media-storage`
**Base commit at checkpoint time:** `c684018` — "feat: Trade Idea Validation Shield through Daily Market Plan (Stages 4-11)"

This document is the resumable source of truth for where the project stands.
Update it at the end of any session where meaningful milestone progress was
made, rather than relying on chat history alone.

---

## Current milestone

**Stages 1–16: COMPLETE.**

Workflow implemented end to end:

Plan → Execute → Journal → Analyze → Edge Review → Replay → Actual vs Replay
Comparison → Improvements → Carry Forward into Today.

**Stage 17A — Production Historical Market Data Provider Research: COMPLETE**
(research/architecture only, no code).

**Stage 17B — Databento Futures Historical Market Data Integration: IMPLEMENTED**
(this session, 2026-09-13) — **uncommitted at the time this checkpoint was
written, then included in the checkpoint commit below.** See "Correction to
this checkpoint's original premise" further down before trusting anything
that says otherwise.

---

## Provider direction (Stage 17A conclusion, now partially executed)

- Futures → **Databento** (implemented, Stage 17B).
- Forex/XAUUSD → provider decision/integration still pending (Stage 17C, not started).
- `FixtureMarketDataProvider` remains available and is still the ACTIVE
  default for every asset in every environment where `DATABENTO_API_KEY`
  and/or `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED` are not both set — which is
  every environment today, since neither is configured anywhere yet.
- Real provider data is not exposed to public users until licensing/
  redistribution rights are confirmed — enforced in code via
  `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED` (default off), independent of
  whether an API key is present.

### Important Stage 17A conclusions (status of each, now that 17B exists)

| Conclusion | Status |
|---|---|
| Actual historical futures contracts should be execution-of-record | ✅ implemented — Databento adapter always resolves literal dated contracts (e.g. `ESZ6`), never a back-adjusted continuous series |
| Avoid back-adjusted continuous contracts for simulated fills | ✅ implemented |
| Contract resolution should be automatic | ✅ implemented via Databento's `symbology.resolve` (volume-based continuous symbol), not a handwritten calendar |
| Monthly periods may cross futures rollover | ✅ handled — `resolveContract` returns multiple contract segments when a range crosses a roll |
| Market-data provider must remain frozen for an existing Replay session | ✅ implemented — `ReplayReviewSession.marketDataProvenance`, freeze-once, no silent fallback |
| Market-data provenance should eventually be frozen | ✅ implemented (see above) |
| Server-side provider calls only | ✅ — `databento-provider.ts` lives under `server/services/`, never imported client-side |
| API keys must never reach browser | ✅ — `DATABENTO_API_KEY`, no `NEXT_PUBLIC_*` |
| Persistent R2 caching desirable only where licensing permits | ✅ implemented, opt-in, default OFF (`DATABENTO_R2_CACHE_ENABLED`) |
| Full-period Replay candle loading needs chunking/prefetch for production | ✅ implemented — `domain/market-data/replay-prefetch-window.ts` + reworked `replay-market-panel.tsx` |
| Fixture provider must remain for deterministic tests | ✅ unchanged, still the default everywhere |
| No automatic provider switching halfway through Replay | ✅ enforced by freeze-once |
| External-display/redistribution licensing must be confirmed before public real-data use | ✅ enforced via `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED`, default off |

---

## Correction to this checkpoint's original premise

The checkpoint task that produced this document was written assuming
**"Stage 17B has NOT been implemented yet"** and instructed that nothing
related to it be created. At the time this checkpoint was run, Stage 17B was
**already fully implemented** in the working tree from earlier in the same
session. This was flagged to the user immediately, who confirmed: record it
as done, include it in today's checkpoint commit, and treat tomorrow's task
as **reviewing/verifying** Stage 17B rather than starting it.

Everything below reflects the ACTUAL repository state, not the task's
original assumption.

---

## Repository state at checkpoint

- **Branch:** `feat/r2-media-storage` (up to date with `origin/feat/r2-media-storage`)
- **HEAD before this checkpoint commit:** `c684018c6efbbe8def66631d9c4978ae466c09a7`
- **Working tree before this checkpoint commit:** 18 modified files, 1 deleted
  file (`src/components/edge/weekly-reflection.tsx`, superseded by Stage 16's
  Improvements panel), 46 untracked files/directories — spanning Stages
  12–16, Stage 17A's `.env.example`/gitignore fix, and Stage 17B in full
  (provider, cache, migration, docs, prefetch refactor).
- **Migrations:** 69 present; `npx prisma migrate status` reports the
  database schema up to date (includes
  `20260913020000_replay_market_data_provenance`, applied earlier this
  session via `prisma db execute` + `prisma migrate resolve --applied`
  rather than `migrate dev`, because an EARLIER, unrelated migration
  (`20260912221500_replay_execution_engine`) had already drifted from its
  applied checksum before this session started — see Known Technical Debt).
- **Prisma Client:** current — regenerated after the provenance migration;
  `marketDataProvenance` is present in `node_modules/.prisma/client`.
- **No unfinished Stage 16 or Stage 17A changes found** — both are complete
  and verified (see below).

---

## Stage 16 verification (code-verified, not rebuilt)

- ✅ Replay improvements synthesis: `synthesizeImprovements` (`src/domain/replay-improvements/synthesis.ts`)
- ✅ Deterministic findings: `findings.ts` (`deriveExecutionFindings`, `deriveBehavioralFindings`, `deriveOpportunityFindings`, `deriveStrategyVarianceFindings`, `derivePositiveFindings`) — pure functions over `ActualVsReplayComparison`, no external calls
- ✅ Deterministic suggested commitments: `deriveSuggestedCommitments` (`suggestions.ts`)
- ✅ `EdgeReviewCommitment` and `EdgeReviewCommitmentDailyState` models present in `prisma/schema.prisma`
- ✅ Weekly/monthly carry-forward into Today: `getActiveCommitmentsForToday`/`getCommitmentDailyStates` wired into `today/page.tsx` → `TodayFocusFromReview`
- ✅ Separate `reviewFinalizedAt` (distinct from `status`/`completedAt`), set only by `finalizeEdgeReview`
- ✅ Finish Review behavior present (`finalizeEdgeReview`)
- ✅ Replay reopening revokes finalization: `reopenReplayReviewSession` clears `reviewFinalizedAt` alongside `status`/`completedAt`
- ✅ Existing `WeeklyReview` reflection fields (`wentWell`/`toImprove`/`focusNextWeek`) remain untouched and authoritative in `edge.service.ts`
- ✅ No AI/LLM coaching introduced — no `anthropic`/`openai`/LLM import anywhere in `src/domain/replay-improvements/`; everything is pure derivation over the comparison data

## Replay checkpoint verification (code-verified, not rebuilt)

- ✅ `ReplayReviewSession`, `ReplayTrade`, `ReplayTradePartialExit`, `ReplayComparisonLink` — all present in `prisma/schema.prisma`
- ✅ Replay Clock: `domain/market-data/replay-clock.ts`
- ✅ Historical candle abstraction: `domain/market-data/provider-types.ts` (`HistoricalMarketDataProvider`)
- ✅ `FixtureMarketDataProvider`: `domain/market-data/providers/fixture-provider.ts` — still available, still the default
- ✅ No-hindsight candle visibility: `domain/market-data/visible-candles.ts`
- ✅ Timeframe aggregation: `domain/market-data/aggregation.ts`
- ✅ Replay chart: `components/replay/replay-candlestick-chart.tsx`
- ✅ Strategy-version-at-time resolution: `domain/replay/historical-strategy-version.ts` (`pickVersionAtTime`)
- ✅ Setup Type/scenario validation reused (not duplicated): `SetupValidationSnapshot` referenced directly in `replay-review.service.ts`
- ✅ MARKET/PENDING simulated execution, SL/TP, partial exits, manual management, ambiguity handling: `domain/replay-execution/engine.ts`
- ✅ Realized R is primary throughout (`realizedR`, `realizedReplayR` in `types/replay.ts`)
- ✅ Actual baseline freezing: `ReplayReviewSession.actualBaselineSnapshot`
- ✅ Actual vs Replay matching: `domain/replay-comparison/decision-matching.ts`
- ✅ Manual comparison links: `ReplayComparisonLink` model + `replay-comparison-link.service.ts`
- ✅ Missed-opportunity classification: `OPPORTUNITY` link type + `setMissedOpportunityClassification`
- ✅ Four discrepancy buckets + Avoidable Discrepancy: `domain/replay-comparison/discrepancy-buckets.ts` (`AVOIDABLE_DISCREPANCY_FORMULA`)
- ✅ Edge Improvements + commitments carried into Today: confirmed above

## Historical market-data status (ACTUAL, corrected from the task's premise)

**Production historical market data IS now integrated (Stage 17B), but is
NOT active by default anywhere.** Concretely:

- `resolveMarketDataProvider(canonicalSymbol)` (`market-data.service.ts`)
  only ever returns the Databento provider for `GC`/`ES`/`NQ` when BOTH
  `DATABENTO_API_KEY` is set AND `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED` is
  exactly `"true"`.
- Neither variable is set in this environment's `.env` today.
- Therefore every Replay session today — including any created before this
  checkpoint — still runs entirely on `FixtureMarketDataProvider`, exactly
  as the original Stage 17A-era assumption expected.
- Forex/XAUUSD/indices are unconditionally Fixture regardless of any env
  var (Stage 17C territory, not started).

So: the code for Databento exists and is wired in, but the RUNTIME BEHAVIOR
of the app is unchanged from before this session until someone deliberately
sets both env vars. This is why running the app today still looks/behaves
identically to pre-17B.

---

## Known technical debt (preserved, not fixed tonight)

1. **Test teardown FK issue.** `prisma.user.deleteMany()` in several test
   files' `afterAll`/`cleanupUsers` throws on
   `TradeAccountAllocation_tradingAccountId_fkey`. Confirmed today: 14 test
   files affected, **1390 passed / 1 intentionally skipped, 0 actual
   assertion failures** — the failures are 100% in teardown, not in test
   bodies. Pre-existing, not caused by Stage 16/17A/17B. Do not fix
   opportunistically; needs a deliberate look at shared dev-DB fixture
   hygiene across the prop-firm/account test factories.
2. **Test-suite DB contention.** A setup-validation test has occasionally
   hit the 5-second timeout during the full suite run but passes
   independently. Not reproduced as a hard blocker today. Leave alone
   unless it starts failing consistently.
3. **Dashboard analytics.** `/dashboard` remains the known last caller of
   the older `getAnalyticsData` path (predates the canonical analytics
   pipeline). Not part of Stage 17B; not touched.
4. **Strategy restore gap.** `restoreStrategyVersionAsNewStrategy` does not
   yet reconstruct Setup Types. Not part of Stage 17B; not touched.
5. **Pre-existing migration checksum drift.** `20260912221500_replay_execution_engine`
   had already drifted from its applied checksum before this session
   started (unrelated to Stage 17B). Worked around for the new provenance
   migration via `prisma db execute` + `prisma migrate resolve --applied`
   instead of `prisma migrate dev`, to avoid the reset `migrate dev` wanted
   to perform. This drift is still present and will surface again the next
   time anyone runs `prisma migrate dev` normally — worth a deliberate look,
   not an accidental fix.
6. **Forex/XAUUSD provider (Stage 17C).** Not started. Stage 17A's own
   recommendation (Twelve Data Venture tier, due to per-end-user display
   licensing on cheaper tiers) is documented in that stage's research but
   not implemented.

---

## Verification run at this checkpoint (2026-09-13)

- `npx prisma migrate status` — schema up to date, 69 migrations, none pending
- `npx tsc --noEmit` — **clean**
- `npx eslint .` — **clean** (1 pre-existing unrelated warning: unused var in `prop-firms-analytics.service.test.ts`)
- `npx vitest run` — **1390 passed, 1 skipped** (Databento live smoke test, self-skips without `DATABENTO_API_KEY`); 14 files show a teardown-only failure — see Known Technical Debt #1
- `npx next build` — **clean**, all routes compile including `/replay`, `/replay/[sessionId]`, `/edge`

---

# RESUME HERE

> **Next task:** Verify and review Stage 17B (Databento Futures Historical
> Market Data Integration) — it was implemented in the 2026-09-13 session
> but had not yet been reviewed/exercised against a real Databento account
> when this checkpoint was written. This is NOT "start Stage 17B" — the
> code, migration, tests, and docs already exist and are committed (see the
> checkpoint commit below). Confirm before extending it further:
>
> - `DATABENTO_API_KEY` still isn't set anywhere real — the live smoke test
>   (`src/server/services/market-data/databento-live-smoke.test.ts`) has
>   never actually run against Databento's API. Get a key and run it before
>   trusting the adapter's field-name/response-shape assumptions (see that
>   provider file's own doc comment for exactly what's confirmed vs.
>   assumed).
> - `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED` is still off everywhere — nothing
>   changes for real users until that's deliberately flipped after licensing
>   confirmation.
> - Re-check current official Databento API documentation rather than
>   relying solely on remembered Stage 17A/17B research — several details
>   (exact `ohlcv-1m` field names beyond `ts_event`, pagination, rate
>   limits) were implemented defensively because they couldn't be confirmed
>   without a live key.
> - Once verified, Stage 17C (Forex/XAUUSD provider) is the next unstarted
>   milestone — do not begin it without explicit instruction.
>
> Architectural reminder for whenever Stage 17C (or further 17B hardening)
> resumes: preserve the Replay Clock, no-hindsight engine, execution engine,
> Fixture provider, and Comparison/Improvements architecture exactly as they
> are — Databento (and any future forex provider) is additive through the
> Stage 13 `HistoricalMarketDataProvider` abstraction, never a replacement
> of it.
