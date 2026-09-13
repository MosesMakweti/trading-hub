# Traditorium AI Review Analyst (Stage 20)

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
