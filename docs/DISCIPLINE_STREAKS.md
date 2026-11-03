# Discipline Streaks — 🔥 routine · 📝 review · 🎯 plan adherence

Rewards **process, never outcome**. Nothing here counts trades placed, PnL,
R or win rate. A losing trade that was reviewed and executed to plan earns
exactly what a winner does. A flat day with a full routine is a perfect day.
This sits alongside the Preparation Score (`docs/DISCIPLINE.md`) and reuses
its trader calendar and schedule.

## Where things live

| Concern | Code |
| --- | --- |
| Pure streak engine, tracks, rules, milestones, achievements | `src/domain/discipline/streaks/` |
| Facts → tracks → streaks; achievement persistence; feedback | `src/server/services/discipline-streaks.service.ts` |
| DTOs | `src/types/discipline.ts` |
| Actions | `acknowledgeAchievementsAction` (`actions/discipline.actions.ts`); `completeReviewAction` and `closeTradingDayV3Action` return `discipline` feedback |
| UI | `components/discipline/*`, page `/discipline`, Dashboard section, sidebar "Discipline" |
| Tests | `domain/discipline/streaks/streaks.test.ts` (pure), `server/services/discipline-streaks.service.test.ts` (DB) |

## The model: derived, never counted

Every streak and total is **recomputed on read** from persisted records. Each
local date gets exactly one status per track:

| Status | Effect |
| --- | --- |
| ACTIVE | streak + 1 |
| MISSED | streak = 0 |
| REST | unchanged (nothing was owed) |
| PENDING | unchanged (today, or awaiting the trader's review) |

So there are no counters to drift. A double submit can't add twice (one
status per date, one credit per trade). Editing or deleting a trade or day
corrects every number on the next read.

**Timezone:** an instant is placed on the trader's calendar using the
`TraderTimezoneVersion` in effect at that instant (`traderDateKeyOf`). Date
columns (`TradingDay.date`, `Trade.tradeDate`) are used as-is. Dates skipped
by an eastward timezone jump are REST.

**Required days:** taken from the Preparation Schedule's weekdays and its
audited DAY_OFF / EXTRA_DAY rules (an exception counts only if created
before that day's target). Without a schedule, Monday–Friday applies. A
REQUIRED date can break a streak. OPTIONAL and EXEMPT dates never do.

**Scope:** LIVE only. Reads run under `runLive` with `backtestRunId: null`,
and soft-deleted trades are excluded.

## 🔥 Routine

A routine day is complete when both halves are done:

1. **Pre-session.** `routineFirstReadyAt` (legacy: `routineReadyAt`) falls on
   that local date. The server gate only allows readiness once every
   mandatory item is complete, so a partial routine never qualifies.
2. **Post-session.** `analyzedAt` (Close Trading Day / "Mark day reviewed")
   falls no later than the next local date (`ROUTINE_CLOSE_GRACE_DAYS = 1`),
   and at least one daily reflection field has text.

Statuses: complete → ACTIVE · today → PENDING · REQUIRED → MISSED · otherwise
REST. Trades play no part.

## 📝 Review

- **Credit:** a trade whose centralized review state is
  `FINAL_REVIEW_COMPLETE`. The structured requirements are the motive, the
  four process answers and `wouldTakeAgain`, with `reviewedAt` ≥ close.
- **Credit date:** the new write-once `Trade.finalReviewCreditedAt`, set by
  the first final `completeReview`. `reviewedAt` is re-stamped on every
  re-completion, so it can't date the credit. Falls back to `reviewedAt` for
  older rows.
- **Day status:** ≥ 1 credit that day → ACTIVE, however many reviews. Today →
  PENDING. A REQUIRED date with a closed trade still awaiting its final
  review at day's end → MISSED. Otherwise REST, so a day with nothing to
  review never needs a trade.

## 🎯 Plan adherence (`plan-adherence.ts`)

**Objective violations** disqualify a trade immediately:

- `setupValid = false`
- `validationState = OVERRIDDEN`
- `limitOverrideReason`
- trading against the frozen daily final bias
- stop widened beyond the initial stop
- motive FOMO / REVENGE / BOREDOM / IMPULSE / MANUAL_OVERRIDE

**Without those**, the trade needs:

- a completed final review (`AWAITING_REVIEW` until then)
- motive PLANNED
- all four process answers "yes"
- psychology `riskManaged` / `followedExitPlan` not "no"

**Day status** is keyed on `tradeDate`:

| Day | Status |
| --- | --- |
| No executed trade | REST |
| ≥ 1 PERFECT trade | ACTIVE |
| Any trade awaiting review | PENDING |
| Otherwise | MISSED |

## Milestones and achievements

- **Milestones:** 3, 7, 14, 30, 60, 90 days on every track.
- **Achievements:** the 12 in `ACHIEVEMENTS`. Count achievements are dated by
  the N-th credit. Streak achievements are dated by the first day a run
  reached N.
- **Persistence:** `DisciplineAchievement` is unique on `(userId, key)` and
  written under an advisory lock with `skipDuplicates`.
- **Append-only:** a DB trigger rejects any rewrite or delete except a cascade
  from the user, and allows one `seenAt` write. An earned achievement
  survives later edits to its records.
- **Sync:** happens on Dashboard / Discipline loads and after review
  completion or a day close. New ones show one dismissible banner and are
  named in the action toast.

## Migration `20261103093731_discipline_streaks`

- Adds `Trade.finalReviewCreditedAt` with a write-once trigger. Backfills it
  from `reviewedAt` for LIVE REVIEWED trades that already meet the structured
  minimum.
- Creates `DisciplineAchievement` with its guard trigger.
- Purely additive: no existing column is changed.

## Known limitations

- **Review backlog:** an old backlog of unreviewed closed trades makes every
  scheduled day without a review a MISSED review day. That is the literal
  rule ("something was left to review"). The tile shows how many trades are
  waiting.
- **Pending is open-ended:** an adherence day stays PENDING while its trades
  are unreviewed. It doesn't break the streak, but it never counts either,
  and the review track still reflects the missing review.
- **"At least one" rule:** an adherence day counts with at least one perfect
  trade, as specified. A day with a violation can still count if another
  trade was perfect. The UI never prompts the trader to place a trade.
- **Performance:** totals are computed over the trader's whole LIVE history on
  each load (one lean trade query plus the shared review-facts query). Fine
  for thousands of trades; very large histories might want a cache.
- **Retroactive history:** streaks are computed from existing records, so
  history from before the feature shipped appears on the calendar.
