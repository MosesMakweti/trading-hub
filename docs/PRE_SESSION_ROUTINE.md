# Pre-Session Routine — architectural change tracker

**Resumable master tracker.** Read this first. It records the roadmap, the schema design,
the decisions, and a per-phase progress log for the "remove Trading Plan → add Pre-Session
Routine" refactor. Update it at the end of every phase.

## Why

TradeOS now has a clear separation of responsibilities, and the old **Trading Plan** conflicts
with it:

| Area | Answers | Nature |
|---|---|---|
| **Strategy Lab** | "How do I trade?" | permanent methodology knowledge base |
| **Today** | "How will I trade today?" | live daily workspace |
| **Journal** | "What happened?" | historical archive |
| **Edge** | "How do I improve?" | weekly refinement |

The Trading Plan's methodology (framework, entry models, trade management, psychology) is now
**owned by Strategy Lab** — it's redundant. It is removed. In its place, the Today workspace gains
a **Pre-Session Routine**: a fast, customizable pre-market ritual that puts the trader in the
right mindset. It is *not* strategy; it is preparation.

## Target daily workflow

```
Today
  → Pre-Session Routine     (was "Morning Prep"; upgraded — the ritual + readiness gate)
  → Today's Trading Plan    (unchanged: bias / conviction / watchlist / key levels / risk)
  → Trade Ideas
  → Trade Execution
  → Trade Review
  → Daily Analytics
  → Archive to Journal
```

The 5 workflow keys (`prep · plan · trade · review · analyze`) stay; **`prep` is redefined** from
the old free-form morning prep to the new Pre-Session Routine, whose completion (the "I am ready
to trade" gate) sets `prepCompletedAt`.

## Decisions (locked)

1. **Operational lists** (Watchlist/Assets, Trading Sessions, Confluence + Execution checklists)
   are trade-form infrastructure, not methodology → **kept**, relocated to a renamed Settings page
   ("Trade Setup") next to the new Pre-Session Routine settings.
2. **Entry Models → Strategy Lab.** The global `EntryModel` list duplicates Strategy Lab's
   per-strategy entry models → the trade form is rewired to source entry models from Strategy Lab
   (P2 investigates the exact shape); the standalone Entry Models settings list is retired.
3. **Removed models:** `TradingPlan` (methodology + risk fields) and `PsychologicalAnchor`.
4. **Routine data model:** a **template** (`RoutineSection` + `RoutineItem`, typed) plus an
   **immutable per-day JSON snapshot** on `TradingDay`. Template edits never touch history.
5. **Phased**, app functional + tests green after each phase, progress report + STOP, resumable.

## Data model design

### Template (editable in Settings)

```
enum RoutineItemType { CHECKBOX  SHORT_TEXT  LONG_TEXT }   // extensible

model RoutineSection {
  id, userId, title, sortOrder, collapsed Boolean @default(false), deletedAt
  items RoutineItem[]
}

model RoutineItem {
  id, userId, sectionId, type RoutineItemType, label,
  config Json?,          // per-type settings (future: rating scale, dropdown options, …)
  sortOrder, deletedAt
}
```

`config Json?` + the `type` enum mean **new item types (ratings, dropdowns, numeric, timers) need
no schema change** — only a new enum value + a renderer.

### Per-day snapshot (immutable history)

On `TradingDay`:
- `routineSnapshot Json?` — the **frozen** routine for that day: full sections+items structure
  *plus* the trader's responses (`{ checked, text }` keyed by item id). Written when the day's
  routine is first opened/started; never rewritten from the template afterwards.
- `routineReadyAt DateTime?` — stamp set by the "I am ready to trade" confirmation; unlocks the
  rest of the Today workflow and drives `prepCompletedAt`.

Retired columns (superseded by the snapshot): `routineCompletion`, `readiness`, `marketContext`
(the last folds into routine items / Today's Plan). Removed in P2 to keep P1 purely additive.

Because the snapshot is self-contained JSON with no FK to the mutable template, **historical
journal entries always show the exact routine completed that day** — requirement satisfied by
construction.

### Default routine (seeded)

Personal Readiness · Market Preparation · Risk Confirmation · Psychological Readiness — the
checklist from the brief, seeded for every user (idempotent) so the routine is useful on day one.

## Roadmap

```
P0  Tracker + design (this doc) .......................... ▶ in progress
P1  Additive data model (models + columns + migration
    + seed default routine; nothing removed yet) ......... ⭘ next
P2  Remove Trading Plan (drop models, delete page/
    sections/actions/service, rewire Today + Dashboard,
    relocate lists to Settings/Trade Setup, Entry
    Models → Strategy Lab) ............................... ⭘
P3  Pre-Session Routine Settings editor (sections + items
    CRUD / reorder / collapse / item types; autosave) .... ⭘
P4  Today → Pre-Session Routine step (snapshot on start,
    complete items, progress, "I am ready to trade"
    gate → unlocks workflow) ............................. ⭘
P5  Journal shows the frozen daily snapshot; workflow
    relabel prep → "Pre-Session Routine" (stepper,
    tabs, dashboard) ..................................... ⭘
P6  Polish, unit tests, full verify ...................... ⭘
```

Every phase: `tsc` + `eslint` clean, vitest green, app runnable. Follows the design system
(docs/design-system.md) — calm work-surface motion, glass cards, tabular-nums, EmptyState.

## Progress log

### P0 — Tracker + design ✅
This document. Roadmap, schema, and the two locked decisions (operational lists kept & renamed;
Entry Models → Strategy Lab).

### P1 — Additive data model ✅
Purely additive — nothing removed, app fully functional. Added `RoutineItemType` enum
(CHECKBOX/SHORT_TEXT/LONG_TEXT), `RoutineSection` + `RoutineItem` models (both userId-scoped,
soft-delete, sortOrder; item has `type` + `config Json?` for future types), and
`TradingDay.routineSnapshot Json?` + `routineReadyAt DateTime?`. Migration
`20260805010000_pre_session_routine_model` (create-only; no drops) applied via diff→deploy;
client regenerated. Old `routineCompletion/readiness/marketContext` left in place (retired in P2).
Verified: tsc + eslint clean, 172 tests green, `/today` + `/login` serve 200. **No seeding or UI
yet** — that's P3/P4. Next: P2 remove the Trading Plan.

### P2 — Remove the Trading Plan ✅
Dropped `TradingPlan` + `PsychologicalAnchor` (migration `20260805020000_remove_trading_plan`).
Deleted `trading-plan.service`/`actions`, `psych-anchors.service`/`actions`, and the 5 methodology
plan sections (framework, profit-taking, stop-loss, risk-management, psych-anchors) + the old flat
`pre-session-routine-section`. Trimmed `lib/validation/trading-plan` to the operational schemas.
Settings/plan page rebuilt as **"Trade Setup"** (assets, sessions, entry models, confluence +
execution checklists only) — route path `/settings/plan` kept to avoid churning ~15 revalidatePath
calls (cosmetic rename deferrable). Rewired `today/page` + `dashboard.service` off `getTradingPlan`
(Today's `planRiskLimit` → null; Dashboard "Today's Plan" card → a Strategy Lab access card).
Topbar link relabeled "Trade Setup". Fixed `server/db.ts` soft-delete set (removed dangling
`PsychologicalAnchor`; **added `RoutineSection`/`RoutineItem`**). Updated stale "Settings > Trading
Plan" copy in the trade form + Today sections.

**Entry Models kept working** (global `EntryModel` list still in Trade Setup) — the Strategy-Lab
migration is its own phase (P2b) because `EntryModel` and `StrategyEntryModel` are separate models
and existing trades FK + snapshot the former.

Verified: tsc + eslint clean, 172 tests green; `/today` rendered 200 with the new code; all routes
compile, no dev-log errors. **Note:** dropping the tables discards any Trading Plan methodology
content (intended — it's Strategy Lab's now). Next: P2b or P3.

### P3 — Pre-Session Routine Settings editor ✅
Dedicated Settings area at **`/settings/routine`** (topbar dropdown link, ListChecks icon). Full
template editor:
- **Domain** `domain/today/default-routine.ts` — pure `DEFAULT_ROUTINE` (the brief's 4 sections /
  17 checkbox items) + `RoutineItemTypeValue` union + `ROUTINE_ITEM_TYPES`.
- **Service** `routine.service.ts` — `getOrCreateDefaultRoutine` (lazy-seeds the default on first
  load, like the Performance Account), `listRoutine` (nested `items` include spells out
  `deletedAt:null` since the soft-delete extension doesn't filter nested reads), section CRUD +
  reorder + `setSectionCollapsed`, item CRUD + reorder. Section delete soft-deletes its items too.
- **Validation** `lib/validation/routine.ts`; **Actions** `routine.actions.ts` (revalidate
  `/settings/routine`).
- **UI** `components/routine/routine-editor.tsx` — reuses `SortableList` for **both** section- and
  item-level drag-reorder; inline title/label editing; persisted collapse (optimistic); item
  **type picker** (Checkbox / Short note / Long note via `ROUTINE_TYPE_META`); `ConfirmDialog` on
  deletes; "Add item" / "Add section". `loading.tsx` skeleton.

Verified: tsc + eslint clean, 172 tests green. **Screenshotted for real** — registered a throwaway
user (`verify+<ts>@desk.local`, "Verify Bot") which confirmed the register flow survived P2 AND the
default routine seeds + the editor renders correctly. Next: P4 (Today routine step + snapshot +
readiness gate) — the editor's item types feed the Today renderers.

### P4 — Today Pre-Session Routine step ✅
The routine is now the first Today tab and gates the day.
- **Domain** `routine-snapshot.ts` — `RoutineSnapshot` type + pure `isItemComplete` / `routineProgress`
  (4 unit tests; total 172 → **176**).
- **Service** `today-routine.service.ts` — `getOrCreateDayRoutine(userId, day)` freezes a snapshot
  `{ sections, responses }` of the current template on first open (seeds default if empty), then
  always returns that frozen copy; `setRoutineResponse` merges one item's response (structure
  untouched); `setRoutineReady` sets `routineReadyAt` + `prepCompletedAt` (advances the workflow).
- **Actions** `today-routine.actions.ts` (guarded by `dayEditableGuard`, revalidate `/today`).
- **UI** `pre-session-routine-section.tsx` — progress bar, sections rendered by item type
  (checkbox / short / long text, autosave on toggle/blur), and the big "I am ready to trade" gate
  ↔ "You're ready" banner + Reopen. `today-workspace.tsx`: routine is the first tab (ListChecks);
  the other 5 tabs are **locked** (disabled + Lock icon) until ready. Today page seeds/loads it.
- **Removed** the old flat Morning Prep: `morning-prep-section`, `updateMorningPrep` action+service,
  `morningPrepSchema`, `MorningPrepDTO`. (Unused columns `routineCompletion/marketContext/readiness`
  left on TradingDay — drop in P6.)
- **Bug caught + fixed by screenshot:** the Today page upserted the TradingDay twice in parallel
  (page + routine service) → Prisma unique-constraint race on `(userId,date)`. Fixed by creating the
  day once and passing it into `getOrCreateDayRoutine`.

Verified: tsc + eslint clean, 176 tests green; **screenshotted end-to-end** via a throwaway user —
routine seeds, tabs lock, the gate unlocks them + advances the stepper (Preparation done → Plan
current). Next: P5 (journal snapshot + workflow relabel) — the `prep` step still shows
"Preparation"; relabel to "Pre-Session Routine".

### P5 — Journal frozen snapshot + workflow relabel ✅
- **Journal recap** now shows the day's **frozen routine** read-only. `getJournalDayRecap` reads
  `day.routineSnapshot` (dropped the old `routineCompletion`/checklist read), computing progress via
  the pure `routineProgress`. Recap DTO `prep` → `routine { snapshot, readyAt, progress }`. New
  read-only `components/routine/routine-snapshot-view.tsx` renders each section's items with their
  completion (checkbox ✓/–, text notes) — the *exact* routine run that day, immutable by design.
  The recap's old "Morning prep" card is now a "Pre-Session Routine" card (progress + "Confirmed
  ready" badge + the full view); the Plan card went full-width.
- **Workflow relabel:** `WORKFLOW_STEP_META` `prep` "Preparation" → **"Routine"** (short label fits
  the compact stepper node; the full name is the tab/section), icon `Sunrise` → `ListChecks`.
  Propagates to Dashboard / Today / Journal steppers.

Verified: tsc + eslint clean, 176 tests green. **Live screenshot NOT captured** — local Postgres
went unreachable mid-verification (`P1001`/`ConnectionClosed`, the [[trading-hub-low-memory-dev]]
OOM instability; container "Up" but frozen, a `docker restart` didn't recover it). Code is untouched
by that (infra only) and is type-checked + unit-tested. Next: P2b, then P6.

### P2b — Entry Models → Strategy Lab ✅ (lightweight path)
On deeper exploration the global `EntryModel` turned out to be entangled with the trade form,
CSV/JSON **import** (resolves entry-model names → global `EntryModel`), **export**, and display —
and `StrategyEntryModel`s are per-strategy methodology docs while a trade's `strategyId` is
optional. A full rewire (entry-model options sourced from the selected strategy, names-only import)
would be ~12 files touching import/export and would force entry-model tagging to require a strategy.
**User chose the lightweight path:** keep the trade form + import/export exactly as-is, and just
relocate the Entry Models *editor* from Settings to **Strategy Lab**.
- New page `/strategy-lab/entry-models` (reuses `EntryModelsSection`); an "Entry models" button in
  the Strategy Lab header (next to Pattern library). `entry-models.actions` revalidate path
  re-pointed. Removed the Entry Models card from Settings/Trade Setup; trade-form empty hint now
  points to Strategy Lab. **Non-destructive, no migration**, global `EntryModel`/`TradeEntryModel`
  untouched. tsc + eslint + 176 tests green; verified live (Strategy Lab header + Entry Models page
  + trimmed Trade Setup). **Only P6 remains.**

### P6 — Cleanup, polish, full verify ✅ 🎉 REFACTOR COMPLETE
- **Dropped the dead columns** `TradingDay.routineCompletion / marketContext / readiness` (superseded
  by `routineSnapshot`/`routineReadyAt`), migration `20260805030000_drop_morning_prep_columns`; client
  regenerated. (NB: `Trade.marketContext` is a *different*, live field — untouched.)
- **Fixed a broken link:** Entry Model search results pointed at `/settings/plan` → now
  `/strategy-lab/entry-models`.
- **Stale copy:** app metadata description + the journal-recap JSDoc updated.
- **Full verify:** tsc clean, **full-`src` eslint clean**, **176 tests green**, and an end-to-end
  click-through (register → Today: complete items + ready gate → Journal recap) with **zero HTTP 5xx**.

**The refactor is done.** Trading Plan removed; Pre-Session Routine live across Settings → Today
(customizable template, per-day snapshot, "I am ready to trade" gate + tab-lock) → Journal (frozen,
immutable); workflow relabeled; Entry Models under Strategy Lab. Env note: `.env` `DATABASE_URL` host
is now `127.0.0.1` (was `localhost`, which resolved to a broken IPv6 forward).

### Fix — single source of truth (template drives the live day)
**Problem:** decision 4 froze the per-day snapshot on *first open*, so editing the routine in Settings
never reached the current Today (the snapshot was an independent stale copy), and the save actions only
revalidated `/settings/routine`. **Refinement of decision 4:**
- The **template** (`RoutineSection`/`RoutineItem`) is the single source of truth for *structure*. For
  an **ACTIVE** day, `getOrCreateDayRoutine` now **rebuilds the structure from the live template on
  every load** (carrying responses over by item id, persisting only when the structure changed) — so
  Settings edits (add/remove/rename/reorder/retype) appear on Today immediately. The per-day JSON is a
  derived cache, not a separate editable copy.
- **ARCHIVED** days are still returned verbatim → journal history stays immutable (the original intent,
  now scoped to finalized days only).
- All routine mutation actions revalidate **`/today`** as well as `/settings/routine`, so navigating to
  Today after Save shows the change with no manual refresh; the write-back makes it survive
  navigate-away-and-back. Default routine still auto-seeds via `getOrCreateDefaultRoutine`.
