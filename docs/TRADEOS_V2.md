# TradeOS V2 — Workflow Refactor (master tracker)

TradeOS (the Trading Hub app) is being refactored from a *journal + tools* into a
**trader's operating system** that guides one full cycle:

> **Preparation → Planning → Execution → Reflection → Analysis → Improvement**

This is a **phased, framework-first, resumable** refactor. Read this file to resume:
each phase records what shipped and names the next phase. **The app must be fully
functional and all tests green after every phase — never leave it broken.**

Rules for every phase:
- Reuse existing components/services; compose, don't duplicate.
- Keep the existing dark-glass design system and the strict layered architecture.
- Strong TypeScript, `userId`-scoped services, additive/nullable migrations.
- Each phase ends with a **Progress Report** (completed · files changed · DB changes ·
  routes · remaining · next phase) appended to this file, then **STOP**.

---

## Roadmap

```
Phase 0  Architecture Review .................... ✅ DONE (this document)
Phase 1  Dashboard Framework .................... ▶ NEXT
Phase 2  Today Workspace Framework  (+ TradingDay backbone)
Phase 3  Morning Preparation
Phase 4  Today's Trading Plan
Phase 5  Trade Workspace  (Idea → Execution → Review) + Daily Analytics
Phase 6  Automatic Journal Archiving
Phase 7  Journal Redesign
Phase 8  Trade Gallery
Phase 9  Advanced Filters
Phase 10 Edge Workspace — Weekly Review
Phase 11 Polish
```

Target workflow the product should guide the trader through:

```
Dashboard → Today → Morning Preparation → Today's Trading Plan
   → Trade Idea → Trade Execution → Trade Review → Daily Analytics
   → (auto) Journal Archive → Journal → Weekly Edge Review
```

---

## Phase 0 — Architecture Review (✅ DONE)

### Stack & layered architecture (KEEP — it's solid)
Next.js 16 App Router · TypeScript · Tailwind v4 · shadcn/Base UI · Prisma 7 +
PostgreSQL · Auth.js. Strict layering, all reusable as-is:

- `src/domain/*` — pure, framework-free, unit-tested (metrics, scoring, rr, lifecycle,
  adherence, strategy diff/patterns…).
- `src/server/services/*` — the only Prisma layer; every fn takes `userId` first;
  soft-delete Prisma extension in `server/db.ts` auto-filters `deletedAt` on
  find/list/count (NOT nested includes — spell those out).
- `src/actions/*` — `"use server"`, Zod-validated, `revalidatePath`.
- `src/components/*` — UI by feature area; `ui/` + `shared/` are cross-cutting.
- `src/server/guards.ts` — `requireUser()` is the only session→userId boundary.

### Existing routes / modules (the `(app)` group, sidebar shell)
| Route | Module | Notes |
|---|---|---|
| `/dashboard` | Dashboard | Welcome, session countdown, plan excerpt, today's journal count, daily notes, KPIs, equity curve, recent trades, psych notes. **Refactor in Phase 1.** |
| `/journal` | Journal | Calendar (month/year) **+ embedded `AnalyticsDashboard`** (there is **no** `/analytics` route). **Redesign in Phase 7.** |
| `/journal/[date]` | Journal day | Daily notes + trade list. |
| `/journal/[date]/trades/[tradeId]` | **Trade Workspace** | Case file: Header · Idea · Execution · Review · Timeline · Attachments · Summary · adherence. **Heavily reused in Phase 5.** |
| `/journal/[date]/trades/new` · `…/edit` | Trade form | RHF+Zod, strategy selector + reference panel. |
| `/strategy-lab` (+ `/[id]`, `/[id]/versions/[v]`, `/patterns`) | Strategy Lab | Feature-complete (Arsenal, Framework, Timeframes, Entry Models, Trade Management, Performance, Versions, Pattern Library). **Leave alone; integrate.** |
| `/accounts` | My Accounts | TradingAccount CRUD, derived metrics. |
| `/settings/plan` | Trading Plan | Pre-Session Routine, Strategy Framework, Profit/Stop rules, Risk mgmt, Assets, Entry Models, Sessions, Checklists, Psych Anchors. **Source for Morning Prep / Today's Plan.** |
| `/settings/data` | Data | CSV/XLSX/JSON export + import. |

### Data models (Prisma) — reuse
`User`, `TradingPlan` (Json routine/framework/rules + risk numbers), `Asset`,
`EntryModel`, `TradingSession`, `PsychologicalAnchor`, `ChecklistItemDefinition`,
`TradingAccount`, `DailyNote` (unique `userId+date @db.Date`), **`Trade`** (rich:
workspace fields, lifecycle stamps `closedAt/reviewedAt`, `status`, `tradeNumber`,
`strategyId` + snapshots, `adherenceAnswers/Percent`), `TradeAccountAllocation`,
`TradeImage` (category enum, UploadThing url/key — **uploads still stubbed app-wide**),
`PsychologyQuestionnaireResponse`, `Strategy` tree + `StrategyVersion`.

### Reusable components & patterns (compose these — do NOT rebuild)
- **UI kit**: `components/ui/*` (Button, Select, Tabs, Input, Textarea, Badge, Sidebar…),
  `components/shared/*` (`FadeIn`/`Stagger` motion, `EmptyState`, `ConfirmDialog`,
  `CommandCenter`, `ThemeToggle`), design tokens (brand gradient, `glass`, `shadow-glow`).
- **Editors/inputs**: `RichTextEditor` (Tiptap, autosaves), `useDebouncedAutosave`,
  `TagToggleGroup`, `SortableList`/dnd-kit, `SimpleListSection`, `tiptapToPlainText`.
- **Trade Workspace sections** (`components/journal/workspace/*`): `TradeIdeaSection`,
  `TradeExecutionSection`, `TradeReviewSection`, `StrategyAdherencePanel`,
  `TradeTimeline`, `WorkspaceSection` (timeline-rail scaffold). **← the heart of Phase 5.**
- **Analytics**: `analytics.service` (Performance-Account contribution % is the single
  source of truth), `domain/performance/*` metrics, `AnalyticsDashboard`, `KpiCard`,
  `EquityCurveChart`, `SessionCountdown`, `getStrategyPerformance`.
- **Journal**: `JournalCalendar`, `YearView`, `DailyNoteEditor`, `TradeCard`, `TradeForm`.

### Gap analysis — workflow step → what exists
| Workflow step | Status | Plan |
|---|---|---|
| Dashboard | exists, ad-hoc | **Refactor** into a framework (P1) |
| **Today** workspace | **missing** | **New** module + routing + backbone (P2) |
| Morning Preparation | partial (static plan) | **New** per-day prep on top of `TradingPlan` (P3) |
| Today's Trading Plan | **missing** | **New** per-day plan: bias, watchlist focus, key levels (P4) |
| Trade Idea / Execution / Review | **exists** (Trade Workspace) | **Reuse** the workspace sections inside Today (P5) |
| Daily Analytics | partial (global only) | **New** day-scoped view reusing metrics (P5) |
| Auto Journal Archive | **missing** | **New** finalize-day mechanism (P6) |
| Journal | exists | **Redesign** (P7) |
| Trade Gallery | **missing** | **New** (P8) |
| Advanced Filters | **missing** | **New** (P9) |
| Weekly Edge Review | **missing** | **New** module reusing analytics + strategy perf (P10) |

---

## Migration plan (reuse · refactor · build-new)

**Reuse unchanged**: the whole layered architecture, design system, `ui/`+`shared/`,
domain metrics, Trade Workspace section components, Strategy Lab, Accounts, Trading
Plan, Trade form, calendar, autosave/rich-text patterns.

**Refactor (additive, keep old working)**:
- Dashboard → a composable *framework* (P1): layout, cards, **Workflow Progress**,
  **Quick Actions**, **Performance Snapshot**. Old widgets fold into cards.
- Sidebar nav → add **Today** (and later Edge Review). Existing items stay.
- Journal → redesigned around the archived-day view (P7); the day route stays valid
  throughout.

**Build new**:
- **`TradingDay` backbone** (P2) — the central new relationship (see below).
- Today workspace routing + shared workflow state + section placeholders (P2).
- Morning Prep, Today's Plan, Daily Analytics, Auto-Archive, Trade Gallery, Advanced
  Filters, Weekly Edge Review (their phases).

### Central architecture decision — the `TradingDay` backbone
The product is **day-centric**, but today only `Trade` (by `tradeDate`) and `DailyNote`
are per-day; there's no record of the *workflow* for a day. Introduce **one** new model
in P2 and hang the workflow off it:

```
TradingDay  (unique [userId, date @db.Date])   // the "session" record for a day
  ├─ workflow state  (which steps completed: prep / plan / traded / reviewed / analyzed)
  ├─ status          ACTIVE | ARCHIVED          // archive = day finalized → Journal
  ├─ morning prep    (P3 — checklist ticks, market context, readiness)
  ├─ today's plan    (P4 — bias, watchlist focus, key levels, risk budget)
  └─ derived links:  Trades (existing, by date) · DailyNote (existing, by date)
```

Rationale: additive (existing `Trade`/`DailyNote` unchanged), one clean per-day anchor,
"archiving" is just `status = ARCHIVED`, and the Journal day view renders an archived
`TradingDay`. Start lean (Json/structured fields added per phase); **do not** model all
of prep/plan up front. `Trade Idea/Execution/Review` already live on `Trade` — TradingDay
does not duplicate them, it *orchestrates the workflow around them*.

---

## Phase plan (scope + stopping criteria)

Each phase: build only its slice, keep everything green (`tsc`, `eslint`, `vitest`),
append a Progress Report, STOP.

- **P1 — Dashboard Framework**: refactor `/dashboard` into a card-based framework with a
  **Workflow Progress** strip (Prep→Plan→Trade→Review→Analyze for *today*), **Quick
  Actions**, and a **Performance Snapshot** (reuse KPIs/equity). Reuse existing widgets as
  cards. No new models. *Done when*: dashboard reads as an OS home and links into the
  (still-journal-based) day; nothing regresses.
- **P2 — Today Workspace Framework**: new `/today` route + layout + workflow nav/stepper +
  shared state; **create the `TradingDay` model** (migration) + service/actions to
  get-or-create today; **placeholder** sections for Morning Prep · Today's Plan · Trade
  Idea · Trade Execution · Trade Review · Daily Analytics. Add **Today** to the sidebar.
  *Done when*: `/today` navigates all sections (placeholders), a `TradingDay` is created
  per day, routing/state correct.
- **P3 — Morning Preparation**: real section on top of `TradingPlan` (pre-session routine
  as tickable checklist for the day) + market-context notes + readiness. Persist on
  `TradingDay`.
- **P4 — Today's Trading Plan**: per-day plan (HTF bias, watchlist focus from Assets, key
  levels, risk budget from plan limits). Persist on `TradingDay`.
- **P5 — Trade Workspace + Daily Analytics**: wire the **existing** Trade Workspace
  sections into the Today flow (create/continue today's trades in-context) and add a
  **Daily Analytics** section (day-scoped metrics via existing analytics domain).
- **P6 — Automatic Journal Archiving**: finalize a day (`status=ARCHIVED`), snapshot the
  day summary, make it read-only in the Journal. Define the archive trigger (manual
  "End day" + auto on date rollover).
- **P7 — Journal Redesign**: journal as the archive of finalized `TradingDay`s (calendar
  → day recap), reusing analytics.
- **P8 — Trade Gallery**: grid/gallery of trades (images, key stats), entry to Advanced
  Filters.
- **P9 — Advanced Filters**: cross-cutting filter system (asset, strategy, status,
  psychology, adherence, date, R) over trades — reusable query/service.
- **P10 — Edge Workspace (Weekly Review)**: weekly aggregation reusing analytics +
  `getStrategyPerformance`; guided weekly reflection.
- **P11 — Polish**: motion, empty/loading states, a11y, responsive, consistency pass.

---

## Progress log

### Phase 0 — Architecture Review ✅
- **Completed**: full review of routes, models, services, domain, shared components;
  gap analysis vs the target workflow; migration plan (reuse/refactor/new); the
  `TradingDay` backbone decision; this roadmap + phase plan.
- **Files changed**: `docs/TRADEOS_V2.md` (new). No code, no schema, no route changes —
  the app is untouched and fully functional (151 tests green).
- **Database changes**: none.
- **Routes**: none.
- **Remaining work**: everything in P1–P11 above.
- **Next recommended phase**: **P1 — Dashboard Framework** (refactor `/dashboard` into a
  card framework with Workflow Progress + Quick Actions + Performance Snapshot; reuse
  existing widgets; no new models).
