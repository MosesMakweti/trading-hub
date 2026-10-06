# Discipline — Preparation Score & Preparation Streak

Status:
- **Phase 0 (timezone foundation): built.**
- **Phase 1 (pure scoring/streak/schedule domain): built.**
- Phases 2–5 are not built: persistence, finalization, UI, history, and the
  overall Discipline Score.

The Preparation Score measures **process**: showing up and completing the
pre-session routine on time. It never looks at PnL, wins, losses or trade
count. A correctly flat day can score 100.

## Phase 0 — the trader's calendar

Every surface that asks "what date is it for this trader?" uses
`getTraderTodayKey` (`server/services/trader-time.service.ts`). That covers
`/today`, the Journal (`isToday` and the calendar's today), the Dashboard,
Analytics and Edge Review defaults, and the API v1 `dateKey` default.

- **Instants:** the server clock is authoritative. The browser and server
  local timezones are never used to decide the date.
- **Calendar:** the trader's IANA timezone, stored in `TraderTimezoneVersion`
  (append-only; a DB trigger rejects UPDATE/DELETE except by cascade).
- **No timezone configured:** the UTC calendar is used. That is exactly the
  previous behaviour on Vercel.
- **A change governs from the next local date.** Let N be the next date on
  the calendar currently in effect. The new zone takes over at the later of
  "N starts in the current zone" and "N starts in the new zone":
  - the effective today key never moves backwards (verified by an exhaustive
    sweep test);
  - existing `TradingDay` rows are never re-dated. Nothing is migrated.
  - An eastward jump can skip a date (that date then has no TradingDay).
  - A westward change of 24h or more across the date line is refused. Make
    it in two steps.
- **DST:** handled by the platform's IANA data through `Intl`. Wall times
  are converted with the two-pass `localWallClockToUtc`. Start of day is
  found by search, so zones whose DST change happens at midnight
  (e.g. America/Santiago) are still correct.
- **Configuration:** Settings → Trading Preferences → Trading timezone. The
  browser zone is only a suggestion until the trader confirms.

Known residual: times of day captured in the browser (`nowMinutes`,
`executionMinutes`) remain browser-local wall-clock minutes. They are labels
on a date, not dates. Preparation scoring uses server instants only.

## Phase 1 — scoring domain (`src/domain/discipline/`)

### Score
`Preparation Score = Completion (0–70) + Timing (0–30)`, as integers.

**Completion:**
- 70 when readiness was confirmed by the cutoff (readiness is impossible
  without every required item).
- Otherwise `round(70 × requiredDone / requiredTotal)`, counting only items
  completed by the cutoff.
- Zero required items: explicit readiness is still required. Once
  confirmed, completion is 70; if never confirmed, the day is MISSED.
- Optional items are never inputs.

**Timing:** a band on `d = firstReadyAt − targetAt`, in exact milliseconds.

| d | Points | Status |
|---|---|---|
| d < −3h | 15 | VERY_EARLY |
| −3h ≤ d < −60m | 25 | EARLY |
| −60m ≤ d ≤ +15m | 30 | ON_TIME |
| +15m < d ≤ +30m | 25 | LATE |
| +30m < d ≤ +60m | 18 | LATE |
| +60m < d ≤ +2h | 10 | VERY_LATE |
| +2h < d ≤ cutoff | 5 | VERY_LATE |
| after cutoff | 0 | INCOMPLETE (some required done) / MISSED (none) |

- **Cutoff:** `min(target + 6h elapsed, 23:59 local on the same date)`.
- **After the cutoff:** the day is final. Completing the routine later
  (allowed; Today still works) never restores it.
- **Before the cutoff:** an unready day is PENDING and is never a miss.
- **Readiness before the cutoff:** final immediately.

The bands, weights and cutoff live in `PREPARATION_SCORING_V1` with a
`scoringVersion`. They are frozen into each schedule version, so changing the
rules never rewrites history.

### Schedule
- **`PreparationScheduleVersion`** (domain type): `effectiveFrom` (a local
  date), `timezone`, `targetMinutes`, `weekdays`, frozen `rules`.
  - A change is a new version from the next local date.
  - Dates before the first version are outside the scoring era: not scored,
    not missed, no retroactive scoring.
- **Exceptions:**
  - `DAY_OFF` exempts a scheduled date only if it was created **before that
    date's target**. A late one cannot erase a miss; history changes go
    through corrections.
  - `EXTRA_DAY` makes an unscheduled date count.
- **v1 limits:**
  - one Preparation per local date (no per-session scores);
  - target and cutoff within one local date (no overnight targets).

### Evaluation, corrections, streak
- **`evaluatePreparationDays`** yields one outcome per local date from the
  era start through today. A scheduled date with no TradingDay row is MISSED
  after its cutoff. This is the deterministic function Phase 2 persists.
- **`effectiveDays`** applies the latest valid correction per date. A valid
  correction has a reason and an actor. The original outcome is never altered.
- **`derivePreparationStreak`** is derived, never a stored counter:

  | Effect | Statuses |
  |---|---|
  | Counts | VERY_EARLY, EARLY, ON_TIME, LATE, VERY_LATE |
  | Breaks | INCOMPLETE, MISSED |
  | Exempt | DAY_OFF, NOT_SCHEDULED |
  | Ignored | PENDING (today before its cutoff) |

  It also reports `lastBreak` (for "Your 14-day Preparation Streak ended …")
  and `restartedAfterBreak` (for "New streak started").

### Scoring and readiness may observe different requirement versions
- **Scoring:** uses the mandatory item ids frozen when the day's routine was
  first created (Phase 2 freezes them).
- **The existing Today readiness gate:** still follows the live template
  for an active day. Its behaviour is unchanged on purpose.

So a template edit made later that day changes what the gate requires, but
never the scoring denominator.

## Future: Trader Discipline
`domain/discipline/component.ts` sketches `DailyComponentScore`.
- Preparation is component #1.
- An overall score (not built) averages only the components that apply to a
  day, so a correctly flat day can score at the top.
- PnL, win/loss and trade count are never components.
