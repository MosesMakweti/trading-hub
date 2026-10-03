# Today V3 — Phase 3: Review, Psychology & Process Intelligence

Review follows **DERIVE → SHOW EVIDENCE → ASK FOR JUDGEMENT → REFLECT**. Every
answer is stored in an existing canonical column/row; there are no V3-only
review records and no schema change in this phase.

## Where things live

| Concern | Code |
| --- | --- |
| Review state (interim vs final, completion requirements) | `src/domain/trades/review-state.ts` |
| Questionnaire adapter (DERIVED / EVIDENCE / HUMAN) | `src/domain/psychology/review-adapter.ts` |
| Risk / exit evidence, label suggestions | `src/domain/trades/review-evidence.ts` |
| Result + Plan vs Actual read models | `src/domain/trades/review-summary.ts` |
| Display lifecycle incl. review | `deriveLifecycleWithReview` in `src/domain/trades/trade-lifecycle.ts` |
| Read model + writes | `src/server/services/trade-review-v3.service.ts` |
| LIVE lifecycle-column sync | `src/server/services/trade-lifecycle-sync.service.ts` |
| Actions | `src/actions/trade-review-v3.actions.ts` |
| UI (Today V3 Review stage + live Journal) | `src/components/today-v3/review/review-stage.tsx` |

## Psychology questionnaire mapping (scorer and keys unchanged)

| Key | V3 source |
| --- | --- |
| `fomo` | DERIVED from `Trade.tradeIntent` (FOMO → yes, any other motive → no, none → missing) |
| `alignedWithBias` | DERIVED from direction vs `Trade.dailyBiasSnapshot` (the frozen daily **Final Bias**, not an HTF read); asked (HUMAN) only when the snapshot is NEUTRAL/missing |
| `riskManaged` | EVIDENCE — suggested from the Performance risk snapshot, account default, stop movement and limit overrides; trader confirms/flips |
| `followedExitPlan` | EVIDENCE — suggested from the locked plan's targets vs actual exits; trader confirms/flips |
| `influencedBySomeoneElseProfit`, `influencedByOnlineOpinion`, `outcomeWillInfluenceNext`, `monitoringObsession` | HUMAN |

The `PsychologyQuestionnaireResponse` row is written only when all 8 keys are
valid (same rule as before), so psychology % is computed by the unchanged
formula. **Semantic note:** for V3-reviewed trades `fomo` now means "the
motive was FOMO" and `alignedWithBias` means "aligned with today's frozen
final bias" — both previously self-reported. Historical rows are untouched;
re-saving a legacy trade's review in V3 re-derives those two keys.

## Completion and interim vs final

* Final review requires: motive, the four process answers, a scored
  questionnaire, and `wouldTakeAgain`. Reflection text is optional.
* **Complete review** stamps `Trade.reviewedAt`. V3 writes never stamp
  `reviewedAt` from free text (`updateTradeSections(..., { stampReviewedAtFromText: false })`);
  the legacy paths (edit form, imports, V2/Backtesting) keep the old stamp.
* Final complete ⇔ position closed **and** structured requirements met
  **and** `reviewedAt ≥` the close moment (`closedAt`, else Performance
  `settledAt` / last exit). An interim review (saved while open) is earlier
  than the close, so the trade returns to *Final review required*.
* Legacy trades with `reviewedAt` but no structured answers render as
  *Final review required* with "earlier review" context; nothing is deleted.

## LIVE lifecycle columns (compatibility)

`syncLiveTradeLifecycle` runs after every LIVE execution write
(section saves, partial exits) and review write:

* `reviewLifecycleStatus` ← STILL_HOLDING / PARTIALLY_CLOSED / FULLY_CLOSED
  from exited % and Performance settlement (cancelled ideas untouched).
* `closedAt` ← first time fully closed; cleared if an exit edit re-opens it.
* `status` ← OPEN until closed, CLOSED, then REVIEWED only after the final review.

Backtesting/Replay: the sync is a no-op; they keep the V2 review section
(`TradeWorkspace reviewVariant="legacy"`) and the manual lifecycle question.
Consequence for Close Day: LIVE entered trades no longer count as
"unresolved — no review status"; that bucket now only holds unsynced legacy rows.

## Carried positions

A position carried past its day that has since fully closed stays in Today's
carried list (closed within the last 7 days, up to the viewed day) until its
final review is complete, and review writes are allowed for it on its
archived day (`reviewWritableOnArchivedDay`).

## AI evidence

Trade reflections now also carry `keyLesson` (`psychLessonsLearned`) and
`tradeIntent`, included only when present so packages without them keep
their fingerprints.
