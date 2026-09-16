# Traditorium AI Review Analyst (Stage 20, hardened in Stage 20.1)

## What Traditorium AI does

Analyzes the **trader's process** for one finalized Edge Review period
(WEEKLY or MONTHLY): planning, strategy/setup performance, validation and
overrides, execution quality, behavior, psychology, Replay comparison,
commitment adherence, and longitudinal improvement. It answers one
question: *based on how this trader planned, executed, reviewed, replayed,
and worked on previous weaknesses, what patterns are developing, what is
helping or hurting their process, and what deserves attention next?*

## What it does not do

- Predict market direction, generate a trade signal, or select assets/setups.
- Optimize an entry from future price behavior.
- Act as an autonomous trading agent or place/modify trades.
- Modify Strategy configuration, historical Journal records, or Replay data.
- Automatically create, retire, refine, or resolve a commitment — the
  trader always decides.

AI interpretation sits **above** the deterministic systems (Stages 1-19.1)
and never replaces them. The Comparison, Improvements, and Analytics tabs
remain fully available and are always the ground truth the Analyst's
claims trace back to.

## Architecture

```
Canonical trader data (Trade, TradingDay, WeeklyReview, ...)
  -> Deterministic analytics / commitment adherence (Stage 19/19.1 read models)
  -> Replay / Comparison (Stage 12-15.2)
  -> Discrepancy classification (Stage 15)
  -> buildTraderReviewEvidencePackage()  [src/server/services/ai-review-evidence.service.ts]
  -> TraderReviewAnalystProvider.analyzeReview()  [src/domain/ai-review/providers/*]
  -> Validated TraderReviewAnalystReport
  -> Persisted AiReviewAnalystReport row
  -> Edge -> Analyst tab
```

The evidence builder composes EXISTING read models (`getReplayComparison`,
`listCommitmentsForSession`/`getCommitmentLineage`, `buildImprovementAnalytics`,
`getWeeklyReview`) rather than duplicating their calculations. The model
never receives raw database access or unrestricted history — only a
bounded, deliberately-extracted evidence package for one period.

## Evidence hierarchy

Every fact in the evidence package (`EvidenceItem.strength`) is tagged as
exactly one of:

- **OBJECTIVE** — a system-computed fact (e.g. "4 invalid overrides").
- **DERIVED** — a deterministic interpretation Traditorium already computed
  (e.g. an Execution Discrepancy, a commitment trend of DECLINING).
- **TRADER_REPORTED** — the trader's own entered reflection/psychology/
  behavior label.

The system prompt instructs the model to never blur these, and to weight
TRADER_REPORTED evidence as self-report rather than verified fact.

## Grounding

Every finding in a `TraderReviewAnalystReport` (strengths, concerns,
recurringPatterns, improvementProgress, priorityFocus) must cite one or
more `evidenceIds` copied verbatim from the package's `evidenceIndex`.
`validateCitations` (`src/domain/ai-review/report-schema.ts`) checks every
citation against the package after the model responds; an unknown id
triggers one corrective retry, then a clean `INVALID_CITATIONS` failure —
never a silently-rendered fabricated citation. `evidenceCoverage` (how much
of the available evidence was actually cited) is computed by the
application after validation, never self-reported by the model.

## Historical stability

A generated report is persisted as an immutable `AiReviewAnalystReport`
row, tied to:

- the review session
- an `evidenceFingerprint` (a deterministic SHA-256 hash of the evidence
  package's content — `computeEvidenceFingerprint`)
- `evidencePackageVersion` and `promptVersion` (schema/prompt versions,
  separate from the fingerprint)
- `provider`, `model`, `generatedAt`
- `evidenceIndexJson` — the citation index AS IT WAS at generation time, so
  a historical report's evidence links stay inspectable even if the
  underlying data later changes

Regeneration ("Regenerate" in the Analyst tab) always inserts a **new**
row — a persisted report is never overwritten. "The current report" is
simply the most recent row by `generatedAt`; older generations remain
queryable as history. Staleness (the underlying evidence has changed since
generation — e.g. a commitment observation was logged after finalization)
is detected deterministically by rebuilding the evidence package and
comparing fingerprints — the AI is never asked whether it's stale.

## Grounding safeguards encoded in the system prompt

- **Causality guard** — never claim a causal relationship from mere
  correlation ("FOMO caused your losses" is disallowed; "FOMO labels
  appeared more often on breached trades" is the expected framing).
- **Strategy Variance protection** — a correctly-executed losing trade is
  normal variance, never a behavioral failure; the model is told to use
  the package's own Strategy Variance / Execution Discrepancy / Behavioral
  Discrepancy / Opportunity Discrepancy classification, never reclassify.
- **Process over outcome** — process quality, adherence, execution, and
  behavior are prioritized over raw PnL/win-rate.
- **Small-sample protection** — a pattern resting on one trade/label/
  observation must be named as insufficient evidence, not a stable pattern.
- **Contradictory evidence** — a trader's self-report that conflicts with
  recorded objective evidence must be surfaced respectfully, not silently
  resolved in either direction (objective evidence generally weighs more).
- **Missing-data awareness** — the package's `missingData` array names
  every unavailable category explicitly; the model must never infer a
  missing category's content.
- **Prompt-injection boundary** — trader-entered text (reflections, notes,
  labels, strategy/setup names) is embedded only inside the user message's
  evidence-package JSON, explicitly labeled as data, never concatenated
  into the system prompt; the system prompt tells the model to treat any
  instruction-like text found inside evidence as a quoted fact, never as
  something to obey.

## Confidence semantics

Qualitative only — `HIGH` / `MEDIUM` / `LOW`, defined in the system prompt
(multiple objective evidence points / limited or mixed evidence / small
sample or primarily trader-reported). The model is never permitted to
output a numeric probability as "confidence."

## Provider

`@anthropic-ai/sdk` was already a project dependency (used by the Trade
Plan screenshot-recognition feature — `domain/trade-plan/providers/
claude-vision-provider.ts`). Stage 20 reuses that exact precedent: a
provider-independent interface (`TraderReviewAnalystProvider`), a forced
single tool call for structured output, the same SDK error-class mapping
convention, and a `NullTraderReviewAnalystProvider` fallback for
environments without `ANTHROPIC_API_KEY` (mirroring `NullRecognitionProvider`).
Exactly one real provider is implemented in Stage 20
(`ClaudeTraderReviewAnalystProvider`); no other AI vendor is introduced.
The model id is server-configurable (`ANTHROPIC_ANALYST_MODEL`, default
`claude-opus-5`) — a historical report always persists the exact model
name used at generation time (`row.model`), so changing this env var never
silently rewrites what an old report says it was generated with. See
`AI_ANALYST_PRODUCTION_READINESS.md` for the readiness state model and
live-acceptance checklist.

## Failure states

`AnalystFailureReason`: `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `RATE_LIMITED`,
`INVALID_RESPONSE`, `INVALID_CITATIONS`, `REFUSED`, `PACKAGE_TOO_LARGE`,
`UNKNOWN_ERROR`. Every failure is a typed result, never a thrown exception
into Edge Review — the UI shows "AI analysis unavailable" (or the specific
reason) and the deterministic Comparison/Improvements/Analytics tabs stay
fully usable. Nothing ever substitutes deterministic findings and presents
them as if they came from the AI.

## Privacy / data minimization

The evidence package never includes email, user id, account credentials,
or monetary account identifiers — only trading-process evidence needed for
analysis (trade dates, R-multiples, setup/strategy names as historically
snapshotted, validation states, behavior labels, psychology scores,
discrepancy classifications, commitment adherence, reflections). Verified
by an automated test that serializes a built package and asserts it never
contains the trader's email or user id.

## Future expansion

A conversational analyst (follow-up questions, chat-style exploration) is
explicitly deferred — Stage 20 is a structured report only. No model
training, fine-tuning, embeddings, or vector database is used or planned
here; a future conversational layer would consume this same structured
evidence layer rather than replacing it.

## Stage 20.1 — longitudinal behavior, report history, production hardening

Stage 20.1 is a focused completion/hardening pass on the Stage 20
architecture above — no redesign, only extension. See
`AI_ANALYST_PRODUCTION_READINESS.md` for the provider readiness model and
live-acceptance checklist.

### Longitudinal behavior evidence

The evidence package gained two new sections, both reused directly from
Stage 19.1's canonical `buildImprovementAnalytics` read model — nothing
here recomputes adherence or breach counts independently:

- **`behaviorOccurrenceTrends`** — one entry per automatic-evidence rule
  key (`AUTOMATIC_EVIDENCE_RULE_KEYS`, e.g. stop-widening, overtrading),
  each with a review-type-scoped, chronological breach-count series
  (`behaviourOccurrence` packaged verbatim), a human-readable label
  (`ruleKeyLabel` — the SAME map the Analytics → Improvement chart uses,
  in `domain/improvements/commitment-adherence.ts`), and, when a
  currently-active commitment backs that exact rule, its own lineage
  `trend`/`currentApplicableObservations` copied verbatim (never
  recomputed). Bounded to the top 6 rules by total breach count and the 8
  most recent periods per rule, with every truncation recorded in
  `truncation`. Weekly and monthly are never blended — the section is
  always scoped to the review session's own `reviewType`, exactly as
  `buildImprovementAnalytics` was already called.
  - **Strength: DERIVED, not OBJECTIVE.** Each point is a deterministic
    AGGREGATION (a count of BREACHED daily observations within one review
    period) one layer removed from the individual OBJECTIVE
    FOLLOWED/BREACHED facts underneath it — the same OBJECTIVE→DERIVED
    boundary a commitment's own `trend` already crosses.
- **`commitmentBehaviorCrossChecks`** — pairs one active commitment's own
  adherence with its rule's `behaviorOccurrenceTrends` series, plus a
  deterministic `signal`: `CONVERGING` (healthy adherence + a declining
  breach trend), `CONTRADICTORY` (a perfect 100% current-period adherence
  yet the SAME period still shows a breach — possible because the trend
  aggregates every lineage ever tagged with that rule, e.g. a separate
  historical commitment for the same rule), or `NEUTRAL`. Deliberately
  period-aligned rather than "the last array entry" — the underlying
  series only records periods with ≥1 breach, so comparing against the
  bare last point would flag a stale, long-past breach as a live
  contradiction. The model is told (system prompt) to describe a
  `CONTRADICTORY` signal honestly, never to manufacture a reconciliation.

The system prompt gained matching safeguards: weekly/monthly series are
never compared as if the same duration; a trend with `currentTrend`
`INSUFFICIENT_DATA`/`null` or fewer than 3 points must be described as
insufficient evidence; absolute claims ("you always," "you never," "you
have solved this," "this is now fixed") are disallowed in favor of
"in the observed periods," "the recent trend suggests," "this pattern has
decreased," or "there is still limited evidence."

### Evidence coverage summary

`EvidenceCoverageSummary` (trades/behavioral events/discrepancy
events/commitments included, Replay/psychology/longitudinal-behavior
availability) is computed once at generation time from real counts (not
derived from the flat `evidenceIndex`, which loses fidelity) and persisted
alongside the report (`coverageSummaryJson`, nullable for pre-Stage-20.1
rows) — a historical report always shows ITS OWN coverage, never today's.

### Report history

`listReviewAnalysisHistory`/`getReviewAnalysisById` (service) and their
matching actions expose every past generation for a session, newest
first. Opening an older generation renders its own persisted
`reportJson`/`evidenceIndexJson`/`coverageSummaryJson` exactly as
generated — evidence citations are NEVER resolved against a live rebuilt
package, and only the single most recent row (`isCurrent`) is ever
eligible for the `stale` flag; an older generation is simply "a previous
generation," never "stale." The Analyst tab shows a collapsible "Previous
Generations" list, a "Viewing a previous generation" banner with a "Back
to current" action when browsing history, and swaps the primary button's
label between "Generate Review Analysis" (no report yet), "Regenerate"
(current report is fresh), and "Generate Updated Analysis" (current
report is stale) — regeneration is always an explicit click, never
automatic.
