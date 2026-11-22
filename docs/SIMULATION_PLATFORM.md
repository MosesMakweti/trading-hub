# Simulation Platform — Architecture Assessment & Plan

**Status:** Phase 1 (assessment) complete; Phase 2 in progress.
**Scope:** Turning Backtesting into an independent trading simulation
environment with two products, **Strategy Lab** and **Prop Firm Simulator**,
on a shared replay, chart and execution infrastructure.

This document was written from the code at `b83c487` and verified against
it, not only against the older docs. Where the two disagree, the code wins
and that is called out.

---

## 1. Current architecture map

```
                         ┌─────────────────────────── Backtesting V1 (today) ───────────────────────────┐
 /backtesting            │ BacktestRun ──owns──▶ TradingDay / Trade / TradeOpportunity / DailyNote        │
 /backtesting/[run]/…    │      (Today V2/V3 tables, tagged by backtestRunId, isolated by ALS scope +    │
                         │       Prisma extension + DB triggers)                                         │
                         │ Session  = Today workspace (loadTradingWorkspace + TodayWorkspace)            │
                         │ Journal  = live Journal components (loadJournalDay, TradeWorkspace)           │
                         │ Analytics= canonical analytics engine, PRICE_DERIVED settlement (R only)      │
                         └───────────────────────────────────────────────────────────────────────────────┘
                         ┌─────────────────────────── Native Replay (shared, keep) ──────────────────────┐
 /backtesting/data       │ HistoricalDataset + HistoricalBar (MT5 M1, broker clock, integer prices)      │
 /backtesting/[run]/     │ BacktestRunDataset (pins, frozen on first replay)                             │
   replay?date=          │ BacktestReplayPosition (run × date world clock, server-authoritative)        │
                         │ candle-engine (16 timeframes, progressive candles, cutoff-only reads)         │
                         │ lightweight-charts 5 chart, drawings (ReplayChartDrawing), position tools     │
                         └───────────────────────────────────────────────────────────────────────────────┘
 Live-only domains that backtesting must never write to:
   TradingAccount (PROP_FIRM / PERSONAL_BROKERAGE / PERFORMANCE), PerformanceRiskSnapshot, PositionFill,
   TradeAccountAllocation/Execution, PropFirmAccount + AccountStage + StageRule + Payout + AccountLedgerEntry
   (the live prop-firm TRACKER for real funded accounts), ReplayReviewSession/ReplayTrade (Edge Review).
```

**Today dependency today.** Every Backtesting screen except Overview and the
data page renders live Today or Journal components:
`session/page.tsx` and `(replay)/…/replay/page.tsx` → `loadTradingWorkspace` +
`TodayWorkspace`; `journal/[date]` → `loadJournalDay` + Journal day components;
`journal/[date]/trades/[id]` → `TradeWorkspace`; the replay chart's
"Convert to Trade Idea" opens Today's `AddTradeDialog`. Simulated trades are
`Trade` rows; their results are R only (no quantity, no money).

There is no separate "demo account" type in the schema. The closest thing is
the **Performance Account** (`TradingAccount.kind = PERFORMANCE`), a virtual
$100k benchmark that live trades settle into. It is live-only and stays
untouched.

---

## 2. Reuse inventory

| Area | Verdict | Notes |
|---|---|---|
| HistoricalDataset / HistoricalBar, upload → R2 → import, validation | **Keep as is** | User-owned, run-independent; serves both products. |
| Candle engine, timeframes, wall-clock, chart-time, chart-model | **Keep as is** | Pure, tested, cutoff-only. |
| `getHistoricalCandles` (server-only, cutoff required) | **Keep as is** | All new candle reads go through a clock-resolved cutoff. |
| lightweight-charts chart, drawing controller/renderer/geometry, position tools | **Reuse, re-own** | Drawings get a simulation owner (account or study) instead of only a run. |
| Replay clock (`BacktestReplayPosition`) | **Generalise** | Keep the rules (server-authoritative, forward-only, locked, idempotent commands, union timeline). New owner: one **continuous** clock per simulation account / study session spanning days, so positions can be held overnight and the cross-day lookahead disappears by construction. Legacy per-date clock stays for legacy runs. |
| `domain/execution` (decimal precision, spec resolution, sizing, partial close, fill reducer, ledger replay) | **Reuse directly** | The quantity/money core of simulated execution. Live services that wrap it (`performance-account`, `ledger-settlement`) are NOT reused — they write live tables. |
| `domain/replay-execution` (Edge Review) | **Port ideas, don't import** | NATIVE_REPLAY.md forbids depending on Edge Review. Its OHLC-ambiguity policy and "management stamped with replay time" rule are re-implemented for the new engine. |
| `domain/prop-firms` pure helpers (`payout-math`, `rule-templates`, `risk`, `stage-templates`) | **Reuse selectively** | `computePayoutSplit` is reused. `session-boundary` uses fixed UTC offsets and real instants; the simulator works on the broker clock instead (see §6). `rule-health` is a health indicator for manually tracked accounts, not a deterministic per-minute breach engine. |
| Live prop-firm tables (`PropFirmAccount`, `AccountStage`, `StageRule`, `Payout`, `AccountLedgerEntry`) | **Do not reuse for storage** | They track REAL accounts. Reusing them would put simulated money next to real money. The simulator gets its own tables with the same shape ideas (stages → phases, ledger with `balanceAfter` and source idempotency). |
| Strategy model (Strategy Lab methodology workspace, `/strategy-lab`) | **Reuse as the strategy definition** | A backtest links a `Strategy` and freezes its snapshot, as runs already do. No second strategy-definition model. |
| Canonical analytics (`computeRGroupStats`, `buildFinalizedRCurve`, metrics) | **Reuse the pure math** | Fed from simulation rows mapped to the same row shape. |
| Isolation layers (scope, Prisma extension, triggers) | **Keep, extend** | New simulation tables are not Today tables and carry `userId` + owner FKs; isolation is by ownership checks + DB triggers (owner must match), not by the backtest scope. Simulation services never import live account services. |
| Today/Journal components inside Backtesting | **Replace** | New products get their own session, journal (setup observations) and analytics. Legacy runs keep their current screens read-only. |

---

## 3. What must be built from scratch

1. **Simulation account domain**: account, phase/challenge grouping, frozen rule
   snapshot, lifecycle state machine.
2. **Simulated execution engine**: market and pending orders (limit, stop),
   SL/TP, partial closes, modification, spread and commission, swaps,
   intrabar SL/TP resolution, positions and fills.
3. **Append-only financial ledger** per simulation account, reproducible balance,
   idempotency keys.
4. **Continuous replay clock** across days with per-minute position processing.
5. **Rule engine**: static / EOD-trailing / intraday-trailing drawdown, daily
   loss (balance or equity, day-start basis), profit target, min/max trading
   days, consistency, lot and position limits, weekend/overnight holding.
6. **Phase transitions, funded accounts, payouts, breaches** with reports.
7. **Strategy Lab**: studies, setups (variations), observations, tags, library
   and analytics with sample-size flags.
8. **Terminal UI**: execution panel, positions/orders/history dock, account
   strip; Backtesting home with its own navigation.

---

## 4. Proposed data model (Phase 2 onward)

All new tables are prefixed `Sim` so nothing collides with live names, and
every row carries `userId`.

```
SimFirmModel            user-owned (or built-in template) firm/model definition, current version pointer
SimFirmModelVersion     immutable rules JSON (validated, typed), version number
SimChallenge            one simulated purchase: firm model version snapshot, size, fee, status, phase index
SimAccount              one tradable account: STRATEGY_LAB | EVALUATION | FUNDED; frozen rule snapshot;
                        status; currency; period; assets; strategy link; continuous clock (currentMinute)
SimDatasetPin           account × asset → HistoricalDataset (frozen once the clock starts)
SimOrder                pending/market orders (side, type, price, SL, TP, quantity, status, timestamps)
SimPosition             open/closed positions with frozen spec snapshot, intended risk, SL/TP
SimFill                 append-only fills (OPEN/CLOSE), price, quantity, gross PnL, commission, replay minute
SimLedgerEntry          append-only money ledger: type, signed amount, balanceAfter, idempotency key
SimEvent                lifecycle timeline (created, day reset, phase passed, breach, payout, …)
SimBreach               breach report: rule, minute, balance, equity, offending position, contributors
SimPayout               payout cycle result: eligible profit, split, trader/firm share, ledger refs
SimStudy / SimSetup / SimObservation / SimTag   Strategy Lab knowledge base
```

**Money rules.**
- Balance = Σ ledger entries. `balanceAfter` is written in the same
  transaction as an assertion and verified on read.
- Every ledger write carries a unique `(accountId, idempotencyKey)`, so a
  retried settlement or a double-click can't book twice.
- Phase creation is unique per `(challengeId, phaseIndex)`.
- UPDATE/DELETE on ledger and fill rows is refused by DB triggers (cascade
  from the account still works).

---

## 5. Service architecture

```
src/domain/simulation/        pure, deterministic, unit-tested
  rules.ts            rule-snapshot schema (Zod) + defaults
  ledger.ts           balance replay, idempotent append planning
  execution.ts        order → fill decisions on M1 bars (spread, SL/TP, ambiguity)
  account-state.ts    equity, floating PnL, day-start balance, high-water marks
  rule-engine.ts      breach / pass evaluation per minute
  payout.ts           eligibility + split + buffer reconciliation
  study-stats.ts      setup/observation analytics with sample-size flags
src/server/services/simulation/
  account.service.ts      create, ownership, lifecycle transitions (transactions)
  clock.service.ts        continuous clock; advancing processes every minute in range
  execution.service.ts    place/modify/cancel/close; writes fills + ledger atomically
  prop-firm.service.ts    firm models, purchase, phase progression, payouts
  study.service.ts        studies, setups, observations
src/actions/simulation*.actions.ts   Zod-validated entry points
src/app/(app)/backtesting/…          home, lab, prop, accounts
src/app/(replay)/backtesting/…       terminal workspace
```

The browser never sends prices, balances, PnL or cutoffs. It sends
intentions (buy 0.5 lots EURUSD with SL x / TP y; advance 5 minutes) and the
server derives everything from bars at the account's clock.

---

## 6. Product and engineering decisions

| # | Decision | Default taken | Why / implications |
|---|---|---|---|
| D1 | Name collision: `/strategy-lab` is already the live methodology workspace. | The backtesting product is **Strategy Lab** inside Backtesting (`/backtesting/lab`). The existing nav item stays and is the source of strategy definitions. | Two places called Strategy Lab can confuse. The alternative is renaming one (for example the existing one to "Strategies"). Easy to change later: it is a label and a route. |
| D2 | Legacy V1 runs (Today-based trades, R only, no quantities). | Kept **read-only** under "Legacy backtests" with their current Journal/Analytics. Not converted. | Converting would invent quantities and money that were never recorded. Datasets are shared, so no market data is lost. |
| D3 | Firm daily reset vs data clock. MT5 data has broker-server time and no UTC offset. | Daily resets are defined on the **broker server clock** (default 00:00 server time, which is 17:00 New York for the common UTC+2/+3 broker convention), with a configurable hour. | Converting a "5pm New York" rule needs the dataset's UTC offset, which is usually unknown. Guessing it would silently move every daily-loss boundary. |
| D4 | Built-in firm templates. | Generic, clearly labelled archetypes ("Classic two-step", "One-step", "Futures EOD trailing", "Instant funding"). Traders build named custom models. | Shipping real firm names with rules that drift from the firm's current terms would mislead. |
| D5 | Same M1 bar touches both SL and TP. | **Conservative:** stop fills first, and the fill is flagged `AMBIGUOUS`. | The continuous clock can't pause for a manual call the way Edge Review does. Never assumes the profitable outcome. |
| D6 | Equity checks within a minute. | Equity-based rules use the bar's **adverse extreme** (low for longs, high for shorts) plus spread. | Firms check equity tick by tick; the bar extreme is the closest honest proxy from M1 data. |
| D7 | Bid/ask. MT5 bars are bid prices. | Buys fill at bid + spread (bar spread in points, or the account's configured spread when the bar has none); sells at bid. Longs close at bid, shorts at ask. | Matches MT5 semantics. |
| D8 | Cross-currency instruments (e.g. USDJPY on a USD account). | Conversion uses the replay price at the fill minute (JPY→USD = 1/USDJPY). A cross like EURGBP needs a GBPUSD dataset pinned, otherwise the order is refused. | No external FX lookups, no 1:1 fallback, no lookahead. |
| D9 | News-trading restriction. | Stored in the rule snapshot but **not enforced** (no economic calendar data). Shown as "not enforced". | Honest rather than fake enforcement. |
| D10 | Swaps. | Configurable per-lot daily swap (long/short) on the account rules, default 0, booked at the daily rollover. | MT5 bar exports contain no swap data. |

---

## 7. Migration and backward compatibility

- All schema changes are **additive**: new `Sim*` tables and enums; no change
  to live tables. `ReplayChartDrawing` gains nullable owner columns later
  (Phase 3) with a CHECK that exactly one owner is set; existing rows keep
  `backtestRunId`.
- `BacktestRun`, its Today-table rows, pins, positions and drawings are left
  intact and readable. Creating new V1 runs is retired once Strategy Lab
  ships (the create button moves to the new flow); existing runs remain.
- Historical datasets are shared by legacy runs and new accounts.
- Rollback: new tables can be dropped without touching live or legacy data.

---

## 8. Roadmap

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 1 | This assessment | Reviewed against code |
| 2 | Simulation foundation: schema, ledger, execution engine, continuous clock, rule snapshot schema, account service, isolation triggers | Pure engines unit-tested with known numbers; DB integration tests for isolation, idempotency, concurrency |
| 3 | Terminal workspace: chart + replay + order ticket + positions/orders/history dock, wired to Phase 2 | Place/modify/close round-trip through the UI on a seeded dataset |
| 4 | Strategy Lab: studies, setups, observations, library, strategy backtests, analytics | Observation saved in ≤ 2 clicks from the chart; stats with sample flags |
| 5 | Prop Firm Simulator: firm models, purchase, rule engine, phases, funded, payouts, breaches, analytics | Deterministic tests for every drawdown model and the payout example |
| 6 | Integration, regression, docs | Full journeys pass; live/legacy regression suites pass |

## 9. Risks

| Risk | Mitigation |
|---|---|
| Per-minute processing cost on large clock steps with open positions | Fetch the step's bars once per asset; process in memory; cap steps (1,440 min). |
| Financial drift between ledger and displayed balance | Balance is derived from the ledger only; `balanceAfter` is an assertion checked on replay. |
| Lookahead through new read paths | Every candle read resolves the owning clock's cutoff server-side; no endpoint accepts a cutoff. |
| Concurrency (double submit, two tabs) | Account row lock (`FOR UPDATE`) around every clock move and execution; idempotency keys on ledger and commands. |
| Scope of the full vision | Phased delivery; each phase leaves the app working and is merged separately. |
