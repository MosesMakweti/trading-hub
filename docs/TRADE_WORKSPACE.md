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
- Phase 2: move fields into sections with inline editing.
- Phase 3: the real lifecycle timeline.
- Phase 4: strategy references + historical snapshots.
- New fields surfaced as placeholders: planned entry/stop/target, market context,
  areas of interest, reason, actual entry/exit, execution notes, extra review prompts,
  adherence scoring, a persisted trade number, and a real status column.

---

## ▶️ Phase 2 — Move fields into their sections (BUILD THIS NEXT)

Make the workspace sections **editable in place** and add the new plan/execution/
review fields, so the workspace becomes the primary edit surface (the monolithic
`/edit` form can then be retired or kept as a fallback).

1. **Schema** (additive, nullable — safe): on `Trade` add plan fields (`plannedEntry`,
   `plannedStopLoss`, `plannedTarget` as `Decimal?`; `marketContext`, `areasOfInterest`,
   `reasonForTrade` as `String?`/`Json?`), execution fields (`actualEntry`,
   `actualExit` `Decimal?`; `executionNotes` `String?`), and review fields
   (`whatWentWell`, `whatWentWrong`, `whatSurprisedMe`, `wouldTakeAgain` `String?`/
   `Boolean?`). Optionally a real `status` enum + a persisted `tradeNumber`. Migration.
2. Extend `tradeSchema`/`TradeInput` (`src/lib/validation/trades.ts`) and the trade
   service create/update to persist them.
3. Make each workspace section editable — reuse `useDebouncedAutosave` per section (or
   a per-section save action), and fill the placeholders wired in Phase 1 (they're
   already labelled and positioned). Keep `/edit` working during the transition.
4. Verify create + edit still round-trip; update this doc.

---

## Later phases

- **Phase 3 — Trade Timeline**: capture/derive per-event timestamps (idea saved,
  executed, closed, reviewed) and render the full vertical timeline (replace the
  minimal `trade-timeline.tsx`). May need a lightweight `TradeEvent` log or derived
  transitions from status changes.
- **Phase 4 — Strategy integration + historical snapshots**: add `Trade.strategyId`
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
