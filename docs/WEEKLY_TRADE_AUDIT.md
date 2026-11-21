# Edge Review → Weekly Trade Audit

Edge Review used to be a replay workflow: you replayed the week candle by candle,
placed simulated trades, then compared them with what you actually did. This
redesign replaces it with a **Weekly Trade Audit**. You open a finished trading
week, your real trades are already there grouped by day, and for each day you
record what *should* have happened, side by side with what *did* happen.

This document is the Phase 1 findings and Phase 2 architecture for that change.

---

## 1. What already exists (Phase 1 findings)

| Concern | Existing implementation | Reused? |
|---|---|---|
| Actual trades | `Trade` (one row per idea/execution). `tradeDate` is a date-only column already in the trader's calendar, `executionMinutes` is the time of day, plus planned/actual entry, stop, target, exit, `strategyId`, `assetSymbol`, `selectedSession`, `executionNotes`, `validationState`, `overrideReason`, `limitOverrideReason`, `tradeIntent`. Soft-deleted (`deletedAt`). | Yes, read only. Trades are never copied into a second ledger. |
| R and P&L | `getCanonicalAnalyticsDataset` builds the canonical row (`realizedR`, `pnl`, `winLossClass`, `isExecuted`) that Analytics and the Journal already agree on. | Yes. The audit uses the same win/loss rule as Analytics. |
| Position size and risk | `TradeAccountAllocation.riskInputType/riskValue` (percent or amount); prop-firm executions carry `actualLotSize/actualContractQty`. | Shown when present, never invented. |
| Screenshots | Universal media: `MediaAsset` + polymorphic `MediaAttachment(ownerType, ownerId, category)`; `/api/media/upload` (ownership, MIME and size checks, R2 storage); `<ImageAttachments>`; zoom lightbox. Trade images live on `ownerType = TRADE`; missed setups on `OPPORTUNITY`. | Yes. The audit adds owner types instead of a new image table. |
| Uploads on closed days | The upload route rejects new images on a TRADE / OPPORTUNITY whose day is archived. | A weekend review is *always* after the day is archived, so review uploads must not attach to the Trade itself, which also keeps provenance honest (see §5). |
| Missed setups recorded live | `TradeOpportunity` with `status = MISSED`, `missReason`, plan prices, screenshots. | Shown read-only in the Expected column as "recorded during the session". Retrospective misses get their own table (see §3). |
| Trading calendar | `PreparationScheduleVersion.weekdays` + `PreparationDayException` (DAY_OFF / EXTRA_DAY) via `dayApplicability`; trader timezone via `getTraderTodayKey`. Weeks are Monday-start (`weekStartKey`). | Yes. The days shown are the trader's scheduled days, not a hard-coded Mon–Fri. |
| Strategy / asset filters | `getAnalyticsFilterOptions`. | Yes. |
| Old review session | `ReplayReviewSession` (+ `ReplayTrade`, links, annotations, AI analyst reports). Replay-bound end to end. | Data kept; removed from the primary UX. |
| Old reflection | `WeeklyReview(userId, weekStart, reviewType)`. Not scoped by strategy/asset (audit finding #8). | Shown read-only on the matching audit week as an "earlier reflection"; never overwritten. |
| Commitments | `EdgeReviewCommitment` (+ daily states) surfaced on Today, Trade Idea reminders, Analytics → Improvement. Requires a review to hang off. | Kept as **optional** follow-through from a weekly audit; lifecycle bugs from the audit fixed. |

---

## 2. User workflow

1. Open **Edge Review**. Default week = the most recent *completed* trading
   week (the current week once its last scheduled trading day has passed,
   otherwise last week). Prev/next arrows and a date picker move between weeks.
2. Optional strategy and asset filters narrow the audit's scope. Each scope is
   its own audit, so filtering never overwrites another scope's work.
3. Every scheduled trading day of the week appears in one page. Each day is a
   collapsible section with a day strip at the top for jumping between days.
4. Inside a day, every decision is one row with two cells:

   | ACTUAL (left) | EXPECTED / IDEAL (right) |
   |---|---|
   | A trade you took: facts and its original screenshots | Your verdict: should it have been taken? What went wrong, the underlying weakness, the improvement, review screenshots |
   | "Not taken" | A trade you *should* have taken: plan, why it was valid against your strategy, why you missed it, screenshots |

   On a day without trades, the left cell asks why (no valid setup / missed /
   deliberately stayed out / not trading).
5. Below the rows: the daily reflection (went well, went wrong, could do better,
   main lesson) and day screenshots, then **Mark day reviewed**.
6. At the bottom: the **Weekly assessment**. A deterministic summary built from
   everything recorded (decision-quality matrix, rule violations, missed valid
   setups, repeated mistakes and weaknesses) plus editable fields and 1–5 ratings.
   **Finalize week** freezes it.
7. Optionally, turn the week's main priority into a commitment that Today
   will surface.

Everything autosaves; you can leave and return at any point.

---

## 3. Data model (additive migration)

```
WeeklyTradeAudit            one per user × week × scope
  userId, weekStart, weekEnd, strategyId?, assetSymbols[], scopeKey
  status IN_PROGRESS | FINALIZED, finalizedAt, reopenedAt
  assessment text: executionSummary, decisionSummary, strongestArea,
                   biggestWeakness, recurringPatterns, mainLesson, nextWeekPriority
  ratings 1–5:     executionQuality, tradeSelection, patience,
                   strategyAdherence, riskManagement, tradeManagement
  summarySnapshot  JSON (deterministic summary frozen at finalize)
  @@unique(userId, weekStart, scopeKey)

DailyTradeAudit             one per audit × date
  status IN_PROGRESS | COMPLETED (no row = not started), completedAt
  noTradeReason NO_VALID_SETUP | MISSED_OPPORTUNITY | STAYED_OUT | NOT_TRADING
  wentWell, wentWrong, couldDoBetter, mainLesson
  @@unique(auditId, dateKey)

TradeAuditAssessment        your judgment of one real trade, per audit
  tradeId → Trade (SetNull), dateKey
  verdict VALID | INVALID | UNSURE
  invalidReasons[]   NO_VALID_SETUP, EARLY_ENTRY, OUTSIDE_CONDITIONS, REVENGE,
                     OVERTRADING, RISK_VIOLATION, OTHER
  executionIssues[]  ENTRY_TIMING, NO_CONFIRMATION, STOP_PLACEMENT, TRADE_MANAGEMENT,
                     EXIT_DECISION, PREMATURE_EXIT, INTERFERENCE, OTHER
  executionQuality 1–5
  mistake, weaknesses[] + underlyingWeakness, improvement   (three separate fields)
  tradeFingerprint, tradeSnapshot (JSON), assessedAt
  @@unique(auditId, tradeId)

AuditExpectedTrade          a trade you should have taken (retrospective)
  dateKey, assetSymbol, direction, intendedEntry, stopLoss, target,
  intendedRiskPercent, strategyId?, setupName, validityReason (required),
  criteriaMet[], missReason (existing MissReason enum), weaknesses[],
  underlyingWeakness, improvement, clientKey
  @@unique(auditId, clientKey)            ← double-submit cannot duplicate

TradeAuditAnnotation        markers drawn on a screenshot during review
  auditId, mediaAttachmentId, markers JSON [{kind, x, y, note}]
  @@unique(auditId, mediaAttachmentId)
```

`MediaOwnerType` gains `TRADE_AUDIT_ASSESSMENT`, `TRADE_AUDIT_EXPECTED` and
`TRADE_AUDIT_DAY`. `EdgeReviewCommitment` gains a nullable `weeklyTradeAuditId`
and an `effectiveFrom` date (see §6).

**Why new tables rather than extending `ReplayReviewSession`:** that model's
status, baseline and locks all mean "replay progress". Reusing it would leave
every field half-meaningful. `WeeklyReview` cannot be extended either: its unique
key has no scope, which is the overwrite bug.

**Why not write retrospective misses into `TradeOpportunity`:** a
`TradeOpportunity` is a live record that feeds the missed-opportunity R cost in
Analytics. Writing weekend hindsight into it would change historical analytics
and blur "seen at the time" with "seen afterwards". Live MISSED opportunities are
still shown in the Expected column with their own label.

---

## 4. Services, actions and validation

* `src/domain/trade-audit/*`: pure, unit-tested functions for the week's day
  list, default week, grouping trades by day, the trade fingerprint, change
  detection and the weekly summary.
* `src/server/services/trade-audit.service.ts`: load the workspace, upsert the
  audit/day/assessment, create/update/delete expected trades, annotations,
  finalize/reopen. Every query is filtered by `userId`, ownership is resolved
  server-side from ids, and every write checks the audit is not finalized.
* `src/actions/trade-audit.actions.ts`: server actions (`requireUser` + zod).
* `src/lib/validation/trade-audit.ts`: zod schemas. Enums are closed lists;
  free text is length-capped; dates must be valid and inside the audit's week.

---

## 5. Screenshots and provenance

Every image in the workspace carries one of four provenance labels:

| Label | Source |
|---|---|
| **Captured during session** | Attached to the Trade / Opportunity on or before its trading day. |
| **Added after session** | Attached to the Trade / Opportunity record, but after its day. |
| **Uploaded in review** | Attached to an audit owner (`TRADE_AUDIT_*`). |
| **Annotated in review** | Any of the above with review markers. The markers are a separate overlay; the original image is never modified, and the label always says the markers are retrospective. |

Review uploads go through the existing `/api/media/upload` route (new owner types
plus ownership checks). They are blocked once the audit is finalized, and so is
deleting them.

---

## 6. Historical integrity

| Rule | How it is enforced |
|---|---|
| Only the selected period | Trades are queried by `tradeDate ∈ [weekStart, weekEnd]` and by scope. Expected trades and day audits must have a `dateKey` inside the week (validated server-side). |
| Correct day | Grouping uses `Trade.tradeDate`, which is already the trader-calendar date. There is no timezone arithmetic on it. |
| Weekly vs monthly kept separate | The audit is weekly-only. Commitment evidence sync is restricted to commitments of the same review type. |
| Scopes don't overwrite each other | `scopeKey` is part of the unique key for the audit and everything hangs off the audit. |
| Finalized reviews don't change | All writes reject a FINALIZED audit. At finalize, each trade's display facts are frozen into `tradeSnapshot`, and the week's summary into `summarySnapshot`. A finalized audit renders from snapshots. |
| Underlying trade edited later | **Policy: flag, never rewrite.** Each assessment stores a fingerprint of the trade's decision-relevant facts. If the live trade differs (edited, moved to another day, deleted, or a new trade appears in the week), the day shows a "changed since review" notice listing exactly what changed. While in progress, re-saving the assessment acknowledges the change. Once finalized, the frozen snapshot stays authoritative and the trader may explicitly **Reopen** the week. |
| Idempotent | There is no import step: actual trades are read live. Audit, day and assessment rows are upserts on unique keys; expected trades use a client idempotency key. |
| Safe saving | Field-level autosave (debounced and on blur) with visible status. Each write is a single upsert. |
| Commitment self-penalty (audit #1) | New `effectiveFrom` = the day after the creating review's period ends. Automatic evidence is only recorded on or after it. Existing rows are backfilled from their session's end date. |
| ACK hides breaches (audit #2) | A SYSTEM verdict now replaces a manual ACKNOWLEDGED row (the note is kept); manual FOLLOWED/BREACHED still win. |
| Two active heads (audit #4) | Continue/refine retires the predecessor with a status-guarded update inside the transaction; reactivating a superseded commitment is rejected. |
| Cross-type evidence (audit #7) | Sync only touches commitments of the finalizing review's type. |
| Carry-forward goes backwards (audit #5) | Only commitments from a finalized review *before* the week are offered, and a commitment can only be continued into a period that reaches past its own. |

---

## 7. What happens to Replay

* `/edge` renders only the Weekly Trade Audit. The Replay / Comparison /
  Improvements / Analyst tabs are gone from the UI. `/replay` and
  `/replay/[id]` redirect to the matching audit week.
* **No data is deleted.** `ReplayReviewSession`, `ReplayTrade`, comparison links,
  AI analyst reports, `WeeklyReview` and commitments keep their tables and rows,
  and every migration stays.
* Old reflections for the same week appear read-only inside the audit. Old
  commitments keep working on Today and in Analytics.
* The replay services (and native-replay / market-data code still used by
  Backtesting) stay in place. They are no longer reachable from Edge Review.
  Removing them entirely is a follow-up once you've confirmed nothing else
  should keep them.
* The AI Review Analyst depends on a finalized replay session's evidence
  package. It is not wired to audits in this change; adapting it to audit data
  is a natural next step.

---

## 8. Scope notes and follow-ups

* Monthly roll-ups of weekly audits are not built yet. The audit is weekly by
  design, and monthly stays a separate concept.
* Annotations are point markers (entry, stop, target, structure, confirmation)
  with notes, not freehand drawing.
* The weekly summary is deterministic (counts and patterns from your own
  entries). No AI text is generated and nothing is inferred from price moves
  after the fact.

---

## 9. Gallery View — visual comparison mode

Edge Review has two views of the **same** audit: **Audit View** (the detailed
daily review above) and **Gallery View**, a large, image-first, side-by-side
ACTUAL ↔ EXPECTED comparison.

**Data — no second model.** `buildGalleryComparisons(days)`
(`src/domain/trade-audit/gallery.ts`) is a pure function over the exact
`AuditDayDTO[]` the Audit View renders, so a change saved in either view
appears in both after the shared refresh. Nothing is copied. Images are the
existing `MediaAttachment` rows:

| Side | Source |
|---|---|
| Actual | The trade record's own screenshots (`ownerType = TRADE`), **after-trade (`AFTER`) first**, then before-trade, with provenance labels. |
| Expected | The setup explicitly paired with the trade (`TRADE_AUDIT_EXPECTED`) plus the trade's review screenshots (`TRADE_AUDIT_ASSESSMENT`), or the missed setup's own images (`TRADE_AUDIT_EXPECTED` / `OPPORTUNITY`). |

**The one schema change.** `AuditExpectedTrade.linkedTradeId` (nullable FK,
SetNull) records "I should have taken this setup *instead of* that trade". It
is set from the Audit View, and the server only accepts a live, in-scope trade
of the same audit on the same day. This is what lets an invalid trade be
compared with the valid setup the trader should have taken.

**Comparisons — nothing invented.**

| Case | Actual | Expected |
|---|---|---|
| Valid trade | Trade screenshots | Paired setup if any, else the trade's own plan prices (labelled) with its review screenshots |
| Invalid trade | Trade screenshots | Paired setup, or an empty state: "No valid setup recorded instead" |
| Missed (review) | "No trade taken" | The missed setup and its chart evidence |
| Missed (live) | "No trade taken" | The live opportunity, qualification as scored at the time |

**Navigation & state.**
- Prev/next comparison (←/→), prev/next day (Shift+←/→ or `[`/`]`), day chips with counts, and an "n / N" counter.
- Filters by instrument, strategy, outcome and day; only values present this week are offered.
- `F` toggles full screen and Esc leaves it.
- The view, current comparison and filters live in the URL (`view`, `c`, `g_*`) via the History API, with no server round trip. Week navigation keeps the view and filters.
- The Audit View stays mounted (hidden) while the Gallery is shown, so switching never loses scroll position, collapsed days or unsaved text.

**Images.** Aspect ratio is always preserved (contain, fitted in pixels so
review markers stay pinned to the chart). Supported: wheel/button/double-click
zoom, drag to pan, reset, several screenshots per side, and click to open a
full-screen inspector with arrow keys.
