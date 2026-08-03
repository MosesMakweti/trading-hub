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
- The former placeholders — strategy-adherence scoring, a persisted trade number, and
  a real `status` column — are all **done in Phase 5** (below). No workspace items
  remain; the Strategy Lab Phase 7 Journal integration can now build on
  `Trade.strategyId`.

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

## ✅ Phase 4 — Strategy integration + historical snapshots (DONE)

A trade can now reference a Strategy Lab strategy, and freezes that strategy's
identity so the record stays historically accurate forever.

### Completed work
- **Reference**: `Trade.strategyId` → `Strategy` (`onDelete: SetNull`), selectable via
  a new **Strategy** dropdown in the trade form (create + edit). It *references* a
  strategy; it does not copy its Framework/Entry Models, and **Arsenal is never
  auto-populated**.
- **Snapshots** frozen at save time in `buildTradeSnapshots`: `strategyNameSnapshot`,
  `strategyVersionSnapshot` (from the strategy's current state) and
  `entryModelNameSnapshot` (the selected entry models' names, in selection order). A
  strategyId that isn't the user's is dropped (tenant isolation).
- **Display**: the header, Trade Idea, and Trade Summary now show the strategy from
  the **snapshot** (via a shared `StrategyRef`), linking to the live strategy while it
  exists. Because Strategy delete is a *soft* delete (the FK `SetNull` only fires on a
  hard delete), the include also selects `deletedAt` and the page drops the live link
  when the strategy is soft-deleted — the snapshot name/version still show (marked
  "deleted"), never a dead link.

### Files changed
- Schema: `prisma/schema.prisma` — `Trade.strategyId` + `strategy` relation +
  `strategyNameSnapshot`/`strategyVersionSnapshot`/`entryModelNameSnapshot`;
  `Strategy.trades` back-relation. Migration `20260803134554_trade_strategy_reference`.
- `trades.service.ts` — `buildTradeSnapshots`, wired into create/update; `strategy`
  (incl. `deletedAt`) added to `tradeInclude`; strategies added to
  `getTradeFormOptions`. `lib/validation/trades.ts` — `strategyId`.
- `trade-form.tsx` (+ new/edit pages) — strategy selector & default.
  `types/trades.ts` + workspace page mapping — strategy DTO fields.
  `workspace-ui.tsx` (`StrategyRef`), `trade-header.tsx`, `trade-idea-section.tsx`,
  `trade-summary.tsx` — snapshot display. `import.service.ts` — `strategyId: null`.

### Database changes
- **Additive only** — one nullable FK column + 3 nullable snapshot columns on `Trade`,
  and the Strategy↔Trade relation. No existing column changed. Legacy trades read back
  with a null strategy (no snapshot), exactly as before.

### Verification
- Integration test covering: snapshot captured (name/version/entry-model order),
  foreign strategyId dropped, rename+version-bump frozen, soft-delete keeps the
  snapshot and drops the live link. tsc + eslint clean; 122 tests pass.

### Coordination note (Strategy Lab Phase 7 — now DONE)
Strategy Lab Phase 7 (`docs/STRATEGY_LAB.md`) built the strategy→journal views on
top of `Trade.strategyId`: a reference panel in the trade form (assets / entry
models / framework / trade-management — never Arsenal) and a strategy chip on the
trade card. It also **froze the strategy snapshot** — `buildTradeSnapshots` now
keeps the snapshot untouched while the selection is unchanged (only recomputing
when the strategy is actually changed), fixing a bug where editing a trade whose
strategy had been renamed/deleted would overwrite or wipe the historical snapshot.

## ✅ Phase 5 — Polish extras (DONE)

The three items previously deferred as placeholders, now real.

### Completed work
- **Persisted trade number** (`Trade.tradeNumber`, `@@unique([userId, tradeNumber])`):
  a stable per-user counter assigned at create as `MAX(tradeNumber)+1` (raw query, so
  soft-deleted rows still reserve their number — numbers never shift or repeat, unlike
  the old derived ordinal). Legacy rows backfilled by creation order. The workspace
  header uses it (falling back to the derived ordinal only if somehow null).
- **Materialized `status`** (`TradeStatus` enum OPEN/CLOSED/REVIEWED, `@@index`):
  derived from `closedAt`/`reviewedAt` by the pure `deriveStatus` and written at every
  write path (create / edit / inline section), so status is a fast indexed column
  instead of a per-render computation. A trade must be closed to count as reviewed.
- **Strategy-adherence self-scoring**: five fixed keyed questions
  (`domain/trades/adherence.ts`), answered Yes/No inline in the workspace. The panel is
  now interactive (autosaves the whole answer map through the section-patch action);
  the server sanitizes to known keys and recomputes the denormalized
  `adherencePercent` (scored over *answered* questions). Shown in the panel and the
  Trade Summary tile.

### Files changed
- Schema: `Trade.tradeNumber`/`status`/`adherenceAnswers`/`adherencePercent` +
  `TradeStatus` enum + indexes. Migration `20260803162420_trade_polish_extras` (backfills
  tradeNumber by creation order and status from the lifecycle stamps).
- New: `src/domain/trades/adherence.ts` (+ test); `deriveStatus` added to
  `lifecycle.ts` (+ tests).
- `trades.service.ts` — `nextTradeNumber`; status + number set in create/update;
  status + adherence handled in `updateTradeSections`. `lib/validation/trades.ts` —
  `adherenceAnswers` on the section patch.
- `strategy-adherence-panel.tsx` rewritten as an interactive client component;
  `trade-review-section.tsx` passes answers; `trade-summary.tsx` shows the percent;
  workspace page maps real `status`/`tradeNumber`/adherence; the stale
  `STRATEGY_ADHERENCE_QUESTIONS` constant was removed from `types/trades.ts`.

### Database changes
- **Additive** — 4 columns + 1 enum + 2 indexes + 1 unique constraint on `Trade`.
  tradeNumber and status are backfilled in the migration; existing behaviour is
  preserved (status matches what was previously derived per render).

### Verification
- 11 new domain unit tests (deriveStatus + adherence) and an integration test
  (sequential trade numbers, OPEN/CLOSED/REVIEWED materialization, adherence 50% with
  unknown-key sanitization). tsc + eslint clean; 133 tests pass.

## Historical integrity (architectural requirement — honor in every phase)
A completed trade must never lose its context: strategy + version, entry model, market
context, the original idea, the execution, and the review. Snapshots (Phase 4) are how
a historical trade keeps showing the strategy version that existed when it was taken.
