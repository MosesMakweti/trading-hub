# Analytics Visualization System

A shared visualization language for every analytics surface in Traditorium —
one set of tokens, one chart kit (`src/components/viz/`), one set of rules —
so the Analytics page, Dashboard, Today, Journal, Strategy Lab, Backtesting,
Edge Review and Prop Firms read as one instrument.

**Ground rule: presentation only.** No calculation, aggregation or data
semantic changes. Every number on screen is still exactly what the services
already compute; this work changes how it is *shown*. Suspected calculation
issues are logged under [Findings](#findings) for a decision, never silently
"fixed" in a chart.

Status of each phase is tracked in [Phases](#phases) — keep it current so the
work can be resumed from any session.

---

## 1. Audit (2026-10-02)

### Infrastructure found
- **Recharts 3.9** for all time-series charts (12 components), plus
  hand-rolled SVG/CSS primitives in `components/analytics/`: `Sparkline`,
  `Donut`, `ProgressRing`, `Heatmap`, `RowBar`, `DeltaChip`, `KpiCard`,
  a local `Histogram` (analytics-breakdowns) and `GroupRow/GroupList`.
- `chart-theme.ts` shares only a tooltip style object and an axis tick object.
- Colour: `--chart-1…5` are graphite greys + success/danger. Every series is
  graphite; categorical identity (strategy, session, expected vs actual,
  capital vs payouts) has no colour channel at all.
- Gridlines are **dashed** (`3 3`) everywhere; tooltips are Recharts'
  default box with `formatter` strings; legends are Recharts defaults;
  empty states are ad-hoc `<p>`s; there are no loading states for charts.

### Why it feels plain
1. One hue for everything — identity, comparison and benchmarks all graphite.
2. Rich per-group data (strategy, setup type, asset, weekday, month, session,
   direction, validation, bias, mood, behaviour) is shown as text rows with a
   thin magnitude bar — no zero axis, no win/loss composition, no expectancy
   shape, no comparison between groups.
3. Tooltips state a single value; they never say what changed, by how much,
   or what contributed (the per-trade R behind each equity step is available
   but unused).
4. Equity curves are generic area charts: no starting-balance/zero baseline,
   no profit/loss split, no peak or max-drawdown markers, no period summary.
5. KPI cards are bare numbers — only Dashboard passes sparkline data.

### Surface inventory (data available → current form)

| Surface | Data available (already computed) | Current form | Upgrade direction |
|---|---|---|---|
| **Analytics · Overview** | win/loss/BE counts, win rate, PF, expectancy, avg win/loss R, streaks, best/worst R | ring + donut + 18 bare KPI tiles | win/loss composition bar, payoff (avg win vs avg loss) bar, KPI tiles with context |
| **Analytics · Equity curve** | canonical `cumulativeRCurve` (per-trade `r` + `tradeId`), `$` balance series, `%` curve | graphite area, 3 tabs | **Equity instrument**: baseline split fill, peak + max-DD markers, per-step change/contribution tooltip, period summary header, synced drawdown pane |
| **Analytics · Drawdown** | `drawdownCurve` (balance, peak, amount, %) | red area | underwater chart with max-DD marker, recovery shading, current-DD reference |
| **Analytics · Strategy/Setup/Asset** | `RGroupStats[]` (totalR, avgR, winRate, expectancy, PF, n, PnL) | text rows + bar | **Diverging R bars** around zero + win-rate meter + sample confidence; categorical identity for strategies |
| **Analytics · Weekday/Month/Session/Direction** | `RGroupStats[]` | text rows + bar | diverging column charts (weekday/month), session × outcome composition |
| **Analytics · R distribution** | `rDistribution` buckets | CSS histogram | histogram with zero line, loss/win diverging tint, mean/expectancy marker |
| **Analytics · Hour of day** | `breakdowns.hours` (trades, netPnl) | CSS histogram | column chart, count height + P&L-signed tint, best/worst hour labels |
| **Analytics · Daily return** | `dailyPercents` | small calendar heatmap, no legend | calendar heatmap with month/weekday labels, diverging scale legend, richer tooltip |
| **Analytics · Discrepancy** | counterfactual curve (actual vs process-perfect), attribution | composed chart, graphite | two-series comparison with gap band, categorical colours, gap annotation |
| **Analytics · Adherence** | setup-quality trend, confluence win rates | primary-coloured bars/line | horizontal bars sorted, reference line at overall win rate |
| **Analytics · Psychology** | monthly/weekly trend, by asset/session/day, daily heat | line + status dots, list | trend line with band thresholds, heat calendar with scale legend |
| **Analytics · Behaviour / Mood** | `RGroupStats` per label / mood / intensity | text rows | diverging bars (positive vs negative behaviours), intensity as ordinal ramp |
| **Analytics · Opportunity** | funnel, edge-capture curve, miss reasons | donut + list | funnel bars (ordinal ramp), capture meter |
| **Analytics · Prop Firms** | firm summary | KPI tiles | meters vs rule limits |
| **Dashboard** | KPI row (prev-period deltas, sparklines), equity (%/R/$/expected vs actual), mini calendar, prop-firm health | partly enriched | shared KPI tile, equity instrument, calendar heat scale, health meters |
| **Today · daily analytics** | day KPIs | 8 bare KPI tiles | intraday R progression + win/loss composition; tiles with context |
| **Journal** | day recap, calendar | numbers | calendar P&L heat, day summary composition |
| **Strategy Lab · performance** | per-strategy stats | numbers / empty | strategy identity colour, R bars, version comparison |
| **Backtesting · analytics** | net R, curve with drawdown, group stats (R-only) | KPI tiles, graphite curve, GroupLists | equity instrument (R), diverging group bars |
| **Edge Review** | edge cumulative R comparison, commitment trend | 2 graphite lines | categorical comparison lines with legend + direct end labels |
| **Prop Firms** | account balance curve (limits), capital vs payouts, costs/payouts donuts, progress rings | graphite areas | balance instrument with target/limit reference bands, capital vs payout categorical, meters |

---

## 2. Colour language

Colour is assigned by the **job** it does (dataviz method), never decoratively.
UI chrome stays monochrome (design-system §3) — these hues exist for **data
marks only** (lines, bars, fills, dots, swatches), never text, buttons or
accents.

| Job | Tokens | Meaning |
|---|---|---|
| **Polarity / outcome** | `--viz-profit`, `--viz-loss`, `--viz-neutral` (= existing success/danger/muted) | profit · loss · breakeven/flat. Diverging scales run loss ← neutral grey → profit. |
| **Status** | `--viz-warning` (= warning) | caution / near a limit. Always with icon + label. |
| **Identity (categorical)** | `--viz-1 … --viz-6` | strategies, sessions, datasets, comparison series. Fixed order, assigned by stable entity key, never by rank. |
| **Benchmark / reference** | `--viz-reference` (muted ink), dashed | expected R, process-perfect, targets, limits, averages. Dashed = reference only; gridlines are always solid. |
| **Magnitude (sequential)** | `--viz-1` mixed toward the surface | counts / intensity heatmaps. One hue. |

### Categorical palette (validated)
Validated with the dataviz `validate_palette.js` against the real card
surfaces (light `#fdfdfd`, dark `#141517`). Hues deliberately avoid the
reserved profit-green (h≈158), loss-red (h≈25) and warning-amber (h≈78).

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#0256a9` | `#2769b7` |
| 2 | cyan | `#009cba` | `#009eba` |
| 3 | violet | `#643f9f` | `#7453ae` |
| 4 | teal | `#00948e` | `#00a39c` |
| 5 | orange | `#933800` | `#be6517` |
| 6 | magenta | `#b94f87` | `#c66295` |

Adjacent pairs (bars, stacks, lines): worst CVD ΔE **15.8** light / **13.6**
dark (target ≥ 8); normal-vision floor **17.6 / 15.2** (≥ 15); every slot
≥ 3:1 against its surface. **All-pairs forms (scatter) cap at two
categorical series** — slots 1–3 fail all-pairs (blue↔violet). Scatter plots
colour by outcome (profit/loss) instead. More than 6 identities fold into
"Other" (neutral) — never a generated 7th hue.

---

## 3. Chart kit — `src/components/viz/`

| Primitive | Purpose |
|---|---|
| `tokens.ts` | colour roles, `seriesColor(index)`, `identityColor(key, keys)` (stable entity → slot), status colours, chart chrome constants (grid, axis, motion) |
| `format.ts` | `fmtSignedR`, `fmtMoney`, `fmtPct`, compact axis ticks, date-tick formatting, `niceDomain` — pure, unit-tested |
| `series.ts` | pure series transforms: equity annotation (change, peak, drawdown, max-DD point, new-high flags), baseline split offsets, histogram stats — unit-tested |
| `ChartCard` | the analytical card: title, subtitle/hint, headline value + delta, actions slot (tabs), legend slot, empty / loading (held-frame) states, footer stats |
| `ChartTooltip` | Recharts `content` renderer: value-leads hierarchy, line keys, per-series rows, optional change/contribution rows |
| `ChartLegend` | swatch/line-key legend, optional toggle (interactive filtering) |
| `EquityInstrument` | primary equity chart: baseline split gradient, peak & max-DD markers, rich step tooltip, period summary, optional synced drawdown pane |
| `DivergingBars` | horizontal R bars around a zero axis (groups), with win-rate + sample annotation |
| `ColumnChart` | vertical columns (weekday, month, hour, histogram) with signed tint |
| `CompositionBar` | win / loss / breakeven (or any part-to-whole ≤ 6) stacked bar with surface gaps + direct labels |
| `Meter` | ratio vs limit (prop-firm rules, adherence) with warning/danger thresholds |
| `CalendarHeatmap` | daily heat with month + weekday labels and a scale legend |

Mark specs (dataviz): 2px lines; bars ≤ 24px with 4px rounded data end;
~10–20% area washes; 1px **solid** recessive gridlines; ≥ 8px end-dots with a
2px surface ring; `tabular-nums` on ticks and tooltips; one y-axis only.
Motion: ≤ 400ms entrance on mount only, disabled under reduced motion; refetch
holds the previous frame at reduced opacity (no skeleton flash).

---

## Phases

| # | Phase | Scope | Status |
|---|---|---|---|
| 1 | Foundation | tokens in `globals.css`, `viz/` tokens/format/series + tests, ChartCard/ChartTooltip/ChartLegend, design-system §10 update | ✅ 2026-10-02 |
| 2 | Equity & drawdown instruments | `EquityInstrument`; Analytics equity + drawdown, Dashboard equity, Backtesting cumulative R, Prop-firm balance curve + overview (dual-axis → synced panes), mini curves; dev catalog at `/dev/viz` | ✅ 2026-10-02 |
| 3 | Analytics breakdowns & distributions | DivergingBars for every `GroupList`, R distribution, hour/weekday/month columns, composition bars, calendar heatmap, discrepancy, adherence, psychology, opportunity | ✅ 2026-10-02 |
| 4 | Dashboard · Today · Journal | KPI tiles with context, mini calendar heat, Today intraday progression, journal recap | ✅ 2026-10-02 |
| 5 | Strategy Lab · Backtesting · Edge · Prop Firms | identity colours for strategies, edge comparison lines, prop-firm meters/donuts/capital vs payouts | ✅ 2026-10-02 |
| 6 | Audit | light + dark, 390 / 768 / 1456 widths, empty/loading states; typecheck + lint + full test suite | ✅ 2026-10-02 |

---

## Findings

Calculation/semantic observations surfaced during the audit — **not changed**
by this work; each needs a product decision.

1. **Dashboard equity "R" tab is not realized R.** `CommandEquityCurve`'s
   `R` mode plots `cumulativeAdditive` (summed daily % returns), labelled R.
   The Analytics page's R tab uses the canonical `cumulativeRCurve`
   (realized R-multiples). Same label, different numbers on two pages.

2. **Locale-dependent formatting in client components (hydration risk).**
   ~14 client components format with `toLocaleString(undefined…)` /
   `Intl.NumberFormat(undefined…)`; the server and an en-GB/other-locale
   browser produce different strings ("$54,432.00" vs "US$54,432.00"),
   causing hydration mismatches. Fixed in the components this work touched
   (account balance curve, prop-firm overview) by pinning `en-US`; the rest
   are unchanged pending a decision on app-wide locale policy.
3. **Prop-firm overview was a dual-axis chart** (capital and payouts on
   independent left/right Y axes), contrary to design-system §10. Redrawn as
   two synced panes; the series themselves are unchanged.
4. **`MiniEquityCurve` shared one hard-coded gradient id** across every
   account card, so cards could render another card's profit/loss tint.
   Fixed (now the per-instance SVG `Sparkline`).
5. **App shell overflows by ~30px at exactly 768px.** At the `md` breakpoint
   the desktop sidebar (256px) plus the inset `main` (with `md:` margins)
   measure 798px in a 768px viewport, on every page. Pre-existing layout
   issue, outside this work; charts themselves are fluid.
6. **Today has no per-trade series.** `DailyAnalyticsDTO` carries only day
   totals, so an intraday cumulative-R progression (the natural Today chart)
   needs a small data addition — not done here (presentation-only scope).
7. **Platform-detection confidence bar was red.** `platform-select.tsx`
   painted its confidence % with `--chart-4` (the loss red). Now the data hue.

## Audit notes (Phase 6)
- `tsc`, `eslint src` (0 errors) and the full vitest suite pass; 5 server
  tests time out under full parallel load (MT5 parser row ceiling, backtest
  journal perf, native-replay sync) and all pass in isolation — pre-existing
  load flakiness, unrelated to this work.
- 390px: no horizontal overflow on Analytics, Dashboard or the catalog; time
  ticks thin automatically (`preserveStartEnd`).
- Dark mode reviewed on every primitive in `/dev/viz`.
- Recharts' draw-in animation does not advance in a hidden/background tab
  (rAF paused), so automated screenshots can catch a half-drawn line; real
  visible tabs are unaffected.

