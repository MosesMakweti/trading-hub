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
P0  Tracker + design (this doc) ......................... ▶ in progress
P1  Additive data model + migration (new models, Trade
    fields; nothing removed) ............................ ⭘ next
P2  Strategy Lab: Sessions / Confluences / Execution
    editors (rich, colored) + snapshot .................. ⭘
P3  Remove Trade Setup page + global editors; nav ....... ⭘
P4  Trade form: strategy-driven, multi-select ........... ⭘
P5  Adherence & trade-quality scoring (pure, tested) .... ⭘
P6  Display scores across the app ....................... ⭘
P7  Colored Tag system everywhere + broader accents ..... ⭘
P8  Analytics foundations ............................... ⭘
P9  Full migration: backfill + drop globals + cleanup ... ⭘
P10 Polish, tests, full verify .......................... ⭘
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
global Asset/Session/Checklist + Trade FKs untouched (dropped in P9). Next: P2 Strategy Lab editors.
