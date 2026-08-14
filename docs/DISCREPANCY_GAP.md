# Discrepancy Gap — flagship analytics engine (tracker)

> **Current model: Counterfactual (P0–P5, complete).** This supersedes both the original
> "Expected − Actual" engine (D1–D6) *and* the "Performance Variance vs Avoidable
> Discrepancy" correction that briefly replaced it — that System A/B split is now fully
> retired (P5). Read the Counterfactual section below for the live model; everything
> after it is kept as history only.

---

## The Counterfactual model (current)

The gap is **not** "expected − actual" (that wrongly penalised a correctly-executed
loss, and even the corrected System A/B split still leaned on a per-strategy statistical
expectancy benchmark). It is now:

> The cumulative R lost or gained because the trader deviated from their **valid
> process** — reconstructed **per event** against the documented plan.

Two curves:
- **Actual Equity** — Σ realized R (what actually happened).
- **Process-Perfect Equity** — Σ the R a disciplined trader following the strategy, risk
  rules, execution rules, and psychological process would have produced for the **same
  opportunities**.

A correctly-executed valid win **or** loss ⇒ `processPerfectR == actualR` ⇒ **zero gap**.
The gap accrues only from attributable deviations. Where a deviation's R impact is
objectively measurable, it's computed (**MEASURED**); where it's a real breach but the R
cost can't be known, it's recorded **FLAGGED** (severity/confidence, `rImpact = null`) —
never fabricated. Lucky breaches (a trade the process would *not* have taken that
happened to win) are flagged and their winnings recorded as `unearnedR` — never shaded,
never rewarded.

### Central layer — the Counterfactual Engine
`domain/analytics/counterfactual-engine.ts` (pure, framework-free, fully tested) is the
single source of all discrepancy math. Reuses `domain/analytics/deviation-engine.ts` for
objective entry/exit/risk R-costs — no duplicate price math.

- **`reconstructEvent`** — per event (`EXECUTED` or `MISSED`), returns
  `EventCounterfactual`: `actualR`, `processPerfectR`, `avoidableR` (= `max(0,
  processPerfectR − actualR)`, shaded), `unearnedR` (= `max(0, actualR −
  processPerfectR)`, tracked but never shaded), `processBreach`, `validSetup`,
  `leakages: LeakageEvent[]`.
  - **Invalid/behavioral-skip trades** (invalid setup, missing mandatory confluence, or a
    `SKIP_TAG` behavior intent — FOMO/revenge/impulse/boredom): a disciplined process
    skips the trade entirely → `processPerfectR = 0`. A loss is recovered (MEASURED); a
    win is flagged as a breach and banked as `unearnedR`, never rewarded.
  - **Valid trades**: start from `actualR`, add back each objective deviation's cost
    (`deviation-engine`) to get `processPerfectR`; flagged-only breaches (would-not-repeat,
    manual override, session violation, missing execution confirmation, daily-risk-limit
    breach, overtrading) mark `processBreach` without inventing R.
  - **Missed events**: only a missed **valid winner** is opportunity leakage
    (`OPPORTUNITY`, MEASURED); a missed loser cost 0; an undetermined miss fabricates
    nothing.
- **`buildCounterfactualCurve`** — time-ordered (`sequence`) cumulative Actual Equity /
  Process-Perfect Equity / `avoidableGap` (monotonic ≥ 0 — the authoritative "Total
  Avoidable Gap"), with each point's step deltas and `leakages` for click-through.
- **`summarizeAttribution`** — `realizedR`, `processPerfectR`, `totalAvoidableGapR`,
  `potentialR` (= `realizedR + totalAvoidableGapR`), `unearnedR`,
  `processEfficiencyPercent` (= `realizedR / potentialR × 100`), `byCategory`
  (`EXECUTION` · `RISK` · `STRATEGY_ADHERENCE` · `BEHAVIORAL` · `OPPORTUNITY` — measured
  R + flagged count + share%), `dataConfidencePercent` (share of events with no flagged
  breach), `processBreaches`.

### Capture fields feeding the engine (additive, nullable)
Historical rows stay valid — the engine infers when these are null:
- `Trade.tradeIntent` (`TradeIntent` enum: PLANNED/FOMO/REVENGE/BOREDOM/IMPULSE/
  MANUAL_OVERRIDE) — captured via `WorkspaceIntentField` in the Trade Workspace review
  section.
- `StrategyTradeManagement.maxDailyRiskPercent` + `maxTradesPerDay` — captured in the
  Strategy Lab Trade Management limits; drive the daily-risk / overtrading flags.

Migration `20260811010750_counterfactual_capture` (additive, no drops, no backfill).

### Where it surfaces
- **Dashboard**: `CounterfactualGapChart` (Actual vs Process-Perfect equity; shades
  *only* the avoidable band, clipped to `Process-Perfect ≥ Actual`; lucky breaches show
  Actual rising above Process-Perfect, unshaded; points are clickable → lists the
  deviations that moved the gap + a deep link to the trade) and `DiscrepancyGapCard`
  (Total Avoidable Gap headline, per-category tiles, Process Efficiency %,
  data-confidence chip, unearned-R flag).
- **Analytics page**: `DiscrepancyAnalytics` — Total Avoidable / Unearned / Process
  Efficiency, Realized vs Process-Perfect vs Potential, process breaches, the
  Actual-vs-Process-Perfect chart, and `WhyGapPanel` (per-category attribution bars +
  the list of flagged/R-unmeasurable breaches).
- **Per-trade** (Journal card, workspace): `TradeDiscrepancyDTO`
  (actual/processPerfect/avoidable/unearned/leakages/primary), built by the shared
  `toTradeDiscrepancy` (`server/services/trade-discrepancy.ts`) which reconstructs each
  trade via the engine — a compact badge shows the primary leakage + its R-cost.

`getAnalyticsData` emits `trading.counterfactual = { hasData, curve, summary }`; each
in-range trade becomes an `EXECUTED` event (reusing the already-computed deviations,
validity/missing-confluence, behavioral intent, would-take-again, psychology, and
day-level flags), and `MISSED` valid-opportunity entries are merged in chronologically so
the cumulative curve is truly time-ordered.

### Explicitly out of scope
- `expectancy.ts` is kept — still used by `getStrategyExpectancy` (Strategy Lab live vs
  backtested expectancy display), unrelated to the Discrepancy Gap now.
- The **Trade Opportunity funnel** (`opportunity-engine`) is intentionally untouched — a
  separate section, not the Discrepancy Gap.

### Counterfactual rollout (P0–P5) ✅ complete
```
P0  Counterfactual engine (pure domain) + tests ................ ✅
P1  Additive capture fields (tradeIntent, daily-risk/overtrade
    limits) + Trade Workspace / Strategy Lab UI .................. ✅
P2  Wire into getAnalyticsData (additive; old + new coexist) .... ✅
P3  Dashboard card, graph, "Why is there a gap?" panel .......... ✅
P4  Switch Analytics page + per-trade to Counterfactual ......... ✅
P5  Retire the old System A model (discrepancy-model.ts,
    discrepancy-gap-chart.tsx, the old `discrepancy` payload) .... ✅ 🎉 COMPLETE
```
tsc clean; 285/285 tests pass as of P5.

---

## History (superseded — kept for context only)

The sections below describe the **two earlier models**, both fully retired. Nothing here
should be used to reason about current behavior — see the Counterfactual section above.

### Superseded model 2 — Performance Variance / Avoidable Discrepancy (System A/B split)
Replaced the original "expected − actual" framing (below) with a two-system split:
**A. Performance Variance** (`Expected Statistical Equity` vs `Actual Equity`, mostly
normal variance, expectancy resolved LIVE → BACKTESTED → INSUFFICIENT_SAMPLE) and
**B. Avoidable Discrepancy** (objective deviation R-cost + validated missed-winner cost;
a perfectly executed trade contributes 0). Lived in `discrepancy-model.ts`
(`classifyTrade`, `correctedInputs`). **Retired in P5** — this statistical-benchmark
approach is gone; the Counterfactual model reconstructs discipline per event instead of
comparing to a strategy-wide expectancy number.

### Superseded model 1 — "Expected − Actual" (D1–D6, original)
The very first model. Every completed trade yielded `Expected R = strategyExpectancy ×
(executionScore / 100)` and `Actual R = actualRR`; `Gap = Expected − Actual`. Central
layer was `domain/analytics/execution-engine.ts`. **Flaw**: a correctly-executed loss
produced a positive gap, penalising normal strategy variance as trader error — this is
what motivated Superseded model 2, and ultimately the Counterfactual rebuild.

D1–D6 shipped: the Execution Engine, strategy benchmark fields (`expectedWinRate` /
`expectedAvgRr` / `expectedExpectancy` / `minExecutionScore` on
`StrategyTradeManagement`), analytics wiring + Dashboard card, Journal trade-card
integration, the Analytics Discrepancy Gap section, and the deviation engine
(`domain/analytics/deviation-engine.ts` — **still used** by the Counterfactual model for
objective entry/exit/risk R-costs) + Primary Deviation + Psychology Lab classification.
