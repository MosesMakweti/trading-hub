# Today V3 — Architecture (LIVE)

The one LIVE trading workflow. Phase detail lives in `TODAY_V3_REVIEW.md`
(Review) and `TODAY_V3_CLOSE.md` (missed opportunities, Close, carry-forward);
this page is the map and the invariants.

## Date identity

"Today" is the trader's LOCAL date in their confirmed IANA timezone
(`getTraderTodayKey`; UTC until one is confirmed), from the server clock —
never the server's or the browser's calendar. A timezone change governs from
the next local date, so a TradingDay is never re-dated. See `DISCIPLINE.md`.

## Lifecycles

**Day:** PREPARE → PLAN → TRADE → CLOSE (`components/today-v3/*`, loader
`server/services/trading-workspace.service.ts`). Readiness (the routine)
gates *taking* a trade only; Plan is always open; managing an entered or
carried position is never gated.

**Trade:** IDEA → PLAN → EXECUTION → REVIEW. One derivation for display
state (`domain/trades/trade-lifecycle.ts`) and one for review state
(`domain/trades/review-state.ts`); stored columns are kept in step by
`syncLiveTradeLifecycle` (LIVE only).

## Canonical ownership

| Owner | Holds |
| --- | --- |
| Strategy Lab | assets, sessions, setup types, entry models, confluences, execution confirmations, management / partial-TP rules, risk & max-trade suggestions — *referenced* live, *snapshotted* onto trades |
| TradingDay | routine snapshot + readiness, confirmed daily risk / max trades, day context, reflection (`dayWentWell`, `dayToImprove`, `dayMainLesson`), Focus for Tomorrow (`dayCarryForward`), `analyzedAt`, `ARCHIVED`/`archivedAt` |
| DailyAssetAnalysis | per-asset HTF / session / fundamental reads, Final Bias, evidence, active strategy |
| Trade | idea selections + frozen strategy snapshot, `dailyBiasSnapshot`, motive (`tradeIntent`), `reasonForTrade`, execution facts, limit override (reason + frozen context), review answers, `reviewedAt` (latest explicit completion) |
| TradePlanVersion | append-only plans; the version confirmed at first entry is locked |
| PerformanceRiskSnapshot | frozen initial stop / risk % at first entry; settled R / PnL |
| TradeOpportunity | spotted setups → EXECUTED (via `Trade.opportunityId`) / MISSED / INVALIDATED / EXPIRED; `originTradeId` = provenance from a cancelled idea only |
| Journal / Analytics / Edge Review / AI | readers of the above — no V3 copies |

## System knows / suggests / trader confirms

* **Knows (derived):** realized R, PnL, open %, settled state, plan vs actual,
  frozen initial risk, stop widened, bias alignment (from `dailyBiasSnapshot`),
  FOMO (from motive), limit overridden, final-review completeness, Needs
  Attention, day performance & process summaries, previous session.
* **Suggests (trader confirms):** daily risk / max trades (strictest active
  strategy), direction from Final Bias, evidence candidates, risk & exit
  adherence, behaviour labels, idea defaults (asset, strategy, session).
* **Trader confirms:** Final Bias, daily limits, direction, plan, override
  reasons, motive, the four process answers, Complete review, reflections,
  Focus for Tomorrow, missed-setup reason/outcome, "Record as missed".

Compatibility columns Trade.`higherTimeframeBias` / `biasConfidencePercent`
(neutral 50) and the provisional `executionMinutes` before entry are never
shown as decisions (`domain/trades/display-facts.ts`).

## Metric definitions

| Concept | Definition | Used by |
| --- | --- | --- |
| Idea | a Trade row of the day (any state) | Close |
| Executed | actual entry (canonical `isExecuted`: entry and not cancelled) | Today, Close, Journal, Analytics |
| Trades Used | executed trades whose trade date is the LIVE day | status strip / limits |
| Risk Used | Σ frozen Performance `riskPercent` of those trades | status strip / limits |
| Settled | Performance `settledAt` (LIVE) / price-derived close (backtest) | everywhere |
| Open | executed, not fully exited and not settled | Close, carried list |
| Win / Loss / BE | `settledWinLossClass` on settled trades only | Close, Journal, Analytics |
| R / PnL | settled realized R / Performance PnL (Journal also shows realized-so-far R) | |
| Cancelled | `CANCELLED_NEVER_TRIGGERED`, no entry — never executed, never missed | |
| Missed | MISSED TradeOpportunity (valid subset = `setupValid === true`) — never a Trade | Close, discrepancy |

Carried positions count on their own entry day only. Analytics answers
period questions over the same `isExecuted` / settled definitions; the
status strip is a per-day control. Edge Review reads Analytics' canonical
dataset and the opportunity engine.

**One decision, one count:** a cancelled idea recorded as missed is a
cancelled Trade (no executed/R/risk effect) plus one MISSED opportunity (the
only discrepancy input). The opportunity engine never reads `originTradeId`.

## LIVE vs Backtesting

TradingDay, Trade, TradeOpportunity and DailyNote are workspace-scoped root
models (`server/workspace/prisma-scope.ts`); DB triggers keep links within one
environment. V3 is mounted only by `/today`; Backtesting/Replay keep the V2
`TodayWorkspace`. LIVE-only services (`syncLiveTradeLifecycle`,
`closeTradingDayV3`) refuse or no-op in a backtest scope.

## Extension / API

`POST /api/v1/trades` uses the canonical `createTrade`; archived days are
rejected (422, nothing written; the idempotency key is released so the same
retry works after reopening). No readiness gate on the API — Today flags
trades logged before readiness.

## Invariants

* Initial stop and original risk are frozen at first entry; stop moves never
  change them. Partial exits feed realized R; snapshots never recompute from
  later balance changes.
* A locked plan version is never rewritten; later edits append versions.
* `reviewedAt` = latest explicit review completion; final completeness only
  via `deriveReviewState` (an interim review never satisfies it).
* Closing a day archives the TradingDay only: trades stay open, reviews stay
  outstanding, nothing is fabricated. Reopen keeps all data.
* Execution model (quantity ledger, Phase 2): chosen once at first entry.
  `QUANTITY_LEDGER` (Today V3 + `QUANTITY_LEDGER=on` only) sizes in the entry
  transaction and is rejected — never downgraded — when it can't be sized;
  its exits are append-only PositionFill rows and it settles into the same
  canonical columns. See `EXECUTION_ENGINE.md`.
* "From your last session" is read by reference from the latest earlier
  TradingDay in scope with reflection text — never `date − 1`.

## Rollout

`TODAY_V3=off` (env) mounts the V2 workspace on `/today` — the LIVE rollback
path. Keep it through the production soak; then remove the branch (the V2
components stay for Backtesting/Replay).
