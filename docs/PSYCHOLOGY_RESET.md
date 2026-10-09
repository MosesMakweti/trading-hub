# Trading Psychology Reset

An optional, guided reflection after a **settled losing trade** or a **recorded
missed opportunity**. It helps traders recover probabilistic thinking and
return to rule-based decisions. It is advice, never a gate.

## The preference

Settings → Trading Preferences → **Trading Psychology Reset**.

- Stored per user on `User.psychologyResetEnabled`. It is OFF by default for
  existing and new users.
- `User.psychologyResetEnabledAt` is stamped on every OFF → ON change.
- The toggle shows the persisted value: it is disabled while saving, and a
  failed save reverts it with an error.
- Turning it OFF only stops future prompts. Nothing is deleted.
- Turning it ON again never replays older events.

## Triggers (`server/services/psychology-reset.service.ts`)

| Event | Hook | Created when |
|---|---|---|
| Losing trade | end of `syncLiveTradeLifecycle` (every live execution save: exits, partial exits, ledger fills, review sync) | feature ON · live (not backtest) · the trade is a settled **LOSS** by `settledWinLossClass` (canonical: settled, realized R < −0.001) · `closedAt ≥ psychologyResetEnabledAt` |
| Missed opportunity | after `recordMissedSetup`, `recordCancelledIdeaAsMissed` and `logMissedOutcome` | feature ON · live · status MISSED |

- Open or partially closed positions, wins, break-evens, legacy manual results
  and backtests never trigger a reset.
- Missed opportunities never create a Trade and never record a loss figure.
- Hooks run through `queue*Safely`, which catches and logs errors. A reset can
  never fail, delay or roll back the save that triggered it.
- Duplicates are prevented by a unique `tradeId` / `opportunityId` plus
  `createMany({ skipDuplicates: true })`. Retries, double submits,
  re-settlements and concurrent calls create at most one session.

## Storage: `PsychologyResetSession`

| Field | Meaning |
|---|---|
| `trigger` | `LOSING_TRADE` or `MISSED_OPPORTUNITY` (a DB CHECK ties it to exactly one of `tradeId` / `opportunityId`) |
| `flowVersion` | the content version the answers belong to |
| `status` | `IN_PROGRESS` or `COMPLETED` |
| `currentStep` | the step index; `steps.length` means the summary |
| `answers` | `{ stepId: { optionId, note?, answeredAt } }`, written with an atomic per-key jsonb merge, so two tabs or retries never lose a step |
| `nextAction` | the final step's option, set on completion |
| `deferredAt` | "Finish later": the session is not auto-opened, but stays resumable |
| `completedAt` | when the session was completed |

- Every action is scoped to the authenticated user (`actions/psychology-reset.actions.ts`).
  Another user's session id returns "Reset not found."
- Inputs are zod-validated, and answers are validated against the stored flow version.

## Content (`domain/psychology-reset/`)

- **`flows.ts`:** versioned wording, options and their behavioural signals:
  - Losing trade: 5 steps.
  - Missed opportunity: 4 steps.

  Revise wording in place only while option meanings stay the same.
  Otherwise add a new version.
- **`assessment.ts`:** the pure recommendation:
  1. A reached Today day limit (daily risk or max trades) → **stop**. The
     limit takes precedence and is never changed.
  2. A rule break while still activated → **stop**.
  3. Recovery or chasing urge, FOMO, reacting, struggling, or an unclear
     feeling → **cooldown**.
  4. Otherwise → continue only with a valid setup. Waiting stays legitimate.
- The trader's own next-action choice is shown against the recommendation,
  never overridden.
- A completed reset is explicitly not a certification of readiness.

## UI

- `components/psychology-reset/psychology-reset-host.tsx` sits in the
  `(app)` layout. While the feature is ON it auto-opens the newest unfinished
  session that hasn't been deferred.
  - Closing the dialog counts as "Finish later", which leaves a small
    **Resume** control.
  - It re-checks on navigation.
  - When the feature is OFF, nothing renders.
- `reset-flow-view.tsx` shows one question per screen, with progress, Back /
  Continue, optional reflection, a summary and a completion state.

## Not covered (v1)

- Prop-firm account rules are not consulted; only Today's day limits are.
- When several resets are unfinished, only the newest is surfaced.
- There is no history view of past reflections yet.
