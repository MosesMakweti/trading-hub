# Discrepancy Gap — flagship analytics engine (tracker)

> ## ⚠️ CORRECTED MODEL (supersedes the "expected − actual" framing below)
>
> The original engine computed `expectedR − actualR` per trade (`expectedR = strategyExpectancy ×
> execScore/100`) and called it "discrepancy". **That was wrong**: a correctly-executed loss produced a
> positive gap, penalising normal strategy variance as if it were trader error. The model is now split
> into two systems (`src/domain/analytics/discrepancy-model.ts`, fully tested):
>
> **A. Performance Variance** — `Expected Statistical Equity` (Σ the strategy's *pure* expectancy over
> qualified trades — NOT scaled by execution, NOT the planned target) vs `Actual Equity`. The band
> between them is **Performance Variance**, which is *mostly normal variance*. Expectancy is resolved
> per strategy: **LIVE** (computed from that strategy's own qualifying realized R once the sample ≥ 20,
> `domain/performance/expectancy.ts`) → **BACKTESTED** (the user's number) → **INSUFFICIENT_SAMPLE**
> (unbenchmarked; no fabricated line).
>
> **B. Avoidable Discrepancy** — trader-controlled leakage only: the **objective** R-cost of deviations
> (entry/exit/risk slips, from the deviation-engine) **+ validated missed-winner cost**. A perfectly
> executed trade contributes **0** here, win *or* loss. Rule-only violations (invalid setup taken /
> missing mandatory confluence) flag a process discrepancy but their outcome R is **UNDETERMINED** (0 —
> never fabricated). **Normal Variance = Performance Variance − Avoidable Discrepancy** (the residual).
>
> **Per-trade classification** (`classifyTrade`): `NORMAL_WIN/LOSS/BREAKEVEN` (clean execution) vs
> `PROCESS_DISCREPANCY_WIN/LOSS` (a controllable deviation) vs `UNVERIFIED`. **Win ≠ good execution;
> loss ≠ bad execution.**
>
> The invariant, proven in tests: `expectancy +0.65, actual −1R, perfect execution → actual −1R,
> **avoidable 0R**` (the old model wrongly gave ~+1.65). No stored discrepancy records exist (all
> live-computed), so history recomputes correctly — no migration. Surfaces corrected: Dashboard card,
> Analytics "Discrepancy — variance vs avoidable" section, per-trade Journal cards, the Opportunity
> section (execution "variance" not "leakage"), and Strategy Lab (Live vs Backtested expectancy).
> Phases P1 (model+tests) · P2 (analytics+UI) · P3 (opportunity) · P4 (Strategy Lab live expectancy).

---

**Resumable master tracker (original — kept for history; superseded by the box above).** A platform-wide
engine that measures the gap between a trader's **expected** performance (strategy edge × execution
quality) and their **actual** performance, as two cumulative equity curves.

## Core concept
Every completed trade yields **Expected R** and **Actual R**:
- `Expected R = strategyExpectancy × (executionScore / 100)` — e.g. `1.5R × 90% = 1.35R`.
- `Actual R` = the trade's realized R (`actualRR`).
- `Gap = Expected − Actual`. `Recoverable = fullPotential(100% exec) − Actual`.

Two cumulative curves — **Expected Equity** (Σ Expected R) and **Actual Equity** (Σ Actual R) — and the
distance between them is the **Discrepancy Gap**: how much of a proven edge execution is leaving behind.

## Central layer — the Execution Engine
`domain/analytics/execution-engine.ts` is the **single source of all discrepancy math** (pure,
framework-free, fully typed + tested). Dashboard / Journal / Analytics / Psychology all consume it — no
duplicate calculations anywhere. Per-trade metrics:
- `expectedR`, `actualR`, `gapR`, `recoverableR`, `executionScore`
Cumulative + summary:
- Expected/Actual equity curves, `currentGap`, `executionEfficiencyPercent` (actual/expected),
  `edgeCapturePercent` (actual/full-potential), `recoverableR`, best/worst execution streaks, `gapTrend`
  (shrinking | stable | growing).

The input type carries optional **deviation** slots (entry/exit/risk/session/psychology) so D5/D6 extend
it without reshaping the engine.

## Roadmap
```
D1  Execution Engine (pure domain + tests) ............... ✅ the central layer
D2  Strategy benchmark fields (expected win rate / avg RR /
    expectancy / min execution score) + Strategy Lab editor  ✅
D3  Wire engine → analytics.service + Dashboard Discrepancy
    Gap card (dual-line chart beside Equity Curve) .......... ✅
D4  Journal trade-card integration (expected/actual/gap/dev) . ✅ (primary deviation → D5)
D5  Analytics Discrepancy Gap section (overall/execution/
    recoverable/trend + dual-line chart) .................... ✅
D6  Deviation sub-scores (entry/exit/risk from planned-vs-
    actual) + Primary Deviation + Psychology Lab classify ... ✅ 🎉 COMPLETE
```
Every phase: tsc + eslint clean, vitest green, app runnable, design-system consistent.

## Substrate already in place (reused, not rebuilt)
- Per-trade scores frozen on `Trade`: `setupScore`/`setupRating`, `confluencePercent`,
  `executionPercent`, `tradeQualityPercent`, `actualRR`, planned/actual prices, `selectedSession`.
- `scoreSetup` / `scoreStrategyAdherence` (confluence scoring), `summarizeAdherence`, `buildEquityCurve`.
- Strategy Lab confluences with weights + mandatory flags (the benchmark inputs).

## Progress log

### D1 — Execution Engine ✅
`domain/analytics/execution-engine.ts` (+7 vitest cases, incl. the spec's `1.5R × 90% → 1.35R`
example). Pure central layer:
- `scoreTrade` — per-trade `expectedR` (expectancy × exec/100), `actualR`, `gapR`, `recoverableR`
  (vs 100% execution); unbenchmarked trades (no expectancy/score) get null expected/gap but still
  count actualR on the Actual line.
- `buildDiscrepancyCurve` — cumulative Expected / Actual / full-potential equity, one point per trade.
- `summarizeDiscrepancy` — `currentGap`, `executionEfficiencyPercent` (actual/expected),
  `edgeCapturePercent` (actual/full-potential), `recoverableR`, avg execution score, best/worst
  execution streaks (≥80 / <65), and `gapTrend` (shrinking | stable | growing).
- `ExecutionTradeInput.deviations` carries optional entry/exit/risk/session/psychology slots so
  D5/D6 extend it without reshaping the engine.

tsc + eslint clean; 203 tests green (+7). Next: D2 (strategy benchmark fields feed
`strategyExpectancyR`; `executionScore` will come from the trade's frozen setup/adherence scores).

### D2 — Strategy benchmark fields ✅
Each strategy is now a benchmark. Added `expectedWinRate` / `expectedAvgRr` / `expectedExpectancy` /
`minExecutionScore` to `StrategyTradeManagement` (migration `20260807120000_strategy_benchmarks`,
additive). Threaded through the validation (`tradeManagementUpdateSchema`), service
(`updateTradeManagement`), `TradeManagementDTO` + page mapper, and the version-snapshot builder (so
benchmarks freeze into published versions). New **"Expected performance (benchmark)"** card in the
Strategy Lab → Trade Management section (4 autosaved number inputs + a note explaining Expected R =
expectancy × execution score). `expectedExpectancy` is the primary input to D3's Expected R.
Next: D3 freezes the benchmark onto each trade (via the strategy reference/snapshot) and builds the
Dashboard Discrepancy Gap card.

### D3 — analytics wiring + Dashboard card ✅
`getAnalyticsData` now builds `ExecutionTradeInput[]` in its existing trade loop and returns
`trading.discrepancy = { curve, summary }` via the engine — `strategyExpectancyR` reads the strategy's
**live** `expectedExpectancy` (joined through the trade's `strategy.tradeManagement`); `executionScore`
= the frozen composite `tradeQualityPercent ?? setupScore ?? confluencePercent`; `actualR` = the trade's
`actualRR`. Surfaced through `getDashboardData`. New **`DiscrepancyGapCard`** (Recharts ComposedChart):
Expected (muted dashed `--chart-2`) vs Actual (brand `--chart-1`) cumulative-R lines with the gap band
shaded between (range-Area), a custom hover tooltip (trade #, Expected, Actual, Gap, Execution), a
3-metric strip (Current gap / Execution efficiency / Recoverable) and a gap-trend chip. Placed in a
2-col grid beside the Equity Curve in `PerformanceSnapshot` (identical `glass` card styling).
**Design note:** used the muted-vs-brand chart pair the design system already ships for two series;
identity is carried by the legend + line style, per the dataviz method. Empty-safe (prompts to set a
strategy benchmark). Next: D4 (per-trade gap on the journal card).

### D4 — Journal trade-card integration ✅
Centralized the composite-execution-score definition in the engine
(`compositeExecutionScore`) and refactored the analytics wiring onto it (single source). New shared
`toTradeDiscrepancy(trade)` (`server/services/trade-discrepancy.ts`) routes each trade through the
engine's `scoreTrade` → `TradeDiscrepancyDTO` (executionScore, strategyAdherence, expectedR, actualR,
gapR, recoverableR), returning null when the strategy has no expectancy benchmark. `tradeInclude`'s
strategy select now carries `tradeManagement.expectedExpectancy`; `TradeListItemDTO` gains
`discrepancy`; the journal maps it via the shared helper. The **trade card** shows a compact
Discrepancy strip — `Exp → Act`, colored **Gap**, Execution %, and Recoverable — only when
benchmarked. Primary deviation is D5 (needs the entry/exit/risk sub-scores). Next: D5.

### D5 — Analytics Discrepancy Gap section ✅
Extracted the dual-line chart into a shared **`DiscrepancyGapChart`** (Dashboard card + Analytics
section both use it; the card became a thin server wrapper). New **`DiscrepancyAnalytics`** section on
the analytics dashboard (rendered by `TradingAnalytics`, above the adherence card): grouped stat grid —
**Overall** (Expected / Actual equity, Lifetime gap), **Execution** (avg execution score / strategy
adherence / rule adherence), **Recoverable edge** (Recoverable R / % / Edge capture) — plus execution
efficiency, best/worst execution streaks, the gap-trend chip, and the full dual-line chart. All from
the already-computed `trading.discrepancy` + adherence, no new queries. **Re-scope:** deviation
sub-scores (entry/exit/risk) move to **D6** since they feed the psychology cause-classification.
Next: D6 (deviation engine + Primary Deviation on the card + Psychology Lab).

### D6 — Deviation engine + Primary Deviation + Psychology Lab classification ✅ 🎉
New pure `domain/analytics/deviation-engine.ts` (+8 tests): `computeDeviations` attributes an
estimated **R-cost** (1R = planned entry→stop distance) to each planned-vs-actual slip —
**late/chased entry**, **premature exit**, **loss overrun**, **increased risk** — direction-aware and
robust to missing inputs; the largest is the trade's **primary deviation**. `aggregateDeviationCauses`
rolls the primaries into per-cause **occurrences + total/avg R-cost**, ranked by total cost.
- **Per trade:** `toTradeDiscrepancy` computes the (price-based) primary deviation → `TradeDiscrepancyDTO.primaryDeviation`;
  the journal trade card shows it as an amber chip with its R-cost (fills the D4 "Primary Deviation" gap).
- **Analytics:** the loop computes each trade's primary (entry/exit **+ risk**, using the strategy's
  `maxRiskPercent` vs the performance allocation's risk), aggregated into `discrepancy.causes`. The
  `DiscrepancyAnalytics` section renders the **"What execution is costing you"** table (Cause ·
  Occurrences · Avg cost · Total cost) — the Psychology Lab classification (e.g. `Premature exit ·
  12 · −0.8R · −9.6R`).

tsc + eslint clean; 211 tests green (+8).

## 🎉 Discrepancy Gap — COMPLETE (D1–D6)
Central **Execution Engine** → strategy **benchmarks** → **Dashboard** dual-curve card beside the
Equity Curve → per-trade **Journal** breakdown → dedicated **Analytics** section → **deviation engine**
+ Psychology-Lab cause classification. Every number flows from the one engine (no duplicate math),
auto-generates after each trade like the Equity Curve, and is fully typed + unit-tested. Optional
future work: freeze the expectancy benchmark per trade for immutable history (currently read live);
richer per-cause psychology drill-downs; R→$ recoverable using account risk sizing.
