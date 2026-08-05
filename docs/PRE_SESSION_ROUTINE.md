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
