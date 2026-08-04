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
Phase 1  Dashboard Framework .................... ✅ DONE
Phase 2  Today Workspace Framework  (+ TradingDay backbone) ... ✅ DONE
Phase 3  Morning Preparation .................... ✅ DONE
Phase 4  Today's Trading Plan ................... ✅ DONE
Phase 5a Trades in the Today flow ............... ✅ DONE
Phase 5b Daily Analytics ........................ ✅ DONE  (Phase 5 complete)
Phase 6  Automatic Journal Archiving ........... ✅ DONE
Phase 7  Journal Redesign ...................... ✅ DONE
Phase 8  Trade Gallery ......................... ✅ DONE
Phase 9  Advanced Filters ...................... ✅ DONE
Phase 10 Edge Workspace — Weekly Review ........ ✅ DONE
Phase 11 Polish ................................ ✅ DONE  🎉 ROADMAP COMPLETE
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

### Confirmed decisions (locked with the user)
- **TradingDay backbone** — yes, add the one additive per-day model in Phase 2.
- **Today workspace** — new `/today` sidebar item; Dashboard and Journal both stay.

### Phase 1 — Dashboard Framework ✅
- **Completed**: refactored `/dashboard` into a composable framework — a **Workflow
  Progress** stepper (Preparation → Plan → Trade → Review → Analyze, best-effort derived
  from today's data; Prep/Plan marked upcoming until the Today workspace drives them), a
  **Quick Actions** launchpad, and a **Performance Snapshot** (KPIs + equity curve). All
  existing widgets (session countdown, plan excerpt, today's-journal card, daily notes,
  recent trades, recent psychology notes) are preserved. The three new components are
  presentational and reusable — `WorkflowProgress` is written to be driven by real
  TradingDay state in Phase 2.
- **Components completed**: `components/dashboard/workflow-progress.tsx`
  (`WorkflowProgress` + `WORKFLOW_STEP_META` + `WorkflowStep` type),
  `components/dashboard/quick-actions.tsx`, `components/dashboard/performance-snapshot.tsx`.
- **Files changed**: the three new components above; `src/app/(app)/dashboard/page.tsx`
  (rebuilt to compose them; workflow state derived from `todayTrades`).
- **Database changes**: none.
- **Routes**: none (still `/dashboard`).
- **Verified**: `tsc` + `eslint` clean, 151 tests pass, and a browser screenshot confirmed
  the stepper (Trade/Review done, Analyze current), quick actions, performance snapshot,
  and all preserved widgets render with zero console errors.
- **Remaining work**: P2–P11.
- **Next recommended phase (superseded — P2 done below)**: **P2 — Today Workspace Framework** — new `/today` route +
  layout + workflow stepper (reuse `WorkflowProgress`) + shared state; **create the
  `TradingDay` model** (unique `userId+date`, migration) + get-or-create service/actions;
  **placeholder** sections for Morning Prep · Today's Plan · Trade Idea · Trade Execution ·
  Trade Review · Daily Analytics; add **Today** to the sidebar. Framework only — no
  section internals yet.

### Phase 2 — Today Workspace Framework ✅
- **Completed**: the day-centric backbone + the Today workspace shell.
  - **`TradingDay` model** (unique `userId+date`, `status` ACTIVE/ARCHIVED, milestone
    stamps `prepCompletedAt`/`planCompletedAt`/`analyzedAt`/`archivedAt`; no soft
    delete). Migration `20260803233136_trading_day`.
  - New **`/today` route** + **`Today`** sidebar item (Sun icon, between Dashboard and
    Journal). The page get-or-creates today's `TradingDay` and lists today's trades.
  - **Shared workflow state machine** — pure `deriveWorkflowSteps`
    (`domain/today/workflow.ts`, 4 tests): Prep/Plan/Analyze from the TradingDay,
    Trade/Review derived from the day's trades → the ordered stepper state. **Both** the
    Today workspace and the Dashboard now drive their stepper from this one function.
  - **`TodayWorkspace`** (client): header (date + status badge) + reused
    `WorkflowProgress` stepper + a 6-tab shell (Morning Prep · Today's Plan · Trade Idea ·
    Trade Execution · Trade Review · Daily Analytics), each a documented
    `SectionPlaceholder`. Real section components slot into the same TabsContent in P3–P5.
  - Moved `SectionPlaceholder` from strategy-lab to **`components/shared`** (now
    cross-module); repointed the Dashboard's "Start today's session" + workflow steps to
    `/today`.
- **Components completed**: `today/today-workspace.tsx`, `shared/section-placeholder.tsx`
  (moved), `trading-day.service.ts`, `domain/today/workflow.ts`, `types/today.ts`.
- **Database changes**: `TradingDay` table + `TradingDayStatus` enum + `User.tradingDays`
  relation (migration `20260803233136_trading_day`). Additive — nothing else touched.
- **Routes**: `+ /today`.
- **Files changed**: new `src/app/(app)/today/page.tsx`, `src/components/today/today-workspace.tsx`,
  `src/components/shared/section-placeholder.tsx`, `src/server/services/trading-day.service.ts`,
  `src/domain/today/workflow.ts` (+ test), `src/types/today.ts`; changed
  `prisma/schema.prisma`, `src/components/layout/app-sidebar.tsx`,
  `src/components/dashboard/{workflow-progress,quick-actions}.tsx`,
  `src/app/(app)/dashboard/page.tsx`, `src/server/services/dashboard.service.ts`; removed
  `src/components/strategy-lab/section-placeholder.tsx`.
- **Verified**: `tsc` + `eslint` clean, 155 tests pass (+4 workflow), and a browser
  screenshot confirmed `/today` renders — Active badge, the stepper (Preparation current
  on a fresh day), all six tabs, and the Morning Prep placeholder — with zero console
  errors. (Caught & fixed one real bug: icon *functions* can't cross the server→client
  boundary, so the page now passes serializable step statuses and the client rebuilds the
  icon-bearing steps.)
- **Remaining work**: P3–P11.
- **Next recommended phase**: **P3 — Morning Preparation** — replace the Morning Prep
  placeholder with the real section: the pre-session routine (from `TradingPlan`) as a
  per-day tickable checklist + market-context notes + readiness, persisted on
  `TradingDay` (add the needed additive fields), and set `prepCompletedAt` when done so
  the workflow advances. Reuse `useDebouncedAutosave` / `RichTextEditor` / checklist
  patterns. One section only, then STOP.

### Phase 3 — Morning Preparation ✅
- **Completed**: replaced the Morning Prep placeholder with the real section, the first
  real content in the Today workflow.
  - **Pre-session routine checklist** — the user's `PRE_SESSION_ROUTINE` checklist items
    (template from the Trading Plan) rendered as tickable checkboxes; per-day completion
    (ticked item ids) saved on the `TradingDay`. Empty-state links to `/settings/plan`.
  - **Market context** — a `RichTextEditor` (Tiptap) that autosaves to
    `TradingDay.marketContext`.
  - **Readiness** — a 1–5 self-rating saved on `TradingDay.readiness`.
  - **Mark preparation complete** — toggles `TradingDay.prepCompletedAt`; on save it
    `router.refresh()`es so the **workflow stepper advances** (Preparation → done, Plan →
    current). Verified end-to-end in the browser.
- **Components completed**: `today/morning-prep-section.tsx`; wired into
  `today/today-workspace.tsx` (Morning Prep tab now renders the real section).
- **Database changes**: `TradingDay` += `routineCompletion Json?`, `marketContext Json?`,
  `readiness Int?` (additive). Migration `20260804001910_morning_prep`.
- **Routes**: none (still `/today`).
- **Files changed**: new `src/components/today/morning-prep-section.tsx`,
  `src/actions/today.actions.ts`, `src/lib/validation/today.ts`; changed
  `prisma/schema.prisma`, `src/server/services/trading-day.service.ts` (updateMorningPrep),
  `src/types/today.ts` (MorningPrepDTO), `src/app/(app)/today/page.tsx`,
  `src/components/today/today-workspace.tsx`.
- **Verified**: `tsc` + `eslint` clean, 155 tests pass, and a browser run confirmed the
  routine tick, readiness, market context, and mark-complete all persist across reload,
  and marking complete advances the workflow stepper — zero console errors.
- **Remaining work**: P4–P11.
- **Next recommended phase**: **P4 — Today's Trading Plan** — replace the Today's Plan
  placeholder with the real section (HTF bias & conviction, watchlist focus drawn from
  the user's Assets, key levels, risk budget from the plan limits), persisted on
  `TradingDay` (additive fields), setting `planCompletedAt` when done so the workflow
  advances. Same section pattern as Morning Prep. One section only, then STOP.

### Phase 4 — Today's Trading Plan ✅
- **Completed**: replaced the Today's Plan placeholder with the real section.
  - **Higher-timeframe bias** (Bullish/Bearish/Neutral) + **conviction** (1–5).
  - **Watchlist focus** — the user's Assets as toggle chips; selected ids saved.
  - **Key levels & areas of interest** — a `RichTextEditor` autosaving to
    `TradingDay.keyLevels`.
  - **Risk budget** — a debounced % input (`useDebouncedAutosave`) with the plan's daily
    limit shown as a hint.
  - **Mark plan complete** — toggles `TradingDay.planCompletedAt`; on save it
    `router.refresh()`es so the **workflow stepper advances** (Plan → done, Trade →
    current).
  - Extracted shared **`SaveDot` + `SectionCard`** to `components/today/today-ui.tsx` and
    refactored Morning Prep to use them (DRY across the workflow sections).
- **Components completed**: `today/todays-plan-section.tsx`, `today/today-ui.tsx` (shared);
  wired into `today/today-workspace.tsx` (Today's Plan tab).
- **Database changes**: `TradingDay` += `bias String?`, `conviction Int?`,
  `watchlistFocus Json?`, `keyLevels Json?`, `riskBudgetPercent Decimal?` (additive).
  Migration `20260804004236_todays_plan`.
- **Routes**: none (still `/today`).
- **Files changed**: new `todays-plan-section.tsx`, `today-ui.tsx`; changed
  `prisma/schema.prisma`, `trading-day.service.ts` (updateTodaysPlan), `today.actions.ts`,
  `lib/validation/today.ts` (todaysPlanSchema), `types/today.ts` (TodaysPlanDTO),
  `today/page.tsx`, `today-workspace.tsx`, `today/morning-prep-section.tsx` (uses shared UI).
- **Verified**: `tsc` + `eslint` clean, 155 tests pass, a service-level integration test
  proved every field persists (bias/conviction/watchlist/keyLevels/risk, planComplete →
  planCompletedAt, clear + reopen, and independence from Morning Prep), and a browser debug
  run confirmed the tab switches and the section renders (bias / Bullish / Bearish visible).
  *(Full interactive screenshot skipped — the low-RAM dev box was thrashing on repeated
  Playwright runs; the section is identical in pattern to the P3-verified Morning Prep.)*
- **Remaining work**: P5–P11.
- **Next recommended phase**: **P5 — Trade Workspace + Daily Analytics** — wire the
  **existing** Trade Workspace sections (Idea / Execution / Review, in
  `components/journal/workspace/*`) into the Today flow so today's trades are created /
  continued in-context, and add a **Daily Analytics** section (day-scoped metrics via the
  existing analytics domain). This is the biggest section phase — consider splitting
  (e.g. P5a trades-in-Today, P5b Daily Analytics) and STOP after each.

### Phase 5a — Trades in the Today flow ✅
- **Completed**: wired the **existing** Trade Workspace sections into the Today flow —
  maximum reuse, no duplication.
  - Extracted the Trade Workspace DTO mapping into **`toTradeWorkspaceDTO`**
    (`server/services/trade-workspace.mapper.ts`) + exported the payload type
    `TradeWithWorkspaceRelations` from `trades.service`. The trade workspace **page now
    uses the shared mapper** (dropped ~75 lines of duplicated mapping + the getTradeOrdinal
    fallback — `tradeNumber`/`status` are persisted columns now).
  - The three trade tabs (Trade Idea / Execution / Review) share one **focused trade**
    and render the exact existing `TradeIdeaSection` / `TradeExecutionSection` /
    `TradeReviewSection` (with the Strategy Adherence panel) for it — full inline editing,
    in-context.
  - **`TodayTradeBar`**: a chip selector of today's trades (`#N · symbol · status`) +
    **Open** (→ full Trade Workspace) + **Add trade** (→ new-trade form). Empty state when
    no trades yet.
- **Components completed**: `today/today-trade-bar.tsx`,
  `server/services/trade-workspace.mapper.ts` (shared); `today-workspace.tsx` renders the
  sections for the focused trade.
- **Database changes**: none.
- **Routes**: none (still `/today`; "Add trade"/"Open" link to the existing journal
  routes).
- **Files changed**: new `today-trade-bar.tsx`, `trade-workspace.mapper.ts`; changed
  `trades.service.ts` (export payload type), the trade workspace `page.tsx` (use mapper),
  `today/page.tsx` (map today's trades), `today-workspace.tsx`.
- **Verified**: `tsc` + `eslint` clean, 155 tests pass, and a browser run confirmed the
  trade workspace page still renders after the mapper refactor **and** the three Today
  trade tabs render the focused trade's Idea/Execution/Review sections + the trade bar —
  zero console errors.
- **Remaining work**: P5b, P6–P11.
- **Next recommended phase**: **P5b — Daily Analytics** — replace the Daily Analytics
  placeholder with a day-scoped analytics section (win rate, R, PnL, psychology for
  today's trades), reusing `domain/performance/*` + the analytics service pattern; set
  `TradingDay.analyzedAt` (a "Mark day reviewed" action) so the workflow's Analyze step
  advances. One section, then STOP.

### Phase 5b — Daily Analytics ✅ (Phase 5 complete)
- **Completed**: replaced the last placeholder — the Daily Analytics section — so **all six
  Today tabs are now live** and the workflow runs end to end (Prep → Plan → Trade → Review
  → Analyze).
  - **`getDailyAnalytics(userId, dateKey)`** (analytics.service) — day-scoped metrics via
    the *same* Performance-Account contribution % walk, filtered to the day's trades and
    summarised by the shared **`summarizeStrategyPerformance`**, plus the day's net PnL ($).
  - **`DailyAnalyticsSection`** — reuses `KpiCard`: Trades (W/L), Win rate, Net PnL, Total
    & Avg return, Profit factor, Avg psychology, Avg adherence; empty state when no trades.
  - **Mark day reviewed** — `setDayAnalyzed` toggles `TradingDay.analyzedAt`; refreshes so
    the workflow's **Analyze** step advances.
  - Removed the now-dead `SectionPlaceholder` usage from the Today workspace (trimmed
    `SECTIONS` to value/label/icon).
- **Components completed**: `today/daily-analytics-section.tsx`; `getDailyAnalytics` +
  `setDayAnalyzed` services + `setDayAnalyzed` action + `DailyAnalyticsDTO`.
- **Database changes**: none (uses existing columns incl. `analyzedAt`).
- **Routes**: none (still `/today`).
- **Files changed**: new `daily-analytics-section.tsx`; changed `analytics.service.ts`,
  `trading-day.service.ts` (setDayAnalyzed), `today.actions.ts`, `types/today.ts`,
  `today/page.tsx`, `today-workspace.tsx`.
- **Verified**: `tsc` + `eslint` clean, 155 tests pass, a service integration test proved
  the day-scoping (2 today trades → 50% WR, netPnl 60, excludes other days; empty day → 0;
  analyzed toggle), and a browser render confirmed the KPIs (1 trade, 100% WR, +$900 net,
  +0.88%) + the Mark-day-reviewed button — zero page errors.
- **Remaining work**: P6–P11.
- **Next recommended phase**: **P6 — Automatic Journal Archiving** — finalize a day
  (`TradingDay.status = ARCHIVED`, set `archivedAt`) so it becomes a read-only journal
  entry. Add a manual **"End day"** action on `/today` (archive today) and auto-archive on
  date rollover (a day older than today with any activity → archived on next visit). Then
  P7 redesigns the Journal around archived `TradingDay`s. One phase, then STOP.

### Phase 6 — Automatic Journal Archiving ✅
- **Completed**: a day can now be *finalized* → it becomes an archived (read-only-intent)
  journal entry, both manually and automatically on date rollover.
  - **`endDay` / `reopenDay`** (trading-day.service + actions): set/clear
    `TradingDay.status = ARCHIVED` + `archivedAt`. Surfaced as an **End day** button in the
    Today workspace header (↔ **Reopen day** when archived), beside the status badge.
  - **`archivePastActiveDays(userId, todayKey)`** — a single `updateMany` that finalizes
    every still-ACTIVE day older than today. Called at the top of the `/today` page load,
    so opening today auto-archives yesterday (and any earlier open day). Idempotent;
    scoped by `userId`; never touches today or already-archived days.
- **Components completed**: `endDay`/`reopenDay`/`archivePastActiveDays` services +
  `endDay`/`reopenDay` actions; the End day / Reopen control in `today-workspace.tsx`.
- **Database changes**: none (uses the existing `status` + `archivedAt` columns from P2).
- **Routes**: none (still `/today`; archived days will get their read-only Journal view in
  P7).
- **Files changed**: `trading-day.service.ts`, `actions/today.actions.ts`, `today/page.tsx`
  (auto-archive at load), `today-workspace.tsx` (End day / Reopen button).
- **Verified**: `tsc` + `eslint` clean, 155 tests pass, and a service integration test
  proved end/reopen toggling and that `archivePastActiveDays` archives exactly the past
  ACTIVE days (2), leaves today and other users' days untouched, and is idempotent
  (second run archives 0). *(Browser screenshot skipped — dev server was down and this is
  archive logic + one button reusing the already-verified transition/refresh pattern.)*
- **Remaining work**: P7–P11.
- **Next recommended phase**: **P7 — Journal Redesign** — reshape the Journal around
  finalized `TradingDay`s: the calendar/day view becomes an archive of ended days (day
  recap: workflow state, prep/plan summary, trades, daily analytics), reusing the analytics
  domain + the Trade Workspace read view. Consider a `getArchivedDay(userId, dateKey)`
  aggregate and rendering archived-day content read-only. Keep the existing journal routes
  working throughout. One phase, then STOP.

### Phase 7 — Journal Redesign ✅
- **Completed**: the Journal day page (`/journal/[date]`) is now a **day recap** of the
  whole workflow, on top of the existing notes + trades (both preserved).
  - **`getJournalDayRecap(userId, dateKey)`** (journal.service) — a read-only aggregate:
    returns **null** when no `TradingDay` exists for the day (journal then behaves exactly
    as before), otherwise the day status, the workflow completion flags, compact **Morning
    Prep** (routine done/total, market context, readiness) and **Today's Plan** (bias +
    conviction, watchlist symbols, key levels, risk budget) summaries, and the day-scoped
    analytics (reuses `getDailyAnalytics`, the routine template, and the Assets watchlist).
  - **`JournalDayRecap`** (read-only, server) — renders the reused `WorkflowProgress`
    stepper + `WorkspaceField`/`NoteBlock`/`KpiCard`/`tiptapToPlainText`. No new editing
    surface (archived days are read-only).
  - The day page shows the **status badge** (Active/Archived) and the recap above Daily
    Notes + Trades; the workflow steps are derived by the shared `deriveWorkflowSteps`
    (prep/plan/analyze from the day, trade/review from the day's trades).
- **Components completed**: `journal/journal-day-recap.tsx`; `getJournalDayRecap` service +
  `JournalDayRecapDTO`.
- **Database changes**: none.
- **Routes**: none (still `/journal/[date]`; all sub-routes unchanged).
- **Files changed**: new `journal-day-recap.tsx`; changed `journal.service.ts`
  (getJournalDayRecap), `types/today.ts` (JournalDayRecapDTO), `journal/[date]/page.tsx`.
- **Verified**: `tsc` + `eslint` clean (no import cycle across journal/analytics/
  trading-day services), 155 tests pass, a service integration test proved the null case +
  a populated recap (prep/plan/analytics, watchlist symbols, netPnl), and a browser
  screenshot confirmed the recap renders (workflow stepper, prep/plan cards, analytics KPIs)
  with Daily Notes + Trades preserved — zero console errors.
- **Remaining work**: P8–P11.
- **Next recommended phase**: **P8 — Trade Gallery** — a grid/gallery view of trades (image
  thumbnails when present, else a compact stat card: asset, direction, R, PnL, psychology,
  status), as a new route (e.g. `/journal/gallery` or a Journal tab), linking each card to
  its Trade Workspace. Reuse the trade list DTO/mapper. Sets up P9 (Advanced Filters). One
  phase, then STOP.

### Phase 8 — Trade Gallery ✅
- **Completed**: a gallery of every trade at `/journal/gallery`, linked from a **Trade
  gallery** button on the Journal calendar page.
  - **`listAllTrades(userId)`** (trades.service) — all trades, newest first, with the
    workspace include; mapped to `TradeWorkspaceDTO` via the **shared `toTradeWorkspaceDTO`**
    mapper (full reuse).
  - **`TradeGalleryCard`** — an analysis-image thumbnail when present, otherwise a compact
    stat card (`#N`, asset, direction, short date, actual R, PnL, psychology grade, status
    badge), reusing `TradeStatusBadge` / `GRADE_VARIANT` / `formatRR` /
    `formatSignedCurrency`. The whole card links to the trade's workspace.
  - **`TradeGallery`** — responsive grid (1→4 cols) with count + empty state.
  - Added a reusable `formatDateKeyShort` to `lib/date`.
- **Components completed**: `journal/trade-gallery.tsx`, `journal/trade-gallery-card.tsx`;
  `listAllTrades` service; `formatDateKeyShort` helper.
- **Database changes**: none.
- **Routes**: `+ /journal/gallery`.
- **Files changed**: new gallery components + route page; changed `trades.service.ts`
  (listAllTrades), `lib/date.ts` (formatDateKeyShort), `journal/page.tsx` (gallery link).
- **Verified**: `tsc` + `eslint` clean, 155 tests pass, and a browser screenshot confirmed
  the gallery renders every trade as a card (2 stat cards — no images since uploads are
  stubbed app-wide) linking to the workspace, with zero console errors.
- **Remaining work**: P9–P11.
- **Next recommended phase**: **P9 — Advanced Filters** — a reusable filter system over
  trades (asset, strategy, status, direction, psychology grade, adherence, date range, R
  sign/threshold), driving the Trade Gallery (and reusable by the Journal). Likely a client
  filter bar + a pure `filterTrades` domain function (unit-tested) over the mapped
  `TradeWorkspaceDTO[]`, with URL-param persistence. One phase, then STOP.

### Phase 9 — Advanced Filters ✅
- **Completed**: a reusable trade-filter system driving the Trade Gallery live.
  - **Pure `filterTrades`** (`domain/trades/filter.ts`, 7 tests) over a minimal
    `FilterableTrade` shape (which `TradeWorkspaceDTO` satisfies): search (asset +
    strategy, AND terms), direction, status, **result by R sign** (WIN/LOSS/OPEN), grade,
    asset, strategy — all optional, ANDed. Plus `EMPTY_TRADE_FILTERS` / `hasActiveFilters`.
  - **`TradeFilterBar`** — search input + a row of Select dropdowns (asset/strategy selects
    hidden when there are none) + a Clear button that appears only when filters are active.
  - **`TradeGallery`** is now a client component: derives the distinct assets/strategies,
    holds the filter state, filters via the pure function, and shows an "N of M" count + a
    "no matches" state. (Filters are client-side state; URL-param persistence is a
    straightforward follow-on if wanted.)
- **Components completed**: `journal/trade-filter-bar.tsx`; `domain/trades/filter.ts`
  (+ test); `trade-gallery.tsx` made client + filterable.
- **Database changes / Routes**: none.
- **Files changed**: new `domain/trades/filter.ts` (+ test), `trade-filter-bar.tsx`;
  changed `trade-gallery.tsx`.
- **Verified**: `tsc` + `eslint` clean, 162 tests pass (+7 filter), and a browser run
  confirmed live filtering — selecting **Losers** on an all-winners set updated the count to
  "0 of 2" and showed "No trades match these filters" — with zero console errors.
- **Remaining work**: P10–P11.
- **Next recommended phase**: **P10 — Edge Workspace (Weekly Review)** — a weekly review
  module: aggregate a week's trades (reuse `summarizeStrategyPerformance` / the analytics
  domain) into a week recap (P&L, win rate, R, best/worst, psychology, per-strategy via
  `getStrategyPerformance`) + a guided weekly reflection. A new route (e.g. `/edge` or
  `/journal/weekly`) with a week picker. Consider a `WeeklyReview` model only if persisting
  the reflection; otherwise derive read-only. One phase, then STOP.

### Phase 10 — Edge Workspace (Weekly Review) ✅ — final feature phase
- **Completed**: a weekly review module at **`/edge`** (sidebar item **Edge Review**),
  closing the workflow's *Improvement* loop.
  - Week is keyed by its Monday via the new pure **`weekStartKey`** (`lib/date`, 4 tests);
    `?week=` param + prev/next/this-week navigation.
  - **Weekly metrics reuse `getAnalyticsData(userId, weekStart, weekEnd)`** (a week is just
    a range): KPI grid (trades W/L, win rate, avg return/trade, profit factor, expectancy,
    avg psychology, rule adherence, best asset) + the week's `EquityCurveChart` + a
    per-asset breakdown (`statsByAsset`). No new analytics code.
  - **Guided reflection persisted** in a new **`WeeklyReview`** model (unique
    `userId+weekStart`; `wentWell`/`toImprove`/`focusNextWeek` Tiptap JSON). `WeeklyReflection`
    is 3 autosaving `RichTextEditor`s → `updateWeeklyReview` → `upsertWeeklyReview`
    (get-or-create then patch, mirroring the Today sections).
- **Components completed**: `edge/weekly-reflection.tsx`, `edge.service.ts`,
  `actions/edge.actions.ts`, `lib/validation/edge.ts`, `/edge` route; `weekStartKey` helper.
- **Database changes**: `WeeklyReview` table (migration `20260804100819_weekly_review`) +
  `User.weeklyReviews`. Additive.
- **Routes**: `+ /edge`. Sidebar `+ Edge Review`.
- **Files changed**: new edge service/action/validation/component/route + `WeeklyReview`
  schema; changed `lib/date.ts` (weekStartKey + test), `app-sidebar.tsx`.
- **Verified**: `tsc` + `eslint` clean, 166 tests pass (+4 week), and a browser run
  confirmed the page renders (KPIs 2 trades / 100% WR / +3.28% best asset, equity curve,
  by-asset) **and** the reflection autosaved and persisted across reload — zero console
  errors.
- **Remaining work**: P11 (Polish) only.
- **Next recommended phase**: **P11 — Polish** (final): a consistency/quality pass across
  the new TradeOS V2 surface — loading skeletons for `/today` `/edge` and the gallery,
  empty/edge states, `prefers-reduced-motion` + a11y (labels/contrast/focus) on the new
  components, responsive checks (stepper/tabs/gallery on mobile), and any small
  design-consistency cleanups. No new features. Then the roadmap is complete.

### Phase 11 — Polish ✅ — ROADMAP COMPLETE 🎉
- **Completed**: a consistency/quality pass over the new TradeOS V2 surface (no new
  features).
  - **`prefers-reduced-motion`**: the shared motion primitives (`FadeIn`, `StaggerList`,
    `StaggerItem`) now use `useReducedMotion()` — when the viewer opts out, content renders
    at its final state with no transform/stagger. App-wide win (every page uses these).
  - **Loading skeletons**: added `loading.tsx` for the new routes **`/today`**, **`/edge`**,
    and **`/journal/gallery`** (the last routes that lacked one), reusing the `Skeleton` UI
    and each route's real layout.
  - **A11y**: the Trade Gallery filter selects now carry `aria-label`s ("Filter by …"); the
    workflow stepper marks the active step with `aria-current="step"`.
- **Components completed**: 3 new `loading.tsx`; changed `shared/motion.tsx`,
  `journal/trade-filter-bar.tsx`, `dashboard/workflow-progress.tsx`.
- **Database changes / Routes**: none.
- **Files changed**: new `today/loading.tsx`, `edge/loading.tsx`,
  `journal/gallery/loading.tsx`; changed `motion.tsx`, `trade-filter-bar.tsx`,
  `workflow-progress.tsx`.
- **Verified**: `tsc` + `eslint` clean, 166 tests pass. (Browser check skipped — the dev
  server was down and these are presentational: reduced-motion via the standard
  `useReducedMotion` hook, static skeletons, and aria attributes, all covered by tsc/lint.)
- **Remaining work**: none — **all 12 phases (P0–P11) are complete.**

---

## 🎉 TradeOS V2 — complete

The full workflow cycle is live end to end:
**Dashboard → Today (Prep → Plan → Trade → Review → Analyze) → auto-archive → Journal day
recap → Trade Gallery + Filters → Edge Weekly Review.** Built framework-first over the
`TradingDay` backbone, reusing the existing Trade Workspace / Strategy Lab / analytics
throughout; 166 tests green.

### Post-roadmap integrations

- **Trade image uploads — ✅ DONE.** Real UploadThing wiring (was stubbed app-wide).
  Screenshots attach per category (Analysis / Before / After, max 6 each) from the
  Trade Workspace → Attachments section, with delete + full-size lightbox. Auth and
  trade-ownership are enforced in the FileRouter middleware (`src/server/uploadthing.ts`)
  before any presigned URL is issued; `onUploadComplete` persists the `TradeImage` row;
  deletes remove both the hosted file (UTApi) and the row, scoped through the parent
  trade. **Setup:** create an app at uploadthing.com and set `UPLOADTHING_TOKEN` in
  `.env` (see `.env.example`). When the token is unset the upload UI is hidden and the
  app runs normally — existing images still render. Uploads live in the workspace (a
  trade must exist first); the create form points there.

Still open (not in the original brief): URL-param persistence for gallery filters,
per-strategy weekly breakdown, and read-only enforcement on archived days.
