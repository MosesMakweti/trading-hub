# Journal → Trade Workspace refactor — build log & phase plan

Turns every trade from one long edit form into a **Trade Workspace**: a case file
that preserves *what I planned · what I actually did · what I learned*. The Journal
stays the historical archive — the **calendar, Daily Notes, trade list, and analytics
are untouched**. This is a structural redesign of an individual trade, built in
resumable phases.

Read this file first to resume; continue from the next unchecked phase without
rebuilding completed work.

Routes:
- `/journal/[date]/trades/[tradeId]` → **Trade Workspace** (read-oriented case file).
- `/journal/[date]/trades/[tradeId]/edit` → the existing full trade form (unchanged engine).
- `/journal/[date]/trades/new` → create form (unchanged).

---

## ✅ Phase 1 — Workspace structure (DONE)

Refactored the trade UI into the case-file workspace; **all existing data stays
fully functional**. No schema change.

### Completed work
- **Trade Workspace** read view organizing the *existing* trade into sections on a
  timeline rail: Trade Header → Trade Idea ("What I planned") → Trade Execution
  ("What I actually did") → Trade Review ("What I learned") → Timeline → Attachments
  → Trade Summary. Premium dark-glass, gradient step dots, `FadeIn`.
- **Header**: derived Trade #N, date/time, asset, direction, result (RR + $), session,
  entry model, and a derived **status** (Open / Closed / Reviewed).
- **Trade Idea**: entry model, session, HTF bias + confidence, expected RR, reference
  risk, confluences, pre-trade notes — plus placeholders for planned entry/stop/target,
  market context, areas of interest, reason (new fields for a later phase).
- **Trade Execution**: execution time, direction, Performance PnL (net/gross), a
  **planned-vs-actual RR** comparison, per-account risk/PnL allocation, TP hits &
  execution-confirmation labels — plus placeholders for actual entry/exit & notes.
- **Trade Review**: psychology (grade/%/raw), a read-only **Strategy Adherence** panel
  (5 prompts, layout is scoring-ready), and the existing review free-text mapped to
  General reflection / Lessons / What will I improve — plus placeholder prompts.
- **Timeline** (minimal): created & last-updated timestamps; full lifecycle timeline
  is Phase 3.
- **Attachments**: unified section with the three categories; uploads/preview/zoom/
  delete land when image hosting (UploadThing) is connected.
- **Trade Summary**: at-a-glance recap (result, strategy/version placeholders, entry
  model, psychology, adherence placeholder, lessons count, images count).
- The existing edit **form was moved to `/edit`** (back-link → workspace); after an
  edit the form now returns to the workspace. The trade **card's action opens the
  workspace** ("Open"); delete unchanged.

### Files changed
- New: `src/components/journal/workspace/*` — `workspace-ui.tsx` (WorkspaceSection
  rail, WorkspaceField, NoteBlock, ComingSoon, TradeStatusBadge, formatters),
  `trade-workspace.tsx` (composer), `trade-header.tsx`, `trade-idea-section.tsx`,
  `trade-execution-section.tsx`, `trade-review-section.tsx`,
  `strategy-adherence-panel.tsx`, `trade-timeline.tsx`,
  `trade-attachments-section.tsx`, `trade-summary.tsx`.
- New: `src/app/(app)/journal/[date]/trades/[tradeId]/edit/{page,loading}.tsx` (moved form).
- Changed: `src/app/(app)/journal/[date]/trades/[tradeId]/{page,loading}.tsx` (now the
  workspace + its skeleton), `src/types/trades.ts` (TradeWorkspaceDTO, TradeStatus,
  STRATEGY_ADHERENCE_QUESTIONS), `src/server/services/trades.service.ts`
  (`getTradeOrdinal`), `src/components/journal/trade-form.tsx` (edit returns to
  workspace), `src/components/journal/trade-card.tsx` ("Open" action).

### Database changes
- **None.** Phase 1 renders over the same `Trade` record. Status and Trade #N are
  derived, not persisted.

### Remaining tasks (later phases)
- Phase 4: strategy references + historical snapshots.
- Still surfaced as placeholders after Phase 3: adherence scoring, a persisted trade
  number, and a real `status` column (all derived for now).

---

## ✅ Phase 2 — Move fields into their sections (DONE)

The workspace sections are now **editable in place**, and the new plan / execution /
review case-file fields are live. The workspace is the primary edit surface for the
narrative fields; the monolithic `/edit` form still owns the structured core (asset,
RR, accounts, checklists, psychology) and is untouched.

### Completed work
- Added the case-file fields to the three sections, each **autosaving inline** (800 ms
  debounce, per-field save + "saving / saved" indicator), reusing the same
  `useDebouncedAutosave` pattern as Strategy Lab:
  - **Trade Idea**: planned entry / stop-loss / target (prices) + market context /
    areas of interest / reason for trade (notes).
  - **Trade Execution**: actual entry / exit (prices) + execution notes.
  - **Trade Review**: what went well / wrong / surprised (notes) + a tri-state
    "Would I take this trade again?" (Yes / No / —).
- A single lightweight patch path — `updateTradeSection` action →
  `updateTradeSections` service — writes **only the keys present** in a patch
  (one field can save alone), userId-scoped, without touching allocations,
  psychology, checklists, or the `/edit` form's fields.
- The Phase-1 dashed "coming later" placeholders are replaced by real, populated
  inputs (solid section cards).

### Files changed
- Schema: `prisma/schema.prisma` — 13 nullable columns on `Trade`
  (`plannedEntry`/`plannedStopLoss`/`plannedTarget`/`actualEntry`/`actualExit` as
  `Decimal(18,8)`; `marketContext`/`areasOfInterest`/`reasonForTrade`/`executionNotes`/
  `whatWentWell`/`whatWentWrong`/`whatSurprisedMe` as `String`; `wouldTakeAgain` as
  `Boolean`). Migration `20260803114316_trade_workspace_fields`.
- Validation: `src/lib/validation/trades.ts` — `tradeWorkspaceSectionSchema` (partial
  patch; price coercion + empty→null, note trim + empty→null, tri-state boolean).
  Tested in `src/lib/validation/trade-workspace-section.test.ts` (9 tests).
- Service/action: `updateTradeSections` (`trades.service.ts`), `updateTradeSection`
  (`trades.actions.ts`).
- UI: new `src/components/journal/workspace/workspace-fields.tsx`
  (`WorkspacePriceField`, `WorkspaceNoteField`, `WorkspaceDecisionField`); the three
  section components wired to them; `TradeWorkspaceDTO` + the workspace page mapping
  extended for the new fields.

### Database changes
- **Additive only** — 13 new nullable columns on `Trade` (migration above). No column
  was renamed, retyped, or dropped; existing trades read back as `null` for the new
  fields, so nothing regresses.

### Remaining tasks
- Adherence scoring, a persisted trade number, and a real `status` column are still
  derived / placeholder (planned for Phase 3–4).

### Recommended next phase
- **Phase 3 — Trade Timeline** (below).

---

## ✅ Phase 3 — Trade Timeline (DONE)

The workspace now shows the trade's real lifecycle as a vertical, semantic timeline.

### Completed work
- **Lifecycle stamps** captured when a trade first transitions state, applied
  uniformly across all three write paths via pure, tested helpers
  (`src/domain/trades/lifecycle.ts`):
  - `closedAt` — set the first time a result (`actualRR`) is recorded; preserved on
    later edits; cleared only if the trade is reopened.
  - `reviewedAt` — set the first time any review content appears (the /edit
    reflections **or** the Phase-2 workspace prompts); **sticky** — never
    auto-cleared once a review has happened.
  - "Executed" is derived (`tradeDate + executionMinutes`), "Logged" is `createdAt`,
    "Last updated" is `updatedAt` — no extra columns needed for those.
- **`TradeTimeline`** rebuilt as a semantic `<ol>`/`<li>` with `<time>` elements:
  Executed → Logged → Closed → Reviewed, each with an icon **and** a text label
  (never colour-alone), reached milestones on gradient nodes and not-yet-reached
  ones as muted dashed "Pending" nodes (so it doubles as a status tracker), plus a
  "Last updated" footer. Static (the workspace already fades in once) and
  accessibility-minded, per the ui-ux-pro-max guidance applied.

### Files changed
- Schema: `prisma/schema.prisma` — `closedAt`/`reviewedAt DateTime?` on `Trade`.
  Migration `20260803130114_trade_timeline_stamps` (with a best-effort backfill of
  legacy rows from `updatedAt` — documented as approximate in the SQL).
- New: `src/domain/trades/lifecycle.ts` (+ `lifecycle.test.ts`, 10 tests).
- `trades.service.ts` — stamp logic in `createTrade` / `updateTrade` /
  `updateTradeSections`.
- `types/trades.ts` + the workspace page — `executedAt`/`closedAt`/`reviewedAt` on
  the DTO. `components/journal/workspace/trade-timeline.tsx` rewritten.

### Database changes
- **Additive only** — 2 new nullable `DateTime` columns; legacy rows backfilled from
  `updatedAt` (an approximation; going forward the stamps are precise).

### Verification
- 10 lifecycle unit tests + a 4-scenario DB integration check (open→null,
  created-closed+reviewed→set, inline-review→set, sticky-on-clear) + `getTrade`
  returns the new fields; tsc + eslint clean; 122 tests pass. *(Browser screenshot
  skipped — the shared low-memory dev server was mid-churn and in active use; the
  render path is unchanged from Phase 2, which was browser-verified.)*

### Recommended next phase
- **Phase 4 — Strategy integration + historical snapshots** (below).

---

## Later phases

- **▶️ Phase 4 — Strategy integration + historical snapshots (BUILD THIS NEXT)**: add `Trade.strategyId`
  (reference to Strategy Lab, `onDelete: SetNull`) **and** snapshot columns
  (`strategyNameSnapshot`, `strategyVersionSnapshot`, `entryModelNameSnapshot`) written
  at save time so a completed trade always shows the strategy **as it was when taken**,
  even if the strategy later changes. Selecting a strategy references (not duplicates)
  its Framework/Entry Models. This dovetails with Strategy Lab's own Phase 7 Journal
  integration (`docs/STRATEGY_LAB.md`) — coordinate the `Trade.strategyId` migration so
  the two efforts share one column. **Do NOT auto-populate Arsenal.**

## Historical integrity (architectural requirement — honor in every phase)
A completed trade must never lose its context: strategy + version, entry model, market
context, the original idea, the execution, and the review. Snapshots (Phase 4) are how
a historical trade keeps showing the strategy version that existed when it was taken.
