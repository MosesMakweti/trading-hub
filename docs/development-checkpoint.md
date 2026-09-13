# Traditorium — Development Checkpoint

**Checkpoint date:** 2026-09-14
**Branch:** `feat/r2-media-storage`
**Checkpoint commit:** see "Repository state at checkpoint" below (this
document is committed together with the work it describes).

This document is the resumable source of truth for where the project stands.
Update it at the end of any session where meaningful milestone progress was
made, rather than relying on chat history alone. Older checkpoints are kept
further down the file as history — do not delete them, append above them.

---

# RESUME HERE

> **Last completed:** Stage 20 (Traditorium AI Review Analyst Foundation) +
> the Replay chart-color runtime fix (Chrome `var(--x)` crash, then a
> follow-up Safari `lab(...)` crash — see "Replay runtime color fix" below).
>
> **Before starting anything new:**
> 1. **Manually verify Replay in Safari** (and ideally Chrome/Firefox too).
>    Nobody has interactively confirmed the chart-color fix in a live
>    browser session yet — only static/source-level verification and
>    Node-environment unit tests were possible from this side. See
>    "Pending manual verification" below for the exact checklist.
> 2. Do not assume `ANTHROPIC_API_KEY` is configured — Stage 20's AI
>    Analyst is **CODE ACCEPTED / LIVE VERIFICATION PENDING**. No live
>    Claude call has ever been made against the Review Analyst provider in
>    this environment.
>
> **Next planned milestone:** Stage 20.1 — Analyst Evidence Coverage,
> History & Production Acceptance (not started — see "Next milestone"
> below for the known gaps it would address). **Do not begin it without
> explicit instruction.**

---

## Current milestone (as of this checkpoint)

**Stages 1–19.1: COMPLETE.** Full workflow implemented end to end:

Plan → Execute → Journal → Analyze → Edge Review → Replay → Actual vs Replay
Comparison → Improvements → Commitment Adherence & Longitudinal Improvement
Analytics → Carry Forward into Today.

**Stage 18 (Replay UX, Chart Tools & Decision Workflow): COMPLETE.**
Chart-assisted price selection, minimal drawing/annotation layer (horizontal
line/trend line/rectangle/text), collapsible decision panel, keyboard
shortcuts, bottom-dominant clock bar, read-only Daily Market Plan reference
panel, execution timeline, reasoning notes.

**Stage 19 (Commitment Adherence & Cross-Period Improvement Analytics):
COMPLETE.** Commitment lineage (Continue/Refine/Complete/Retire), FOLLOWED/
BREACHED applicability, deterministic adherence (`followed / (followed +
breached)`, never a fake 0%), sample-size transparency, conservative trend
classification, resolution-eligibility suggestion (never automatic),
manual/system evidence provenance, Today adherence summaries, Replay/
Comparison-derived automatic evidence, weekly/monthly deduplication.

**Stage 19.1 (Improvement Intelligence UX & Analytics Completion):
COMPLETE.** Trade Idea contextual commitment reminder (deterministic,
override-discipline only), commitment history Sheet + restrained trend
chart, Analytics → Improvement section (overview KPIs, most-breached,
longest-running, improving/declining ranking, behaviour-occurrence
series), three new automatic-evidence rules (behaviour-label pattern,
overtrading, risk-limit — all from real Trade/TradingDay/Daily-Market-Plan
data, never PnL), manual opt-in to automatic tracking on a self-authored
commitment.

**Stage 20 (Traditorium AI Review Analyst Foundation): CODE COMPLETE /
LIVE ANTHROPIC VERIFICATION PENDING** (no `ANTHROPIC_API_KEY` configured
anywhere in this environment — mock-provider tests substitute for a real
call, per that stage's own explicit instruction not to fake live
verification). Provider-independent evidence package
(`TraderReviewEvidencePackage`) built from existing read models only (never
duplicated analytics), evidence hierarchy (OBJECTIVE/DERIVED/
TRADER_REPORTED), stable evidence IDs + citation validation (unknown
citations trigger one corrective retry, then a typed failure — never a
fabricated citation rendered), qualitative confidence only, Claude provider
(reuses the `@anthropic-ai/sdk` dependency and the exact provider-resolver
pattern already established by the Trade Plan screenshot-recognition
feature), persisted `AiReviewAnalystReport` (evidence-fingerprinted, never
overwritten — every regeneration is a new row), new Edge → Analyst tab
(structured report, confidence badges, evidence-citation drawer, staleness
banner). AI strictly analyzes the trader's PROCESS — no market prediction,
no autonomous trading, no automatic commitment mutation anywhere in the
contract or system prompt.

**Stage 20.1: NOT STARTED.**

---

## Replay runtime color fix (this session, 2026-09-14)

Two sequential real runtime bugs were found and fixed in the current (post
Stage-18) `replay-candlestick-chart.tsx` — **not** stale pre-Stage-18 log
noise, as an earlier turn in this session incorrectly assumed before the
user reproduced it live.

1. **Chrome/general:** `lightweight-charts` was handed raw
   `var(--muted-foreground)` / `color-mix(in oklch, var(--border) 60%,
   transparent)` / etc. directly in `createChart`/`addSeries`/canvas
   `fillStyle` calls. Traditorium's theme tokens are oklch-based
   (`globals.css`); the library's own color-resolution trick (a hidden DOM
   element + `getComputedStyle().color`) returns a literal `"oklch(...)"`
   string on modern browsers instead of always normalizing to `rgb()`,
   which the library's parser rejects, throwing `Failed to parse color`.
2. **Safari (found on manual retest, proving the first fix's approach
   wrong):** an interim fix tried to normalize arbitrary CSS colors at
   runtime via a canvas 2D context `fillStyle` round-trip (assuming the
   getter always serializes back to `rgb()`/hex). Safari serializes an
   oklch-derived color back out as `lab(...)` instead — which the library
   rejects identically. **Conclusion: canvas serialization is not a
   reliable cross-browser normalization boundary and must not be relied on
   again.**

**Final architecture (in place now):** an explicit, static,
lightweight-charts-safe color palette — `REPLAY_CHART_COLORS_DARK` /
`REPLAY_CHART_COLORS_LIGHT` in `src/components/replay/replay-chart-colors.ts`
— every value a literal `#hex`/`rgba(...)`, never derived from CSS at
runtime. `getReplayChartColors(resolvedTheme)` (from `next-themes`) selects
between them; theme changes call `chart.applyOptions`/`series.applyOptions`
(chart is never recreated). A strict, pure validator,
`isLightweightChartSafeColor`/`assertLightweightChartSafeColors`
(`src/components/replay/chart-color-safety.ts`), throws a clear internal
error in development if a palette value is ever unsafe, so this class of
bug can never again surface only as a mysterious library-internal crash in
one specific browser. The earlier dynamic CSS-resolution module
(`src/lib/chart-color.ts`) was deleted entirely — it depended on the
disproven canvas-serialization assumption and had no other consumer.

### Pending manual verification (Replay)

Nobody has interactively confirmed any of this in a live browser yet. On
resuming, before anything else:

- [ ] Chart opens with **no** `Failed to parse color` error, in Safari
      specifically (the browser that broke the previous fix) and ideally
      Chrome/Firefox too.
- [ ] Dark ↔ light theme switching updates chart colors correctly without
      recreating the chart.
- [ ] Price lines (entry/stop/targets), markers (fill/partial/close), and
      drawings (horizontal line/trend line/rectangle/text) render with the
      expected colors.
- [ ] Determine whether `Rendered more hooks than during the previous
      render` still reproduces **independently** of the color crash. An
      exhaustive static line-by-line audit of every component in the
      Replay render chain (`ReplayCandlestickChart`, `ReplayMarketPanel`,
      `ReplayDecisionPanel` + both sub-forms, `ReplayDailyMarketPlanPanel`,
      `ReplayStrategyPanel`, `ReplayWorkspace`, `EdgeReviewWorkspace`'s tab
      switching, `ReplayActualPeriodPanel`) found **no** rules-of-hooks
      violation. The dev log showed this error only ever immediately after
      a cluster of repeated color-parse throws, never independently —
      strong circumstantial evidence it was a downstream artifact of the
      crash, not a separate structural bug — but this is not proven without
      an interactive retest. **Do not modify hook structure unless this
      reproduces independently.**

---

## Other remaining known items (not blockers)

**Stage 18 deferred UX** (deliberately out of scope when raised, not
forgotten):
- Review-period navigation strip.
- True live-clock cross-tab Strategy pinning.

**Improvement system (Stage 19/19.1) minor remaining enhancements:**
- Proactive suggestion generation for overtrading/risk-limit commitments
  (currently reachable only via a manual opt-in on a self-authored
  commitment — there is no Stage 16-style deterministic suggestion card
  for these two rules yet).
- Manual/system evidence-conflict UI (manual precedence is preserved and
  correct; there is just no surfaced "your reflection says X but the
  record shows Y" UI yet).

**AI Analyst (Stage 20) known gaps**, likely Stage 20.1 scope:
- Stage 19.1's behaviour-occurrence trend series (per-rule breach counts
  per period) is not yet exposed inside the AI Evidence Package.
- No Analyst generation-history UI (older reports remain in the DB and are
  queryable, but only "the latest" is ever shown).
- Live Anthropic verification pending (see above).
- No conversational Analyst (deliberately deferred, per Stage 20's own
  instruction).
- No embeddings, no vector DB, no model training (deliberately out of
  scope — Stage 20 uses an existing capable model over deterministic
  structured evidence only).

**Market data readiness — preserve this truth exactly, do not round up:**

| Provider | Code status | Live verification | Production enabled |
|---|---|---|---|
| Databento (futures) | CODE ACCEPTED | **PENDING** — no `DATABENTO_API_KEY` configured; live smoke test has never run against the real API | **NO** — `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED` is off |
| Twelve Data (forex/metals) | CODE ACCEPTED | **PENDING** — no `TWELVE_DATA_API_KEY` configured; live smoke test has never run | **NO** — `TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED` is off |

Both remain exactly where Stage 17B/17C left them. `FixtureMarketDataProvider`
(synthetic, dev-only) is still the ACTIVE default for every asset in every
environment today.

---

## Repository state at checkpoint (2026-09-14)

- **Branch:** `feat/r2-media-storage`.
- **HEAD before this checkpoint's commit:** `3b68d49` — "chore: checkpoint —
  Stages 12-16 replay/edge review, Stage 17A research, Stage 17B Databento
  futures integration" (1 commit ahead of `origin/feat/r2-media-storage` at
  that point).
- **This session's work (Stages 18–20 + the Replay color fix) was
  uncommitted in the working tree until this checkpoint** — see the actual
  commit hash in this repository's `git log` for the precise commit this
  paragraph refers to; this document does not hardcode it to avoid the doc
  going stale the instant it's read after a later commit.
- **Migrations:** 4 new since the last checkpoint, all additive, all
  applied — `20260913163906_replay_chart_annotations`,
  `20260913180023_commitment_adherence`,
  `20260913213145_ai_review_analyst_report`,
  `20260913214500_ai_review_evidence_index`. `npx prisma migrate status`:
  schema up to date, no pending migrations.
- **Secret audit:** performed before committing — no API keys, database
  credentials, or other secrets found in any tracked diff or untracked
  file; `.env` remains untracked/gitignored; only `.env.example` (placeholder
  values only) was updated.

## Verification run at this checkpoint (2026-09-14)

- `npx prisma migrate status` — schema up to date, 73 migrations, none pending.
- `npx tsc --noEmit` — **clean**.
- `npm run lint` — **clean** (1 pre-existing unrelated warning: unused var
  in `prop-firms-analytics.service.test.ts`, present on unmodified `master`
  too — not introduced this session).
- `npx vitest run` — **1690 real assertions passed, 5 skipped** (live
  smoke tests that self-skip without their respective API keys), **0 new
  regressions**. 14 test files show a pre-existing, unrelated `afterAll`
  teardown FK-cleanup failure (`TradeAccountAllocation_tradingAccountId_fkey`)
  — confirmed present on unmodified `master` via `git stash` earlier this
  session; every one of those files' actual test bodies passes when run
  standalone. A further 3 tests occasionally time out under full-suite
  parallel DB load but pass individually — also pre-existing, not a new
  regression. See "Known technical debt" below (carried forward, not
  fixed this session — out of scope).
- `npm run build` — **clean**, all routes compile including `/edge`
  (Overview/Replay/Comparison/Improvements/Analyst tabs) and `/replay`.

---

## Known technical debt (carried forward, not fixed this session)

Unchanged from the previous checkpoint — see below for the original
Stage 17B-era writeup. Still not fixed, still not blocking:

1. Test teardown FK issue (`afterAll`/`cleanupUsers` vs.
   `TradeAccountAllocation_tradingAccountId_fkey`) — now confirmed across
   14 files as of this session; same root cause as before, still isolated
   to teardown, never test-body assertions.
2. Occasional test-suite DB contention timeouts under full-suite parallel
   load — same as before, not a hard blocker, passes standalone every time
   it's been checked.
3. Dashboard analytics still on the older `getAnalyticsData` path.
4. Strategy restore gap (`restoreStrategyVersionAsNewStrategy` doesn't
   reconstruct Setup Types).
5. Pre-existing migration checksum drift on
   `20260912221500_replay_execution_engine` — still present; the
   `prisma db execute` + `prisma migrate resolve --applied` workaround was
   used again for all 4 of this session's migrations, exactly as
   documented in the previous checkpoint.
6. Forex/XAUUSD provider licensing (Twelve Data) — code complete since
   Stage 17C, still not production-enabled (see the market-data table
   above).

---

## Next milestone (do not begin without explicit instruction)

**Stage 20.1 — Analyst Evidence Coverage, History & Production
Acceptance** (proposed scope, not yet started):
- Expose Stage 19.1's behavioural-occurrence trend series inside the AI
  Evidence Package.
- Build an Analyst generation-history UI (list/compare past reports for a
  session, not just "the latest").
- Perform live Anthropic verification once `ANTHROPIC_API_KEY` is
  available — confirm structured output, citation validity, no
  market-prediction leakage, and sensible missing-data handling against a
  real model call.
- Explicitly still NOT in scope for 20.1 either: conversational Analyst,
  embeddings, model training.

Do not start this, or any other new feature work, until the user
explicitly asks for it and Replay's manual verification (above) is done.

---

# Archived: previous checkpoint (2026-09-13, Stage 17B)

*(Preserved for history — everything below was written at the end of the
prior session and reflects that session's state, not the current one. See
above for the current truth.)*

**Checkpoint date:** 2026-09-13
**Branch:** `feat/r2-media-storage`
**Base commit at checkpoint time:** `c684018` — "feat: Trade Idea Validation Shield through Daily Market Plan (Stages 4-11)"

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

## Correction to this checkpoint's original premise

The checkpoint task that produced this document was written assuming
**"Stage 17B has NOT been implemented yet"** and instructed that nothing
related to it be created. At the time this checkpoint was run, Stage 17B was
**already fully implemented** in the working tree from earlier in the same
session. This was flagged to the user immediately, who confirmed: record it
as done, include it in today's checkpoint commit, and treat tomorrow's task
as **reviewing/verifying** Stage 17B rather than starting it.

## Historical market-data status (as of 2026-09-13)

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
  var (Stage 17C territory — this was completed later in the 2026-09-13
  session as Twelve Data integration; see the market-data readiness table
  in the current checkpoint above for its actual status).

## Known technical debt as of 2026-09-13 (original writeup)

1. **Test teardown FK issue.** `prisma.user.deleteMany()` in several test
   files' `afterAll`/`cleanupUsers` throws on
   `TradeAccountAllocation_tradingAccountId_fkey`. Confirmed then: 14 test
   files affected, **1390 passed / 1 intentionally skipped, 0 actual
   assertion failures** — the failures are 100% in teardown, not in test
   bodies. Pre-existing, not caused by Stage 16/17A/17B. Do not fix
   opportunistically; needs a deliberate look at shared dev-DB fixture
   hygiene across the prop-firm/account test factories.
2. **Test-suite DB contention.** A setup-validation test has occasionally
   hit the 5-second timeout during the full suite run but passes
   independently. Not reproduced as a hard blocker then. Leave alone
   unless it starts failing consistently.
3. **Dashboard analytics.** `/dashboard` remains the known last caller of
   the older `getAnalyticsData` path (predates the canonical analytics
   pipeline). Not part of Stage 17B; not touched.
4. **Strategy restore gap.** `restoreStrategyVersionAsNewStrategy` does not
   yet reconstruct Setup Types. Not part of Stage 17B; not touched.
5. **Pre-existing migration checksum drift.** `20260912221500_replay_execution_engine`
   had already drifted from its applied checksum before the 2026-09-13
   session started. Worked around for the new provenance migration via
   `prisma db execute` + `prisma migrate resolve --applied` instead of
   `prisma migrate dev`, to avoid the reset `migrate dev` wanted to
   perform. This drift is still present as of the current checkpoint above.
6. **Forex/XAUUSD provider (Stage 17C).** Was not started as of this
   original checkpoint; completed later in the same 2026-09-13 session
   (Twelve Data) — see the current checkpoint's market-data table for its
   actual (non-production-enabled) status.

## Verification run at the 2026-09-13 checkpoint

- `npx prisma migrate status` — schema up to date, 69 migrations, none pending
- `npx tsc --noEmit` — **clean**
- `npx eslint .` — **clean** (1 pre-existing unrelated warning: unused var in `prop-firms-analytics.service.test.ts`)
- `npx vitest run` — **1390 passed, 1 skipped** (Databento live smoke test, self-skips without `DATABENTO_API_KEY`); 14 files show a teardown-only failure — see Known Technical Debt #1
- `npx next build` — **clean**, all routes compile including `/replay`, `/replay/[sessionId]`, `/edge`
