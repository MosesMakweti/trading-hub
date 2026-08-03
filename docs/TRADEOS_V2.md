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
Phase 5  Trade Workspace  (Idea → Execution → Review) + Daily Analytics ... ▶ NEXT
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
