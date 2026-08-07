# Confluence Probability Scoring — feature tracker

Upgrades the SOT confluence checklist into a **weighted, probability-based setup-scoring**
system. Built as an extension of the Strategy = Single Source of Truth work (see
[STRATEGY_SOT.md](STRATEGY_SOT.md)) — no architecture rebuild. **COMPLETE (C1–C6).**

## What it does
- Each confluence is now: name · description · category · color · **type (Mandatory | Optional)** ·
  **weight (0–100)** · **validation criteria** · enabled.
- **Mandatory** confluences gate setup validity; a setup missing any mandatory confluence is
  **"Invalid Setup — Missing Core Requirement"** and not treated as a valid probability.
- **Weighted setup score** = completed confluence weight ÷ total strategy confluence weight × 100.
- **Rating bands**: A+ 95–100 · A 85–94 · B 75–84 · C 65–74 · Low < 65.
- Frozen onto every trade at save time (immutable history), shown live in Add Trade, and analyzed
  ("which confluence combinations win most?").

## Data model (migration `20260807000000_confluence_scoring`, additive)
- `StrategyChecklistItem`: `+ mandatory Boolean @default(false)`, `+ validationCriteria String?`
  (weight/color/category/description already existed from the SOT work).
- `Trade`: `+ setupScore Float?`, `+ setupRating String?`, `+ setupValid Boolean?`,
  `+ missingConfluences Json?` (string[]). Alongside the existing count-based
  `confluencePercent`/`executionPercent`/`tradeQualityPercent`.

## Key files
- **Engine (pure, tested):** `domain/trades/setup-score.ts` (`scoreSetup`, `ratingForScore`) — 5 tests.
  Weighted score, mandatory-gated validity, missing confluences, rating band.
- **Save path:** `trades.service.ts` → `buildStrategyExecution` computes + freezes
  `setupScore/setupRating/setupValid/missingConfluences` from the strategy's frozen expected
  confluences (weights + mandatory) vs what was present.
- **Reference:** `StrategyChecklistRef.mandatory` + `getStrategyReference` carry it to the trade form.
- **Builder UI:** `strategy-checklist-section.tsx` — Mandatory/Optional toggle + validation-criteria
  field (gated to CONFLUENCE), "Core" badge, total-weight summary.
- **Score card:** `components/journal/setup-score-card.tsx` (`SetupScoreCard`, `RatingBadge`) —
  probability meter + rating, or the Invalid-Setup state. Used live in `trade-form.tsx` and on the
  trade workspace / card.
- **Analytics:** `domain/performance/adherence-analytics.ts` → `confluenceCombinations` (win rate per
  exact confluence set, min 2 trades) + the per-confluence leaderboard; rendered by
  `components/analytics/adherence-analytics.tsx`.

## Build log (each step: tsc + eslint clean, tests green)
- **C1** ✅ Data model + validation + migration (applied; client regenerated). 186 tests.
- **C2** ✅ Confluence Builder UI (mandatory toggle, validation criteria, weight summary). 186.
- **C3** ✅ Weighted engine `setup-score.ts` (+5 tests) + save-path freezing. 191.
- **C4** ✅ Add-Trade Setup Quality card (live probability meter + rating + Invalid state). 191.
- **C5** ✅ Display setup score/rating on the trade workspace + card (DTOs + mapper). 191.
- **C6** ✅ Confluence-combination win-rate analytics (+2 tests) + Analytics card table. 193.

## Notes / future
- Weights that total 100 make the score read as a clean percentage (UI hints this); if a strategy
  defines no weights, `setupScore` is null and the card prompts to add weights.
- Execution confirmations reuse the same model but keep the simple (non-mandatory) UI.
- Both adherence measures coexist: count-based `confluencePercent`/`executionPercent` (P6) **and**
  the weighted `setupScore` — plus the existing 8-question self-rating.
