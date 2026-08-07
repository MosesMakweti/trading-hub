# Discrepancy Gap — flagship analytics engine (tracker)

**Resumable master tracker.** Read first. A platform-wide engine that measures the gap between a
trader's **expected** performance (strategy edge × execution quality) and their **actual** performance,
as two cumulative equity curves. Auto-generated after every completed trade, like the Equity Curve.

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
D4  Journal trade-card integration (expected/actual/gap/dev) . ⭘
D5  Analytics Discrepancy Gap section + deviation sub-scores
    (entry/exit/risk from planned-vs-actual prices) ......... ⭘
D6  Psychology Lab deviation classification + aggregation ... ⭘
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
