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

## ✅ Phase 3 — Section 2: FRAMEWORK (DONE)

The decision process as an ordered, drag-and-drop sequence of steps. Live in the
Framework tab.

- **Schema**: `StrategyFrameworkStep` (title + two Tiptap rich-text Json fields,
  `description` and `notes`, plus sortOrder, soft-delete). Migration
  `20260802220316_add_framework_step`. `Strategy.frameworkSteps` uncommented;
  registered in `SOFT_DELETE_MODELS`. (Chose rich text for description/notes to
  match Arsenal and the Notion feel.)
- **Service / actions / validation** mirror Phase 2 exactly (`framework.service.ts`
  scoped via parent strategy, `framework.actions.ts`, `src/lib/validation/framework.ts`
  with `FRAMEWORK_RICH_FIELDS = ["description","notes"]`).
- **UI**: `FrameworkSection` (numbered, dnd-kit card reorder, inline add, empty
  state) + `FrameworkStepCard` — a gradient **number badge** (position, updates on
  reorder) + title input (autosaved) + expandable body with the two rich editors
  (same lazy-mount + local-field-cache pattern as Arsenal). Wired into
  `strategy-workspace.tsx` (Framework tab); steps loaded in the workspace page
  alongside concepts (`Promise.all`).
- **Duplicate**: `duplicateStrategy` now also deep-copies framework steps
  (verified: titles + rich-text description copy over).

Verified end-to-end (empty → add 3 → expand → Description autosave → persists on
reload → delete → duplicate deep-copies) with zero console errors; `tsc`, lint, 103
tests pass.

**Reuse note for the remaining phases:** `FrameworkStepCard`/`ArsenalConceptCard`
are near-identical (title/name input autosave + expandable rich fields + delete +
grip). If Timeframes/Entry Models want the same shape, consider factoring a shared
`ExpandableItemCard`, but only if it stays simpler than the duplication — don't
abstract prematurely.

---

## ✅ Phase 4 — Section 3: TIMEFRAME WORKSPACE (DONE)

The first two-level nested section: unlimited **timeframes**, each holding unlimited
**checkpoints**. Live in the Timeframes tab.

- **Schema**: `StrategyTimeframe` (name) 1→many `StrategyCheckpoint` (title + rich
  `description`/`notes`), both with sortOrder + soft-delete; cascade deletes down the
  tree. Migration `20260802223315_add_timeframe_workspace`; both registered in
  `SOFT_DELETE_MODELS`; `Strategy.timeframes` uncommented.
- **Service** (`timeframes.service.ts`): timeframe CRUD scoped via
  `strategy: { userId }`; checkpoint CRUD scoped via
  `timeframe: { strategy: { userId } }`. `listTimeframes` includes checkpoints
  (nested `where deletedAt:null` + order). Actions/validation mirror prior phases
  (`CHECKPOINT_RICH_FIELDS`). Checkpoint actions take `strategyId` (for revalidate)
  **and** the parent id.
- **UI**: `TimeframesSection` → `TimeframeCard` (name autosaved, expanded by default,
  checkpoint-count badge) → `CheckpointList` → `CheckpointCard` (title autosaved,
  expandable rich description/notes). **Two independent dnd-kit contexts** — one for
  timeframes, one per timeframe's checkpoints — so dragging at either level doesn't
  interfere (each grip drives only its own SortableContext). Add-inline + delete-
  confirm at both levels.
- **Duplicate**: `duplicateStrategy` now also deep-copies the nested tree —
  per source timeframe it `create`s the timeframe (to get the new id) then
  `createMany`s its checkpoints, all in the transaction. Verified.

Verified end-to-end (empty → add 2 timeframes → add checkpoints → expand → rich-text
autosave → persists on reload → delete checkpoint → duplicate deep-copies timeframes
+ checkpoints + rich text) with zero console errors; `tsc`, lint, 103 tests pass.

**Note:** nested dnd works because contexts are separate DOM subtrees with their own
grips; keep that pattern if any later section nests lists.

---

## ✅ Phase 5 — Section 4: ENTRY MODELS (DONE)

Multiple documented entry models per strategy. Single-level, structurally identical
to Arsenal. Live in the Entry Models tab.

- **Schema**: `StrategyEntryModel` — name + **7** rich-text Json fields (description,
  conditions, confirmationChecklist, invalidation, stopPlacement, targetLogic,
  notes), sortOrder, soft-delete. **Named `StrategyEntryModel`** to avoid colliding
  with the Journal's existing `EntryModel`. Migration
  `20260802230423_add_strategy_entry_model`; registered in `SOFT_DELETE_MODELS`.
- **Service / actions / validation** are the Arsenal shape, but the files are
  prefixed **`strategy-entry-models.*`** (service, actions, `src/lib/validation/`)
  to avoid colliding with the Journal's `entry-models.service.ts`/`.actions.ts`.
  `ENTRY_MODEL_RICH_FIELDS` drives both UI and duplicate.
- **UI**: `EntryModelsSection` + `EntryModelCard` (name autosaved, 7 expandable rich
  fields in a 2-col grid, dnd reorder, delete-confirm, deferred-images note). Wired
  into the Entry Models tab; loaded in the workspace page's `Promise.all`.
- **Duplicate**: `duplicateStrategy` now also `createMany`s entry models onto the
  copy (verified: name + rich text copy over).

Verified end-to-end (empty → add 2 → expand → autosave → persists on reload →
delete → duplicate deep-copies) with zero console errors; `tsc`, lint, 103 tests pass.

**Note:** `confirmationChecklist` is rich text for now; a future phase could make it
a real checkable list if desired.

---

## ▶️ Phase 6 — Section 5: TRADE MANAGEMENT (BUILD THIS NEXT — LAST SECTION)

How a trade is managed after entry. This is the **last workspace section**; it's a
1:1 record plus two child lists, not a card list. Don't touch Phases 1–5.

**Data model** — add and uncomment `Strategy.tradeManagement` (1:1) + two children:

```prisma
model StrategyTradeManagement {
  id         String   @id @default(cuid())
  strategyId String   @unique
  strategy   Strategy @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  // rich-text (Tiptap JSON) fields:
  takeProfitPhilosophy Json?
  initialStopPlacement Json?
  breakEvenRules       Json?
  trailingStopRules    Json?
  scalingInRules       Json?
  scalingOutRules      Json?
  // structured limits:
  maxHoldingTime   String?   // free text (e.g. "2 hours", "1 session")
  maxRiskPercent   Decimal?  @db.Decimal(6, 2)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  partialTakeProfits PartialTakeProfit[]
  customRules        TradeManagementRule[]
}

model PartialTakeProfit {
  id                 String @id @default(cuid())
  tradeManagementId  String
  tradeManagement    StrategyTradeManagement @relation(fields: [tradeManagementId], references: [id], onDelete: Cascade)
  trigger         String?   // e.g. "at 2R", "prior day high"
  percentToClose  Decimal?  @db.Decimal(5, 2)
  reason          String?
  sortOrder Int       @default(0)
  deletedAt DateTime?
  @@index([tradeManagementId, deletedAt, sortOrder])
}

model TradeManagementRule {
  id                 String @id @default(cuid())
  tradeManagementId  String
  tradeManagement    StrategyTradeManagement @relation(fields: [tradeManagementId], references: [id], onDelete: Cascade)
  text      String
  sortOrder Int       @default(0)
  deletedAt DateTime?
  @@index([tradeManagementId, deletedAt, sortOrder])
}
```

Register all three in `SOFT_DELETE_MODELS`. Approach:
1. `getOrCreateTradeManagement(userId, strategyId)` (lazy singleton, like the
   trading-plan upsert) so the section always has a row to edit.
2. Service/actions/validation prefixed `strategy-trade-management.*`. Top-level
   fields autosave (reuse `useDebouncedAutosave` for the rich fields via
   `RichTextEditor`, and a small form for maxHoldingTime / maxRiskPercent). Partial
   TPs and custom rules are add/edit/reorder/delete lists (custom rules can reuse
   the `SimpleListSection`-style pattern; partial TPs need trigger+percent+reason).
3. UI: replace the Trade Management `SectionPlaceholder` with `TradeManagementSection`.
4. Extend `duplicateStrategy`: copy the 1:1 record (create it, then its partial TPs +
   custom rules) in the transaction.

After this, **all five workspace sections are done** → next is **Phase 7: Journal
integration** (see below). Leave the app working, update this file, then stop.

---

## Later phases (design already accommodates them — no refactor needed)

- **Phase 6 — Trade Management**: see the spec above (this is the next build).
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
