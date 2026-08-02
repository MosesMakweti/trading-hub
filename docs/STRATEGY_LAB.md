# Strategy Lab — build log & phase plan

Strategy Lab is the trader's methodology workspace: design, document, version, and
refine complete trading strategies that the Journal can later reference. It is
**not** for recording trades.

This module is built in **resumable phases**. Each phase leaves the app fully
working. A new session should read this file, inspect the code, and continue from
the next unchecked phase **without rebuilding completed work**.

Route: `/strategy-lab` (list) and `/strategy-lab/[strategyId]` (workspace).
Nav: third item in the sidebar (`FlaskConical` icon), after Journal and My Accounts.

---

## Architecture (established in Phase 1 — reuse these patterns)

Layering matches the rest of the app:

- **DB**: `Strategy` is the hub model. Every future section attaches by
  `strategyId` with `onDelete: Cascade`. Soft-delete via `deletedAt` (registered
  in `src/server/db.ts` `SOFT_DELETE_MODELS`); **Archive is a status, Delete sets
  `deletedAt`**. `version Int` is the anchor for future version history.
- **Service** (`src/server/services/strategies.service.ts`): the only Prisma layer.
  Every fn takes `userId` first and scopes every query by it. Writes use
  `updateMany({ where: { id, userId } })` so a tenant can't touch another's rows.
- **Actions** (`src/actions/strategies.actions.ts`): `"use server"`, Zod-validate,
  call one service fn, `revalidatePath`. `create`/`duplicate` return the new `id`.
- **Validation** (`src/lib/validation/strategies.ts`): Zod schemas + the
  `z.input` / `z.infer` form-values split for RHF.
- **Types** (`src/types/strategies.ts`): `StrategyDTO` (dates as ISO strings) is
  what server components pass to client components.
- **UI** (`src/components/strategy-lab/*`): dark glass, Motion stagger, existing
  primitives (Badge, Dialog, DropdownMenu, Tabs, ConfirmDialog, EmptyState).

**Reusable pieces to build on:**
- `useDebouncedAutosave` (`src/hooks/use-debounced-autosave.ts`) — generic
  debounced autosave returning a `SaveState`. Every future section editor should
  use this.
- `SectionPlaceholder` (`src/components/strategy-lab/section-placeholder.tsx`) —
  the documented placeholder shown in each not-yet-built workspace tab. Replace a
  placeholder with the real section component when its phase lands; the tab wiring
  in `strategy-workspace.tsx` stays the same.
- `StrategyStatusBadge` + `STRATEGY_STATUS_META/ORDER` — status → label/variant.
- `AssetTagInput` — chip editor for symbol lists.

---

## ✅ Phase 1 — Foundation (DONE)

Schema, navigation, strategy list, full CRUD, duplicate, and strategy settings.

- **Schema**: `Strategy` model + `StrategyStatus` enum (DRAFT/TESTING/LIVE/ARCHIVED),
  `applicableAssets String[]`, `version`, `sortOrder`, `deletedAt`. Migration
  `20260802195933_add_strategy_lab`. Commented Phase 2+ relations live on the model.
- **List page** (`/strategy-lab`): searchable, status-filterable card grid; empty
  state; `CreateStrategyDialog`. Cards show name, status badge, description, asset
  chips, updated date, and a `⋯` menu (Open / Duplicate / Rename / Archive / Delete)
  + an Open button. Delete is confirm-gated; Archive toggles to Restore.
- **Workspace** (`/strategy-lab/[strategyId]`): header (back, live title, status
  badge) + a 6-tab shell. **Settings tab is fully live** (name, description,
  applicable-assets tag input, status — all autosaved via `useDebouncedAutosave`
  with a Saving/Saved/Failed indicator). The other five tabs render
  `SectionPlaceholder`s documenting their phase.
- **Duplicate**: `duplicateStrategy` copies top-level fields as a new `DRAFT`
  named `"… (copy)"`, inside a `$transaction` with a marked extension point where
  future nested-section deep-copies plug in (so duplication stays atomic).

Verified end-to-end in the browser (create → workspace → autosave → placeholders →
list reflects saved data → duplicate → rename → archive → delete). `tsc`, lint,
and the full test suite pass.

### Known intentional deferrals from Phase 1
- **List drag-and-drop reorder**: `sortOrder` + `reorderStrategies` service exist;
  the list DnD UI is deferred (order is `sortOrder` then `updatedAt`). Wire the
  existing `SortableList` when desired.
- **Global command-palette search**: Phase 1 search is the on-page filter only.
  Strategies can be added to `src/actions/search.actions.ts` later.
- **Rich-text description**: description is plain text (it's a card preview). The
  rich-text-heavy fields live in the nested sections (Phase 2+).

---

## ✅ Phase 2 — Section 1: ARSENAL (DONE)

The trader's toolbox of concepts, live in the workspace's Arsenal tab.

- **Schema**: `ArsenalConcept` (8 rich-text Json fields — definition, purpose,
  howIIdentify, whyItMatters, whenIUse, whenIIgnore, examples, personalNotes —
  plus name, sortOrder, soft-delete). Migration `20260802212245_add_arsenal_concept`.
  `Strategy.arsenalConcepts` relation uncommented; registered in `SOFT_DELETE_MODELS`.
- **Service** (`arsenal.service.ts`): list/create/update/archive/reorder, all scoped
  to the user **through the parent strategy** (`strategy: { userId }`) since concepts
  have no `userId`. `updateArsenalConcept` maps a cleared rich field (`null`) to
  `Prisma.DbNull`.
- **Actions** (`arsenal.actions.ts`): revalidate `/strategy-lab/[id]`.
- **Validation** (`src/lib/validation/arsenal.ts`): create (name), partial update
  (name + any rich field), reorder. Exports `ARSENAL_RICH_FIELDS` (the ordered key
  list, reused by the UI and duplicate logic).
- **UI**: `ArsenalSection` (dnd-kit **card-styled** reorder — not the compact
  `SortableList` — inline add, empty state) + `ArsenalConceptCard` (name autosaved via
  `useDebouncedAutosave`; expandable body lazy-mounts 8 `RichTextEditor`s, each
  autosaving its own field; delete confirm-gated). Card keeps a local copy of each
  field so a collapse→expand remount shows the latest saved content without a page
  refresh. Wired into `strategy-workspace.tsx` (Arsenal tab) with concepts loaded in
  the workspace page.
- **Duplicate**: `duplicateStrategy` now `include`s live concepts and `createMany`s
  them onto the copy inside the same transaction (verified: name + rich-text content
  copy over).

Verified end-to-end (empty state → add → expand → rich-text autosave → persists on
reload → delete-confirm → duplicate deep-copies the concept & its content). `tsc`,
lint, 103 tests pass.

### Notes for later
- Concept **name** is an editable `<input>` (not static text) — tests read it via the
  `Concept name` textbox role, not `getByText`.
- **Charts / images** per concept are deferred (UploadThing is deferred app-wide);
  the card shows a note. Add an `ArsenalConceptImage[]` relation when hosting lands.
- Rich text uses the shared `RichTextEditor` (`prose-invert`) — a pre-existing
  light-mode prose-contrast quirk affects all rich text app-wide, out of scope here.

---

## ▶️ Phase 3 — Section 2: FRAMEWORK (BUILD THIS NEXT)

The decision process as an ordered, drag-and-drop sequence of steps. Don't touch
Phases 1–2.

**Data model** — add and uncomment `Strategy.frameworkSteps`:

```prisma
model StrategyFrameworkStep {
  id          String   @id @default(cuid())
  strategyId  String
  strategy    Strategy @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  title       String
  description String?  // plain text (or Json? for rich text, to match Arsenal)
  notes       String?
  sortOrder   Int       @default(0)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?
  @@index([strategyId, deletedAt, sortOrder])
}
```

Register in `SOFT_DELETE_MODELS`. Then mirror Phase 2's shape exactly:
1. `framework.service.ts` (scoped via parent strategy), `framework.actions.ts`.
2. Validation in `src/lib/validation/framework.ts`.
3. UI: replace the Framework `SectionPlaceholder` with a `FrameworkSection`. Steps
   are simpler than Arsenal concepts (title + description + notes) — a numbered,
   reorderable list. Reuse the dnd-kit pattern from `arsenal-section.tsx` (or the
   compact `SortableList` since steps are small) and `useDebouncedAutosave`.
4. Extend `duplicateStrategy`: `include` `frameworkSteps` and `createMany` them onto
   the copy in the same transaction (next to the Arsenal copy).

Leave the app working. Update this file. Then stop.

---

## Later phases (design already accommodates them — no refactor needed)

- **Phase 3 — Framework**: see the spec above (this is the next build).
- **Phase 4 — Timeframes**: `StrategyTimeframe` (name) → `StrategyCheckpoint`
  (title, description, notes, images) one-to-many. Replace the Timeframes placeholder.
- **Phase 5 — Entry Models**: `StrategyEntryModel` (name, description, conditions,
  confirmationChecklist, invalidation, stopPlacement, targetLogic, images, notes).
  Replace the Entry Models placeholder.
- **Phase 6 — Trade Management**: `StrategyTradeManagement` (1:1 — TP philosophy,
  stop/BE/trailing/scaling rules, max hold, max risk) + `PartialTakeProfit`
  (trigger, percentToClose, reason) + `TradeManagementRule` (custom rules).
  Replace the Trade Management placeholder.
- **Phase 7 — Journal integration**: add `strategyId String?` to `Trade` →
  `Strategy` (reference, not copy). Add a Strategy selector to the trade form; on
  select, auto-populate Applicable Assets, Entry Models, Framework, and Trade
  Management rules. **Do NOT auto-populate Arsenal / "Relevant Concepts"** — the
  Journal references the strategy, it does not duplicate its knowledge base.

Each of the above: add model(s) → register soft-delete → service → actions →
replace the tab's placeholder with the real section → extend `duplicateStrategy`
to deep-copy the new rows in the same transaction → verify → update this doc.

## Future integrations the architecture already supports
AI strategy assistant · backtesting · win-rate/RR/psychology **by strategy**
(join on `Trade.strategyId`) · strategy version history (via `Strategy.version` +
a future `StrategyVersion` snapshot) · playbooks · knowledge graph · video/PDF
attachments · pattern library.
