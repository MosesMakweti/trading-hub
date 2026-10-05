# Trade Opportunity, Executed & Missed Architecture (tracker)

**Resumable master tracker. Read first.** A unified **Trade Opportunity** entity — a *valid strategy
setup that was spotted* — that resolves into exactly ONE outcome, so the platform can measure not just
how well you executed the trades you took, but the edge you left on the table by **skipping valid setups**.

## Core concept

A `TradeOpportunity` is a valid setup you noticed. It resolves to exactly one of:

| Status | Meaning | Feeds the gap? |
|---|---|---|
| `PENDING` | still being monitored, no outcome yet | no |
| `EXECUTED` | you took it (an executed `Trade` links back via `Trade.opportunityId`) | **yes** — execution leakage |
| `MISSED` | you did NOT take a valid setup (reason + trader-entered outcome) | **yes** — missed opportunity cost |
| `INVALIDATED` | the setup broke its own rules before triggering | no (not a real miss) |
| `EXPIRED` | the window passed with no trigger | no (not a real miss) |

**The one rule that makes it honest:** only a **valid** setup (`setupValid`, scored by the existing
`domain/trades/setup-score.ts`) counts. One opportunity → one outcome (enforced by
`Trade.opportunityId @unique` + service guards), so nothing is ever double-counted.

## The discrepancy decomposition (the "why")

The Discrepancy Gap was previously *execution-only*. Opportunities let it split into **why** it happened:

```
Total Discrepancy  =  Execution Leakage        (edge lost on trades you TOOK)
                    +  Missed Opportunity Cost   (edge forgone on valid setups you SKIPPED)
```

- **Executed valid trade** → `expectedR = strategyExpectancy × execScore/100`, `actualR = realized`.
  Contributes its execution gap (reuses the Execution Engine's `scoreTrade` — no duplicate math).
- **Missed valid setup** → `missedRealizedR` is **trader-entered** (TradeOS has no price feed).
  Only missed **winners** cost anything: `missedCost = max(0, missedRealizedR)`. A missed **loser** costs
  0 (you correctly avoided a loss); **UNDETERMINED** is tracked for behavior but excluded from the R cost.
- **Edge Capture %** = `realizedR / (realizedR + totalDiscrepancy)` — the share of available edge banked.

Risk-deviation cost is a further breakdown of Execution Leakage and still lives in the deviation-engine —
not re-derived here.

## Layers (no duplicate calculations)

- **`domain/analytics/opportunity-engine.ts`** — pure. `summarizeOpportunities` + `buildOpportunityCurve`:
  the leakage/missed split, funnel (valid / executed / missed / execution rate), edge capture, and the
  missed-outcome breakdown. Sits ON TOP of the Execution Engine.
- **`domain/analytics/opportunity-mapper.ts`** — pure, DB-agnostic. Resolved rows → engine inputs
  (keeps only EXECUTED/MISSED, orders stably, derives the executed trade's composite execution score).
- **`domain/analytics/miss-reasons.ts`** — pure. `aggregateMissReasons`: ranks miss reasons by forgone R
  and separates **disciplined passes** (`INTENTIONAL_SKIP` / `RISK_CONCERNS`) from **behavioral lapses**.
- **`server/services/opportunity.service.ts`** — userId-scoped CRUD + resolve (log missed, link/unlink
  executed, invalidate/expire, delete), the DTO read mapper (`listOpportunityDtosForDay`), and the
  analytics feeds (`getOpportunityInputs`, `getMissReasonAggregate`).
- **`actions/opportunity.actions.ts`** — `"use server"` wrappers (day-editable guard + revalidation).
- **`server/services/analytics.service.ts`** — adds an **additive** `trading.opportunity` block
  (`hasData`, `summary`, `curve`, `missReasons`). The verified executed-trade discrepancy is UNCHANGED.

## Data model

`TradeOpportunity` (soft-deleted, registered in `server/db.ts`): market + strategy snapshot mirroring
`Trade` (`strategyExecutionSnapshot`, `selectedConfluences/Execution`, `setupScore/Rating/Valid`,
`missingConfluences`), the planned idea (`plannedEntry/StopLoss/Target/RR`), a frozen
`expectedExpectancyR` (the strategy's proven edge at spot time), `status`, and the MISSED-only fields
(`missReason`, `missNote`, `missedOutcome`, `missedRealizedR`). Enums: `OpportunityStatus`, `MissReason`,
`MissedOutcome`. `Trade.opportunityId String? @unique` (SetNull) links an executed trade back.

Migrations: `20260809120000_trade_opportunity`, `20260809130000_opportunity_snapshot`.

Today V3 (Phase 4) adds `TradeOpportunity.originTradeId` (`@unique`, SetNull) — provenance only: the
cancelled idea a MISSED opportunity was explicitly recorded from ("Record as missed opportunity").
It is never `Trade.opportunityId`, so it never makes an opportunity EXECUTED. Migration
`20261005120000_today_v3_missed_from_cancelled`; see `docs/TODAY_V3_CLOSE.md`.

## The historical-data guarantee (§19)

Existing trades logged before this feature have **no** opportunity — they stay pure executed trades and
the verified historical Discrepancy Gap is untouched (works for every executed trade regardless). The
opportunity-aware layer only reflects **tracked** opportunities and is gated by `hasData`, so no missed
opportunity is ever fabricated for the past.

## UI surfaces

- **Journal day page** — "Opportunities" section: spot a setup (live `setupValid` preview) and resolve
  each (Link executed / Log trade / Missed / Invalidated / Expired / Delete).
- **Add Trade** — `?opportunityId` links the new trade to a spotted opportunity on save (best-effort;
  a stale link never fails the trade save).
- **Analytics** — "Opportunity & Edge Capture" section (replaces the old Missed-Trades placeholder):
  Edge Capture / Leakage / Missed / Total KPIs, executed-vs-missed funnel, and "Why setups were missed".
- **Dashboard** — compact Edge Capture strip (shown only once opportunities exist).

## Roadmap

```
P1  Data model (TradeOpportunity + enums + Trade.opportunityId) + opportunity
    engine (leakage/missed split, funnel, edge capture) + scenario A–G tests .... ✅
P2  Services (create/validate, log missed, link/unlink executed, invalidate/
    expire, delete), actions, pure mapper, validation (dedup rules) ............. ✅
P3  Journal Opportunities capture UX (spot + live validity + resolve) +
    Add-Trade optional "from opportunity" link ................................. ✅
P4  Opportunity-aware Discrepancy on Dashboard + Analytics (additive; verified
    historical view unchanged) ................................................. ✅
P5  Missed-setup psychology — miss-reason aggregation (lapse vs disciplined) .... ✅
P6  Hardening — Data Management reset/delete + trade soft-delete consistency .... ✅ 🎉 COMPLETE
```

**Verification cadence:** `npx tsc --noEmit` · `npx eslint src` · `npx vitest run` (251 tests) ·
`npx next build` — all green.

## Future integrations (optional)

- Per-field analytics filters applied to opportunities (currently date-range only).
- A price-data source would allow auto-determining missed outcomes (today they're trader-entered /
  UNDETERMINED). Large separate effort.
- Fold the opportunity funnel into the `/analytics` filter bar and the Psychology Lab's own view.
