# Strategy = Single Source of Truth — refactor tracker

**Resumable master tracker.** Read first. Records the roadmap, schema design, locked decisions,
and a per-phase log for the refactor that makes each **Strategy** fully self-contained and removes
the global **Trade Setup**.

## Why

Trade Setup (global Assets, Trading Sessions, Confluences, Execution Confirmations) duplicates what
belongs to a strategy. Every strategy should completely define how it is traded. So: move
sessions / confluences / execution-confirmations **into each strategy** (as rich, colored objects),
drop the global "Assets to Trade" (a strategy already lists its markets), remove Trade Setup, and
have **Add Trade** simply reference the selected strategy and record what was actually present —
which also yields a real **strategy-adherence / trade-quality** score.

## Locked decisions (from the user)

1. **Full migration.** Backfill existing trades onto the new strategy-scoped models and **drop the
   global `Asset` / `TradingSession` / `ChecklistItemDefinition`(CONFLUENCE|EXECUTION) tables**.
   Built additively first; the destructive backfill+drop is the **final phase** (P9) so the app stays
   functional and green throughout.
2. **Broader color.** Color extends beyond tag chips into section accents/headers where it helps —
   a deliberate, bounded evolution of the P0 monochrome+blue identity (Notion-with-more-color).
   A shared **TagColor** palette + one `Tag` component is the backbone.
3. **Keep both adherence measures.** The new confluence % + execution % + trade-quality score is
   added **alongside** the existing 8-question self-rating (not a replacement).

## Target: each strategy is self-contained

Name · Description · Markets/Assets (`applicableAssets String[]`, exists) · Timeframes (exists) ·
**Trading Sessions (new)** · Arsenal/Concepts (exists) · Framework (exists) ·
**Confluences (new, rich)** · **Execution Confirmations (new, rich)** · Trade Management/Rules (exists) · Notes.

Add Trade: pick strategy → auto-load its sessions / confluences / execution → **multi-select** what
was present → record selected **and** the strategy's expected set → score adherence.

## Data model

### New enums
```
enum TagColor { GRAY BLUE GREEN AMBER RED PURPLE YELLOW TEAL }   // ~Notion palette
enum StrategyChecklistKind { CONFLUENCE EXECUTION }
```

### New strategy-scoped models (rich + colored)
```
model StrategyChecklistItem {           // unified confluences + execution confirmations
  id, userId, strategyId (Strategy, onDelete Cascade)
  kind        StrategyChecklistKind
  name        String
  color       TagColor  @default(GRAY)
  icon        String?                    // optional lucide icon name
  category    String?
  description String?
  weight      Int?                       // optional probability weight (future scoring)
  enabled     Boolean   @default(true)
  sortOrder   Int       @default(0)
  createdAt, updatedAt, deletedAt
  @@index([userId, strategyId, kind, sortOrder])
}

model StrategySession {
  id, userId, strategyId (Strategy, onDelete Cascade)
  name        String
  color       TagColor  @default(GRAY)
  startMinutes Int?     // minutes-since-midnight, optional
  endMinutes   Int?
  enabled     Boolean   @default(true)
  sortOrder   Int       @default(0)
  createdAt, updatedAt, deletedAt
  @@index([userId, strategyId, sortOrder])
}
```
Strategy gains `checklistItems StrategyChecklistItem[]` + `sessions StrategySession[]`. The
`StrategyVersion.snapshot` JSON (P2) starts including these so published versions freeze them.

### Trade changes (additive; old fields kept until P9)
```
assetSymbol   String?     // denormalized market symbol (backfilled from asset.symbol); becomes the
                          // source of truth once the global Asset FK is dropped in P9.
// Strategy-execution snapshot — frozen at write time so adherence is recomputable + immutable:
strategyExecutionSnapshot Json?   // { sessions:[{name,color}], confluences:[{name,color,category,weight}],
                                  //   execution:[{name,color}] } — the strategy's EXPECTED set that day
selectedSession           String? // chosen session name
selectedConfluences       Json?   // string[] of chosen confluence names
selectedExecution         Json?   // string[] of chosen execution-confirmation names
confluencePercent         Float?  // selected / expected  (indexed via column for analytics)
executionPercent          Float?
tradeQualityPercent       Float?  // combined adherence-to-strategy quality (NOT a market prediction)
```
Rationale: snapshotting the expected set + the selections (by name, with color) makes the score
**immutable history** (strategy edits never change a past trade) and lets future analytics
(avg confluences on winners/losers, most-successful confluence, missing-on-losers, adherence over
time) be computed without another migration. The old `TradeChecklistSelection` / `sessionId` /
`assetId` FKs stay working until P9 backfills + drops them.

## Roadmap

```
NOTE — re-sequenced: **P4 (trade form) must precede P3 (remove Trade Setup)**. Removing the global
Trade Setup editors before the trade form stops reading the globals would leave new users with
empty asset/session/confluence/execution dropdowns (broken trade creation). So the order is now
P4 → P3.

P0  Tracker + design (this doc) ......................... ▶ in progress
P1  Additive data model + migration (new models, Trade
    fields; nothing removed) ............................ ⭘ next
P2  Strategy Lab: Sessions / Confluences / Execution
    editors (rich, colored) + snapshot .................. ⭘
P4  Trade form: strategy-driven, multi-select ........... ✅ (P4a + P4b)
P4c Strategy-source asset+session; delete Trade Setup .... ✅ (require strategy; watchlist dropped)
P5  Adherence & trade-quality scoring (pure, tested) .... ✅ (scorer built + 5 tests)
P6  Display scores + colored selected tags .............. ✅
P3  Remove global confluence/execution editors .......... ✅ (asset/session editors now gone too)
P7  Colored Tag system everywhere + broader accents ..... ✅
P8  Analytics foundations ............................... ✅
P9  Full migration: backfill assetSymbol; drop Asset/
    TradingSession/ChecklistItemDefinition + assetId/
    sessionId/watchlistFocus; delete dead read services ... ✅
P10 Polish, tests, full verify .......................... ✅ — REFACTOR COMPLETE
```

Every phase: `tsc` + `eslint` clean, vitest green, app runnable, follows the design system
(docs/design-system.md — note the identity is now monochrome + Signal Blue + colored tags, P0 of the
design foundation). Env note: local Postgres reachable only via `127.0.0.1` (`.env` set); after a
migration the low-RAM dev server serves a stale Prisma client → `prisma generate` + clear `.next/dev`
+ restart. Related: [[strategy-lab-phased-build]], the earlier Trading-Plan removal, entry-models move.

## Progress log

### P0 — Tracker + design ✅
This document. Roadmap, schema, and the three locked decisions (full migration; broader color; keep
both adherence measures).

### P1 — Additive data model ✅
Purely additive — nothing removed, app functional. Added enums `TagColor`
(GRAY/BLUE/GREEN/AMBER/RED/PURPLE/YELLOW/TEAL) + `StrategyChecklistKind` (CONFLUENCE/EXECUTION);
models `StrategyChecklistItem` (unified confluences+execution: kind, name, color, icon, category,
description, weight, enabled, order) and `StrategySession` (name, color, start/endMinutes, enabled,
order) — both userId+strategy-scoped, soft-delete; Strategy gained `sessions` + `checklistItems`
relations. Trade gained `assetSymbol`, `strategyExecutionSnapshot`, `selectedSession`,
`selectedConfluences`, `selectedExecution`, `confluencePercent`, `executionPercent`,
`tradeQualityPercent` (all nullable). Migration `20260805040000_strategy_sot_additive` (create
enums/tables/columns + **backfill `assetSymbol` from `asset.symbol`**); client regenerated.
Verified: tsc + eslint clean, 176 tests green. No UI/logic uses the new fields yet (P2+). Old
global Asset/Session/Checklist + Trade FKs untouched (dropped in P9).

### P2 — Strategy Lab editors ✅
The new strategy-scoped models get their UI. Reusable **`Tag`** primitive + `TAG_STYLES` palette
(`components/ui/tag.tsx`) — full static Tailwind color classes, theme-aware; the backbone for P7.
`ColorPicker` (Base UI Select of swatches). Service `strategy-sot.service.ts` + actions
`strategy-sot.actions.ts` + validation `strategy-sot.ts` (CRUD + reorder, userId + strategy-scoped,
explicit `deletedAt` filters). Editors: **`StrategyChecklistSection`** (kind-parameterized — reused
for Confluences + Execution; rich form: name, color, category, weight, description, enable/disable)
and **`StrategySessionsSection`** (name, color, time range, enable/disable). Wired into the strategy
workspace as three new tabs (Sessions / Confluences / Execution) + loaded in `[strategyId]/page.tsx`.
Verified: tsc + eslint + impeccable detector clean; 176 tests (no domain logic touched). **Live
screenshot not captured** — the register→create-strategy→workspace authed flow exceeds the box's
time budget; verified statically. **Deferred:** including sessions/checklist in the
`StrategyVersion` snapshot (versions are a future integration — do it before P9).

### P4a — Strategy reference carries sessions/confluences/execution ✅
Re-sequenced P4 ahead of P3 (see NOTE above). Foundation for the trade-form rewire: extended
`getStrategyReference` + `StrategyReferenceDTO` to include the strategy's **enabled** `sessions`
(name+color), `confluences`, and `execution` (name+color+category+weight) — the exact data the
trade form will multi-select and snapshot as the "expected" set. Additive & safe (nothing consumes
it yet). tsc + eslint clean.

### P4b — Trade form rewire ✅
Add Trade is now strategy-driven. Picking a strategy loads its **enabled** confluences + execution
confirmations as **colored, multi-select** tag groups (new `StrategyTagSelect`, sourced from the
`strategyReference` already fetched for the form); the two old global `TagToggleGroup`s (which both
wrote the single `checklistItemIds` field) are gone. The form stores `selectedConfluences` /
`selectedExecution` as **name arrays**. `tradeSchema` swapped `checklistItemIds` → those two fields.

Save layer (`trades.service.ts` → `buildStrategyExecution`): freezes the strategy's expected set into
`strategyExecutionSnapshot` (kept across an edit while the strategy selection is unchanged, re-fetched
otherwise), stores the selected names, and scores adherence via the pure
`scoreStrategyAdherence` (P5 scorer, already tested) into `confluencePercent` / `executionPercent` /
`tradeQualityPercent`. Colors are **not** duplicated onto the selections — they're resolved at render
time from the snapshot's expected set (single source, compact record).

Wiring: `new` + `edit` pages drop the confluence/execution props; edit defaults read the new name
arrays (old trades start empty — re-picked from the strategy on edit). Display/export
(`trade-workspace.mapper.ts`, `export.service.ts`) read `selected*` with a **fallback to the legacy
`checklistSelections` join** for pre-SOT trades. Import passes CSV labels straight through as names
(dropped the global-checklist resolvers). `TagToggleGroup` now types `name: "entryModelIds"` only.

Verified: **tsc + eslint clean; 181 tests green** (5 new scorer tests). App compiles + runs.

**Deferred out of P4b (by design):**
- `assetSymbol` write-time denormalization → **folded into P9**, which backfills `assetSymbol` from
  `asset.symbol` for all trades wholesale. New trades keep the working global `assetId` FK meanwhile.
- Analytics' old process-adherence metric (`analytics.service.ts`, built from the global
  execution-confirmation join + `executionItemCount`) still reads the legacy join, so it reads 0 for
  new SOT trades. **Migrating it onto the new `executionPercent` column is P8.** The separate
  8-question `adherencePercent` is unaffected.
- Colored rendering of the selected tags + the adherence scores across the app is **P6** (the mapper
  currently returns plain `string[]` labels; colors come from the snapshot there).

### P6 — Display scores + colored selected tags ✅
The SOT record now surfaces visually everywhere a trade is shown. New shared bits:
- `SelectedTagDTO {name,color}` + `AdherenceScoresDTO` in `types/trades.ts`; `confluenceLabels` /
  `executionLabels` on both trade DTOs changed `string[]` → `SelectedTagDTO[]`, and the workspace DTO
  gained `confluencePercent` / `executionPercent` / `tradeQualityPercent` (list DTO gained
  `tradeQualityPercent`).
- **`resolveSelectedTags`** (`server/services/selected-tags.ts`) — the single color-resolution
  helper: maps a trade's selected **names** to colors from its frozen `strategyExecutionSnapshot`,
  falling back to the legacy checklist labels (neutral GRAY) for pre-SOT trades. Used by both the
  workspace mapper and the journal list mapper (no duplicated logic).
- **`AdherenceMeter`** (labeled thin bar, banded green/amber/rose ≥80/≥50/rest) + **`TradeQualityBadge`**
  (compact pill) in `components/journal/adherence-score.tsx`.

Wired: the workspace **Idea** section renders confluences as colored `Tag`s + a confluence meter; the
**Execution** section renders execution `Tag`s + an execution meter + a combined "Strategy adherence /
Trade quality" block. The **trade card** shows colored confluence/execution tags + a quality badge.
**Add Trade** shows a **live** adherence preview (Confluences / Execution / Trade quality meters)
recomputed with the same pure `scoreStrategyAdherence` as the trader multi-selects — exactly what the
save layer persists. Scores are labeled a discipline measure, **not a market prediction**.

Verified: **tsc + eslint clean; 181 tests green**. Static verification (authed screenshots time out on
this box). Analytics still on the legacy metric (**P8**); `assetSymbol` denorm still **P9**.

### P3 — Remove the global confluence/execution editors ✅
Confluences + execution confirmations are now strategy-scoped (SOT), so their **global** editors are
gone. Removed the two `ChecklistSection` cards from the Trade Setup page (`settings/plan`), deleted
the now-orphaned `components/plan/sections/checklist-section.tsx` + `actions/checklist-items.actions.ts`,
and trimmed `getTradeFormOptions` (dropped the two `listChecklistItems` calls + the unused
`confluenceItems`/`executionItems` returns). The page keeps **Assets to Trade** + **Trading Session**
(still the trade form's source) and gains a callout pointing confluences/execution to Strategy Lab;
settings hub + copy updated.

**Scope note (roadmap safety rule):** the page itself is **not** deleted and the asset/session global
editors **stay**, because the trade form still reads global `assets` (required `assetId` FK) + global
`sessions`. Fully removing Trade Setup requires strategy-sourcing the asset/session fields and bridging
the `assetId`/`sessionId` FKs (→ `assetSymbol` / `selectedSession`, columns already exist) — that FK
migration is bundled with **P9** (drop globals). `checklist-items.service.ts` is now dead but still
reads the live `ChecklistItemDefinition` table (old-trade fallback), so it's removed **with the table
in P9**, not here.

Verified: **tsc + eslint clean; 181 tests green**.

### P4c — Strategy-source asset + session; delete Trade Setup ✅
**User directive (post-P3):** in Add Trade the market **and** session must come from the selected
strategy, making the global Trade Setup lists redundant → delete them. Two product decisions taken:
**(1)** every trade now **requires a strategy**; **(2)** the Today **Watchlist-focus** feature (which
also rode the global Asset list) is **dropped**.

- **Schema** (`tradeSchema`): `assetId`→`assetSymbol` (required), `sessionId`→`selectedSession`
  (nullable), `strategyId` now **required** (`min(1)`). The service/import still accept an empty
  strategyId as "no strategy" (historical CSV imports), which `buildTradeSnapshots` already treats
  as none.
- **Form:** Strategy moved to the top as the gateway (required, no "None"). Asset is a dropdown of the
  strategy's `applicableAssets`; Session a dropdown of the strategy's sessions — both hint "select a
  strategy first" when empty, and keep a currently-selected value visible if the strategy's list later
  changed (`withSelected`). Dropped the global `assets`/`sessions` props from the form + new/edit pages.
- **Save path:** `resolveAssetLink` bridges the still-NOT-NULL `assetId` FK by find-or-creating the
  user's Asset row from `assetSymbol` (keeps analytics-by-asset working until P9); writes
  `assetSymbol` + `selectedSession`; leaves the legacy `sessionId` null. Display (workspace mapper +
  journal list) now reads `assetSymbol`/`selectedSession` with a fallback to the legacy FKs.
- **Import:** passes `assetSymbol` + session name straight through (no more global-row resolution);
  imported trades carry no strategy.
- **Watchlist dropped:** removed Today's Watchlist-focus UI + `TodaysPlanDTO.assets`/`watchlistFocus`,
  `JournalDayRecapDTO.plan.watchlistSymbols`, the `watchlistFocus` write path + validation, and the
  recap field. The `TradingDay.watchlistFocus` column is left dormant (dropped in P9).
- **Dashboard SessionCountdown** used the global session list — repointed to a new
  `listStrategySessionWindows` (union of the user's strategies' enabled, timed sessions, deduped by
  name), so it survives with no global list.
- **Deleted:** the Trade Setup page (`settings/plan`), `AssetsSection`, `TradingSessionsSection`,
  `assets.actions`, `trading-sessions.actions`; removed the Trade Setup nav (settings hub + topbar) and
  the global-search **Asset** category (linked to the deleted page). `getTradeFormOptions` slimmed to
  accounts + entry models + strategies.
- Now-dead read services `assets.service` / `trading-sessions.service` (+ `checklist-items.service`)
  still read live tables → removed **with the tables in P9**.

Verified: **tsc + eslint clean; 181 tests green**. Static verification (authed screenshots time out).

### P7 — Colored Tag system everywhere ✅
No more plain monochrome badges for tag-like properties. Added `colorForName(name)` to
`components/ui/tag.tsx` — a deterministic hash into the 7 vivid palette colors (GRAY reserved for
neutral/none), so a value like `NQ` gets the same hue everywhere. Confluences / execution / sessions
keep their **explicitly assigned** colors; free-text properties (assets, entry models, timeframes,
concepts) derive a stable color from the name.

Applied colored `Tag`s to: the Add-Trade **Strategy reference panel** (applicable assets + entry
models), the **trade card** (entry models — confluences/execution/quality already colored in P6), the
workspace **Idea** section (entry models + session, session using its assigned color) and **Header**
(asset + session), the Strategy Lab **asset-tag-input** (Settings `applicableAssets` chips) and
**strategy card** asset chips. `TradeWorkspaceDTO` gained `sessionColor` (resolved from the frozen
snapshot's sessions) so the session tag shows its real strategy color, falling back to `colorForName`.

Verified: **tsc + eslint clean; 181 tests green**. Remaining minor surfaces (timeframe / arsenal-concept
editor cards are structured editors, not badges) are left as **P10** polish.

### P8 — Analytics foundations ✅
Migrated analytics off the removed global checklist and laid the tested foundation for
strategy-adherence analytics.
- **Rule Adherence metric** (`analytics.service`) now reads each trade's frozen `executionPercent`
  (selected vs the strategy's expected execution) instead of the old
  `checklistSelections`-÷-global-`executionItemCount`. Dropped the `checklistItemDefinition.count`
  query + the `checklistSelections` include. The psychology `correlationWithRuleAdherence` follows
  automatically. Null for pre-SOT trades (excluded from averages).
- **New pure module** `domain/performance/adherence-analytics.ts` (+ 5 vitest cases): from per-trade
  points (`win`, selected `confluences`, the three frozen percents) it computes avg confluence /
  execution / trade-quality adherence, **avg confluence count on winners vs losers**, and a
  **per-confluence win-rate leaderboard** (deduped within a trade, ranked by win rate then volume).
  This is the "expand without a migration" backbone for future adherence analytics.
- Wired into `getAnalyticsData` under `trading.adherence` and surfaced on the Analytics page via a new
  **`AdherenceAnalytics`** card (5 stat tiles + colored confluence win-rate table). Labeled a
  discipline measure, not a prediction.

Verified: **tsc + eslint clean; 186 tests green** (+5).

### P9 — Full migration: drop the globals ✅
The final destructive phase. **Migration `20260807010000_drop_global_trade_setup`** backfills first
(while the old tables still exist), then drops:
- **Backfill:** `assetSymbol` from `Asset.symbol`; `selectedSession` from `TradingSession.name`;
  `selectedConfluences`/`selectedExecution` (by name) from the `TradeChecklistSelection` join for
  pre-SOT trades (SOT trades already carry arrays). A safety-net sets any still-null `assetSymbol` to
  `'UNKNOWN'` so the NOT NULL can apply.
- **Dropped:** tables `Asset`, `TradingSession`, `ChecklistItemDefinition`, `TradeChecklistSelection`;
  the `ChecklistType` enum; `Trade.assetId`/`sessionId` FKs; `TradingDay.watchlistFocus`. `assetSymbol`
  is now **NOT NULL** (the source of truth).
- **Code:** `tradeInclude` dropped asset/session/checklistSelections; the trade save path no longer
  bridges an Asset row (`tradeMarketData` just writes `assetSymbol`/`selectedSession`); mapper /
  analytics / export / import / accounts / search / dashboard / journal / edit all read the columns
  directly. Removed the three dead read services (`assets`, `trading-sessions`, `checklist-items`) and
  the dropped models from the soft-delete extension.

Verified: **tsc + eslint clean; 193 tests green**; migration applied + client regenerated. The app now
runs entirely on the strategy-scoped model with no global Trade-Setup tables. Only **P10** (final
polish + full verify) remains.

### P10 — Polish + full verify ✅ — REFACTOR COMPLETE
- **Deferred P7 coloring done:** timeframe cards + arsenal-concept cards now carry a `colorForName`
  colored dot next to the name, so every strategy element has visual identity (they're structured
  editors, not badges, so a dot rather than a chip).
- **Full verification:** `tsc` clean, `eslint src` clean, **193 tests green**, and a **production
  `next build` succeeds** — all 24 routes compile (and `/settings/plan` is correctly gone).

The Strategy = Single Source of Truth refactor is **complete end-to-end**: each strategy fully defines
how it's traded (markets · sessions · confluences · execution · framework · arsenal · trade
management); Add Trade is strategy-driven with live adherence + weighted setup scoring; scores + colored
tags surface across journal/analytics; and the global Trade-Setup tables are gone.

### Follow-up — version snapshots freeze the SOT data ✅
Closes the P2-deferred item. `buildSnapshot` + `strategyTreeInclude` now freeze the strategy's
**sessions + confluences/execution** (with weights, mandatory flags, validation criteria) into each
published `StrategyVersion`; the summary counts them (session/confluence/mandatory/execution), the
read-only snapshot view renders them as colored tags, and `restoreStrategyVersionAsNewStrategy`
recreates them. Snapshot fields are optional so legacy snapshots still read. Only richer analytics UI
remains as a purely optional future integration.
