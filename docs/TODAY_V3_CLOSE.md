# Today V3 — Phase 4: Missed Opportunities, Close Day & Tomorrow's Focus

LIVE Today now ends in **one Close surface**:
TODAY'S PERFORMANCE · PROCESS · NEEDS ATTENTION · (open positions / missed /
cancelled / overrides) · REFLECTION · TOMORROW · CLOSE TRADING DAY.
It replaces LIVE Today's Day Summary, "Mark day reviewed" and the Close
Trading Day dialog. Backtesting/Replay (and `TODAY_V3=off`) keep the V2
components unchanged.

## Where things live

| Concern | Code |
| --- | --- |
| Pure derivations (performance, process, needs attention, reflection presence) | `src/domain/today/close-day.ts` |
| Close read model, V3 close action, previous-session query | `src/server/services/close-day-v3.service.ts` |
| Centralized review facts for many trades | `getTradeReviewFacts` in `src/server/services/trade-review-v3.service.ts` |
| Shared lifecycle reconcile before archiving | `reconcileDayTradesForClose` in `src/server/services/close-day.service.ts` |
| Missed setup / cancelled → missed | `recordMissedSetup`, `recordCancelledIdeaAsMissed` in `src/server/services/opportunity.service.ts` |
| Actions | `closeTradingDayV3Action` (`close-day.actions.ts`), `recordMissedSetup` / `recordCancelledIdeaAsMissed` (`opportunity.actions.ts`) |
| UI | `src/components/today-v3/close-phase.tsx`, `trade/missed-setup-form.tsx`, Review stage `RecordAsMissed` |

## Missed opportunities

* **+ Setup missed** (Trade phase) records a canonical `TradeOpportunity`
  with `status = MISSED` in one insert: strategy (required by the existing
  domain, which scores validity against it; defaults to the asset's active
  strategy), asset, direction (defaults to the asset's Final Bias), optional
  confluences (scored by the same `scoreSetup`), why it was missed
  (`missReason`), what it would have done (`missedOutcome` + trader-entered
  `missedRealizedR`), note. No screenshot: `MediaOwnerType` has no
  opportunity owner and adding one is a schema change (deferred).
* It is never a `Trade`: it can't count as executed, Trades Used or
  Performance risk. Discrepancy / Edge Capture / miss-reason analytics read it
  exactly as before (`getOpportunityInputs`, `getMissReasonAggregate`).
* **Take** (Phase 2) is unchanged: a PENDING opportunity → Quick Idea →
  one canonical Trade linked through `Trade.opportunityId` (status EXECUTED).

## Cancelled idea → missed opportunity

Cancelling an idea never creates an opportunity. On a cancelled idea's
Review stage the trader may choose **Record as missed opportunity**, which
creates a separate MISSED opportunity copied from the idea's **frozen**
evidence (strategy snapshot, selections, setup score/validity, planned
prices; `expectedExpectancyR` from the strategy's current trade-management
expectancy, the same source spotting uses) and links it through the new
`TradeOpportunity.originTradeId` (`@unique`, SetNull, same-environment DB
trigger). The Trade stays `CANCELLED_NEVER_TRIGGERED` with
`opportunityId = null` — `opportunityId` keeps meaning "the executed trade".
Deleting the opportunity clears `originTradeId` so the idea can be recorded
again.

Migration: `20261005120000_today_v3_missed_from_cancelled` (additive,
nullable, no backfill).

## Close — definitions

Today's figures cover trades whose **trade date** is today (as Journal and
Analytics attribute them). Carried positions appear in Needs Attention and
Open Positions, never in today's counts.

| Figure | Definition |
| --- | --- |
| Ideas | Every Trade row of the day (incl. cancelled) |
| Executed | Actual entry (`computeDayUsage` — the status strip's Trades Used) |
| Settled | Executed and `settlementInputs(...).settled` (LIVE: Performance `settledAt`) |
| Wins / Losses / BE | `settledWinLossClass` on settled trades only |
| Win rate | wins ÷ settled × 100 (Analytics definition); — with nothing settled |
| Settled R / PnL | Sum of settled trades' frozen `realizedR` / `performancePnl` |
| Open | Executed, not fully closed (exits < 100% and not settled) |
| Pending settlement | Fully exited but not settled |
| Cancelled | `CANCELLED_NEVER_TRIGGERED` with no entry |
| Missed | MISSED opportunities spotted today (valid = `setupValid === true`) |
| Risk used | Sum of frozen Performance `riskPercent` of executed trades (`computeDayUsage`) |

**Process** is taken over today's executed trades: the four adherence
answers (yes / no / unanswered), motives (`tradeIntent`), average
psychology %, setup score, execution %, trade quality %, "would not take
again", and counts of daily-limit and setup-validation overrides. The
trader is never asked for a day-level score.

**Needs Attention** rules (today's trades + carried trades):

| Item | Rule |
| --- | --- |
| Final review required | Centralized review state = `FINAL_REVIEW_REQUIRED` (interim noted) |
| Open position | Entered, not cancelled, not closed |
| Missing execution facts | Entered, Performance snapshot exists, no initial stop, not settled |
| Performance pending | Entered, fully exited, not settled (and not already "missing facts") |
| Contradictory execution state | Entered but stored CANCELLED, or stored FULLY_CLOSED while facts say open |
| Process exception | Setup override, daily-limit override, or any adherence answer = No |

## Reflection — field mapping (no new columns)

| Close UI | Column |
| --- | --- |
| What went well today? | `TradingDay.dayWentWell` |
| What needs improvement? | `TradingDay.dayToImprove` |
| Main lesson | `TradingDay.dayMainLesson` |
| What should I focus on next trading session? | `TradingDay.dayCarryForward` |

V2's Day Summary and Close dialog wrote the same four columns, so there are
no historical-only duplicates to expose. Reflection presence =
any of the four has text (never trade-level free text).

## Close Trading Day (V3)

`closeTradingDayV3`: refuses an already-archived day and Backtesting; runs
`reconcileDayTradesForClose`; then **one** `TradingDay` update writes the
edited reflection fields, `analyzedAt` (only if null), `status = ARCHIVED`
and `archivedAt` (the same columns `endDay` writes). It never writes trade
execution/review/Performance data. Outstanding final reviews and open
positions show a confirmation (“Close day anyway”), never a block.

**Fix (shared close path):** `reconcileDayTradesForClose` syncs LIVE entered
trades with `syncLiveTradeLifecycle`; the V2 `reconcileTradeLifecycle` it
used to call marked `status = REVIEWED` whenever `closedAt` and `reviewedAt`
both existed, so closing a day turned an interim review into "reviewed" and
dropped the trade from the carried final-review list. Backtesting, cancelled
ideas and legacy `actualRR`-only results keep the V2 reconcile.

**`getDayCloseSummary` (Journal, V2 dialog)** — LIVE now reports
`finalReviewRequiredCount` from the centralized review state and warns
"N trades still require a final review" instead of "no reflection notes".
Backtesting keeps the V2 warning and returns `null`.

### `analyzedAt` after V3

Meaning: "the day's end-of-day review was done" — set by the V3 close (or,
for V2/backtests, "Mark day reviewed"). Consumers: Journal workflow recap
(`analyzeDone` → Day Summary step), V2 workflow stepper. Analytics, Edge
Review, AI evidence and Backtesting analytics do not read it. Existing
stamps are never rewritten; reopening keeps it.

## Reopen

Unchanged `reopenDay`: `status = ACTIVE`, `archivedAt = null`; trades,
reviews, reflection, lesson, improvement, focus and `analyzedAt` are kept.
Re-closing keeps the original `analyzedAt`.

## FROM YOUR LAST SESSION

`getLastSessionCarryForward(userId, dateKey)` (used by the Today loader):
the most recent `TradingDay` strictly before `dateKey`, in the current
workspace scope, with Focus / Main lesson / Needs improvement text. Read by
reference (never copied), so edits after reopening show up immediately.
Friday → Monday works (no weekend rows; an empty opened row is skipped).
Under LIVE scope Backtesting/Replay days are invisible (TradingDay is a
scoped root model). FROM EDGE REVIEW stays a separate panel; a daily focus
is never turned into a commitment.
