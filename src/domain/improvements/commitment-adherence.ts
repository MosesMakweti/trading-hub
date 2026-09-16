/**
 * Commitment Adherence & Cross-Period Improvement Analytics (Stage 19).
 * Pure domain layer — owns every calculation in this stage's core question,
 * "I said I would improve this. Did I actually do it?" React components and
 * server services format/display these results; NOTHING recomputes
 * adherence, trend, or resolution eligibility independently (§35, §41).
 *
 * Process, never outcome (§33/§34): every function here reads only
 * behavior/process/execution/rule facts (`FOLLOWED`/`BREACHED` daily
 * states, or deterministic Stage 15 discrepancy evidence) — never PnL or
 * realized R. A perfectly-followed commitment on a losing trade is still
 * FOLLOWED; nothing in this module can see or use trade outcome to decide
 * otherwise.
 */

export type DailyStateStatus = "ACKNOWLEDGED" | "FOLLOWED" | "BREACHED";

export interface DailyStateForAdherence {
  dateKey: string; // YYYY-MM-DD
  status: DailyStateStatus;
}

/**
 * §9/§10 — ACKNOWLEDGED is tracked separately and NEVER counted as an
 * applicable observation; the denominator is strictly `followed + breached`.
 * `adherence` is `null` (never 0, never fabricated) when there are zero
 * applicable observations — "no data" is not "0% adherence."
 */
export interface AdherenceResult {
  followed: number;
  breached: number;
  acknowledgedCount: number;
  /** followed + breached — the honest sample size (§11). */
  applicableObservations: number;
  adherence: number | null;
}

export function computeAdherence(states: DailyStateForAdherence[]): AdherenceResult {
  let followed = 0;
  let breached = 0;
  let acknowledgedCount = 0;
  for (const s of states) {
    if (s.status === "FOLLOWED") followed += 1;
    else if (s.status === "BREACHED") breached += 1;
    else acknowledgedCount += 1;
  }
  const applicableObservations = followed + breached;
  return {
    followed,
    breached,
    acknowledgedCount,
    applicableObservations,
    adherence: applicableObservations > 0 ? followed / applicableObservations : null,
  };
}

/** Filters a flat list of daily states down to those within `[periodStart, periodEnd]` (dateKey string comparison — safe since YYYY-MM-DD sorts lexicographically). */
export function filterStatesInPeriod(states: DailyStateForAdherence[], periodStart: string, periodEnd: string): DailyStateForAdherence[] {
  return states.filter((s) => s.dateKey >= periodStart && s.dateKey <= periodEnd);
}

/** §12 — one lineage's adherence for current period / previous period-with-lineage (if any) / lifetime, all from the SAME underlying daily-state list. */
export interface PeriodAdherenceBreakdown {
  current: AdherenceResult;
  previous: AdherenceResult | null;
  lifetime: AdherenceResult;
}

export function computePeriodAdherence(
  allStates: DailyStateForAdherence[],
  currentPeriod: { start: string; end: string },
  previousPeriod: { start: string; end: string } | null,
): PeriodAdherenceBreakdown {
  const current = computeAdherence(filterStatesInPeriod(allStates, currentPeriod.start, currentPeriod.end));
  const previous = previousPeriod ? computeAdherence(filterStatesInPeriod(allStates, previousPeriod.start, previousPeriod.end)) : null;
  const lifetime = computeAdherence(allStates);
  return { current, previous, lifetime };
}

// ── Trend classification (§13/§14) ──────────────────────────────────────────

export type AdherenceTrend = "IMPROVING" | "STABLE" | "DECLINING" | "INSUFFICIENT_DATA";

/**
 * Conservative, centralized, documented thresholds (§13/§25 — "exact
 * thresholds should be centralized and tested"). A trend is NEVER
 * classified from a single isolated observation: both periods being
 * compared must independently clear `MIN_OBSERVATIONS_FOR_TREND`.
 */
export const TREND_MIN_OBSERVATIONS_PER_PERIOD = 3;
export const TREND_IMPROVING_DELTA = 0.15; // +15 percentage points or more
export const TREND_DECLINING_DELTA = -0.15;

export function classifyTrend(current: AdherenceResult, previous: AdherenceResult | null): AdherenceTrend {
  if (!previous) return "INSUFFICIENT_DATA";
  if (current.adherence == null || previous.adherence == null) return "INSUFFICIENT_DATA";
  if (current.applicableObservations < TREND_MIN_OBSERVATIONS_PER_PERIOD || previous.applicableObservations < TREND_MIN_OBSERVATIONS_PER_PERIOD) {
    return "INSUFFICIENT_DATA";
  }
  const delta = current.adherence - previous.adherence;
  if (delta >= TREND_IMPROVING_DELTA) return "IMPROVING";
  if (delta <= TREND_DECLINING_DELTA) return "DECLINING";
  return "STABLE";
}

// ── Resolution eligibility (§24/§25) — a SUGGESTION only, never automatic ──

/**
 * Conservative, centralized, documented thresholds. Resolution is ALWAYS a
 * trader decision (§24) — this only computes whether Traditorium may
 * display "Potentially ready to resolve." Requires: lifetime adherence at
 * or above the bar, a minimum lifetime sample size, at least two DISTINCT
 * periods that each independently clear the bar (never one lucky period),
 * and no breach among the most recent applicable observations.
 */
export const RESOLUTION_MIN_ADHERENCE = 0.9;
export const RESOLUTION_MIN_LIFETIME_OBSERVATIONS = 5;
export const RESOLUTION_MIN_SUSTAINED_PERIODS = 2;
export const RESOLUTION_RECENT_BREACH_LOOKBACK = 3;

export interface PeriodAdherenceSample {
  periodStart: string;
  result: AdherenceResult;
}

/**
 * `chronologicalStates` must be sorted ascending by `dateKey` — the "no
 * severe recent breach" check looks at the tail of this list.
 */
export function computeResolutionEligibility(
  lifetime: AdherenceResult,
  periods: PeriodAdherenceSample[],
  chronologicalStates: DailyStateForAdherence[],
): boolean {
  if (lifetime.adherence == null || lifetime.adherence < RESOLUTION_MIN_ADHERENCE) return false;
  if (lifetime.applicableObservations < RESOLUTION_MIN_LIFETIME_OBSERVATIONS) return false;

  const sustainedPeriods = periods.filter((p) => p.result.adherence != null && p.result.adherence >= RESOLUTION_MIN_ADHERENCE && p.result.applicableObservations > 0);
  if (sustainedPeriods.length < RESOLUTION_MIN_SUSTAINED_PERIODS) return false;

  const applicableTail = chronologicalStates.filter((s) => s.status === "FOLLOWED" || s.status === "BREACHED").slice(-RESOLUTION_RECENT_BREACH_LOOKBACK);
  if (applicableTail.some((s) => s.status === "BREACHED")) return false;

  return true;
}

// ── Formatting — never false precision (§14) ────────────────────────────────

/** Whole-percent only — never "37.42%". Returns null passthrough for "no data." */
export function formatAdherencePercent(adherence: number | null): string | null {
  return adherence == null ? null : `${Math.round(adherence * 100)}%`;
}

// ── Automatic (system-observed) evidence derivation (§15/§16/§42) ──────────
// Every function below takes ALREADY-COMPUTED evidence as input — none of
// them run a comparison or query Prisma themselves (§35/§42: reuse Stage 15
// discrepancy evidence, never rebuild it). Each produces at most ONE
// FOLLOWED/BREACHED verdict per day (the existing per-day schema
// granularity — §39's "prove DailyState can't represent this" bar wasn't
// met, so no new observation table was introduced): if MULTIPLE applicable
// events happen on the same day, a single BREACHED event makes the whole
// day BREACHED (a conservative "any breach counts" aggregation), otherwise
// any FOLLOWED evidence makes it FOLLOWED.

export interface SystemDerivedDailyState {
  dateKey: string;
  status: "FOLLOWED" | "BREACHED";
  evidence: { description: string; category: string };
  relatedTradeId: string | null;
}

function aggregateDailyVerdicts(events: { dateKey: string; status: "FOLLOWED" | "BREACHED"; description: string; category: string; relatedTradeId: string | null }[]): SystemDerivedDailyState[] {
  const byDay = new Map<string, SystemDerivedDailyState>();
  for (const e of events) {
    const existing = byDay.get(e.dateKey);
    if (!existing || (existing.status === "FOLLOWED" && e.status === "BREACHED")) {
      byDay.set(e.dateKey, { dateKey: e.dateKey, status: e.status, evidence: { description: e.description, category: e.category }, relatedTradeId: e.relatedTradeId });
    }
  }
  return [...byDay.values()];
}

/**
 * §15 "Invalid setup / override discipline" — derived DIRECTLY from real
 * `Trade.validationState`, no Replay/Comparison required (§43 — this rule
 * degrades gracefully to "no observations" only when the trader simply
 * didn't take any trades with a known validation state that day, never
 * because Replay wasn't run). A trade taken via `OVERRIDDEN` is a breach
 * (a discretionary override of an invalid setup); a trade taken `VALIDATED`
 * is evidence the trader stuck to valid setups that day.
 */
export function deriveOverrideDisciplineObservations(
  trades: { id: string; dateKey: string; validationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null }[],
): SystemDerivedDailyState[] {
  const events = trades
    .filter((t) => t.validationState === "VALIDATED" || t.validationState === "OVERRIDDEN")
    .map((t) => ({
      dateKey: t.dateKey,
      status: (t.validationState === "OVERRIDDEN" ? "BREACHED" : "FOLLOWED") as "FOLLOWED" | "BREACHED",
      description: t.validationState === "OVERRIDDEN" ? "A trade was taken via a discretionary override of an invalid setup." : "A trade was taken on a validated setup, no override used.",
      category: "OVERRIDE_DISCIPLINE",
      relatedTradeId: t.id,
    }));
  return aggregateDailyVerdicts(events);
}

/** §15 "Stop widening" — from Stage 15's `ExecutionDiscrepancyEvent[]` (category `STOP_WIDENING`), never recomputed. */
export function deriveStopWideningObservations(events: { dateKey: string; category: string; description: string }[]): SystemDerivedDailyState[] {
  return aggregateDailyVerdicts(
    events.filter((e) => e.category === "STOP_WIDENING").map((e) => ({ dateKey: e.dateKey, status: "BREACHED" as const, description: e.description, category: "STOP_WIDENING", relatedTradeId: null })),
  );
}

/** §15 "Premature close" — from Stage 15's `ExecutionDiscrepancyEvent[]` (category `PREMATURE_CLOSE`). */
export function derivePrematureCloseObservations(events: { dateKey: string; category: string; description: string }[]): SystemDerivedDailyState[] {
  return aggregateDailyVerdicts(
    events.filter((e) => e.category === "PREMATURE_CLOSE").map((e) => ({ dateKey: e.dateKey, status: "BREACHED" as const, description: e.description, category: "PREMATURE_CLOSE", relatedTradeId: null })),
  );
}

/** §15 "Missed opportunity" — from Stage 15.2's `ConfirmedMissedOpportunityEntry[]` — ONLY confirmed entries, never every unmatched Replay decision. */
export function deriveMissedOpportunityObservations(entries: { dateKey: string; replayTradeId: string }[]): SystemDerivedDailyState[] {
  return aggregateDailyVerdicts(
    entries.map((e) => ({ dateKey: e.dateKey, status: "BREACHED" as const, description: "A confirmed missed opportunity was identified for this day.", category: "MISSED_OPPORTUNITY", relatedTradeId: e.replayTradeId })),
  );
}

/**
 * §19.1-25/26 "Behaviour label pattern" — from the ALREADY-FROZEN
 * `BehavioralDiscrepancyEvent[]` (category `BEHAVIOUR_LABEL_EVIDENCE` —
 * a NEGATIVE-polarity behaviour label the trader attached to an Actual
 * trade, resolved upstream by the comparison engine using the label's
 * stable identity/polarity, never free-text/NLP matching here). Breach-
 * only by design (§25 evidence test §3: the ABSENCE of a negative label on
 * a day proves nothing — a day with no trades at all looks identical to a
 * disciplined day, so FOLLOWED cannot be defensibly claimed).
 */
export function deriveBehaviourLabelObservations(events: { dateKey: string; category: string; description: string }[]): SystemDerivedDailyState[] {
  return aggregateDailyVerdicts(
    events
      .filter((e) => e.category === "BEHAVIOUR_LABEL_EVIDENCE")
      .map((e) => ({ dateKey: e.dateKey, status: "BREACHED" as const, description: e.description, category: "BEHAVIOUR_LABEL_PATTERN", relatedTradeId: null })),
  );
}

/**
 * §19.1-28 "Overtrading" — derived from the Daily Market Plan's OWN
 * explicit, trader-set `maxTradesPerDay` boundary for that specific day
 * (`TradingDay.maxTradesPerDay`), compared against that day's ACTUAL
 * executed-trade count — never a strategy-level default, never inferred.
 * Applicability requires the day to have BOTH a boundary set AND at least
 * one trade — a day with zero trades proves nothing about resisting the
 * urge to overtrade (§28: "do not count every under-limit day as a
 * success if no trading opportunity existed").
 */
export function deriveOvertradingObservations(
  days: { dateKey: string; maxTradesPerDay: number; tradeCount: number }[],
): SystemDerivedDailyState[] {
  const events = days
    .filter((d) => d.tradeCount >= 1)
    .map((d) => ({
      dateKey: d.dateKey,
      status: (d.tradeCount > d.maxTradesPerDay ? "BREACHED" : "FOLLOWED") as "FOLLOWED" | "BREACHED",
      description:
        d.tradeCount > d.maxTradesPerDay
          ? `${d.tradeCount} trades taken, exceeding the day's plan of ${d.maxTradesPerDay}.`
          : `${d.tradeCount} trade(s) taken, within the day's plan of ${d.maxTradesPerDay}.`,
      category: "OVERTRADING_DISCIPLINE",
      relatedTradeId: null,
    }));
  return aggregateDailyVerdicts(events);
}

/**
 * §19.1-29 "Risk-limit discipline" — derived from the Daily Market Plan's
 * OWN explicit `riskBudgetPercent` for that day, compared against that
 * day's ACTUAL percent-based risk usage. Never inferred from PnL/drawdown
 * (§29). Applicability requires the day to have a boundary set AND at
 * least some measured percent-based risk that day (`riskUsedPercent > 0`)
 * — a day whose risk can't be reliably measured (e.g. every allocation
 * that day used a non-percent risk model) must be passed as `null`
 * `riskUsedPercent` by the caller and is excluded here entirely, rather
 * than risking a false "clean" day from an incomplete sum.
 */
export function deriveRiskLimitObservations(
  days: { dateKey: string; riskBudgetPercent: number; riskUsedPercent: number | null }[],
): SystemDerivedDailyState[] {
  const events = days
    .filter((d): d is { dateKey: string; riskBudgetPercent: number; riskUsedPercent: number } => d.riskUsedPercent != null && d.riskUsedPercent > 0)
    .map((d) => ({
      dateKey: d.dateKey,
      status: (d.riskUsedPercent > d.riskBudgetPercent ? "BREACHED" : "FOLLOWED") as "FOLLOWED" | "BREACHED",
      description:
        d.riskUsedPercent > d.riskBudgetPercent
          ? `${d.riskUsedPercent.toFixed(2)}% risk used, exceeding the day's budget of ${d.riskBudgetPercent}%.`
          : `${d.riskUsedPercent.toFixed(2)}% risk used, within the day's budget of ${d.riskBudgetPercent}%.`,
      category: "RISK_LIMIT_DISCIPLINE",
      relatedTradeId: null,
    }));
  return aggregateDailyVerdicts(events);
}

/**
 * Maps a commitment's stable rule identity (`sourceFindingType`, set for a
 * SUGGESTED-origin commitment, or explicitly opted into on a MANUAL one —
 * §19.1-24 relaxes the Stage 19 "SUGGESTED only" comment: `source` and
 * `sourceFindingType` are orthogonal — one records WHO authored the
 * commitment, the other records WHETHER a deterministic rule can supply
 * its evidence) to the automatic evidence rule that can support it, if
 * any. A commitment with no rule mapping stays Today-level/manual-only
 * (§21) — this is never a keyword-guessing match over free text.
 */
export const AUTOMATIC_EVIDENCE_RULE_KEYS = [
  "OVERRIDE_DISCIPLINE",
  "STOP_WIDENING_PATTERN",
  "PREMATURE_CLOSE_PATTERN",
  "MISSED_OPPORTUNITY_DISCIPLINE",
  "BEHAVIOUR_LABEL_PATTERN",
  "OVERTRADING_DISCIPLINE",
  "RISK_LIMIT_DISCIPLINE",
] as const;
export type AutomaticEvidenceRuleKey = (typeof AUTOMATIC_EVIDENCE_RULE_KEYS)[number];

export function hasAutomaticEvidenceRule(sourceFindingType: string | null): sourceFindingType is AutomaticEvidenceRuleKey {
  return sourceFindingType != null && (AUTOMATIC_EVIDENCE_RULE_KEYS as readonly string[]).includes(sourceFindingType);
}

/** Single canonical human-readable label per automatic evidence rule key —
 *  reused by the Analytics → Improvement chart AND the Stage 20.1 AI
 *  evidence package (`behaviorOccurrenceTrends`), so the trader and the
 *  analyst never see two different names for the same rule. */
export const RULE_KEY_LABELS: Record<AutomaticEvidenceRuleKey, string> = {
  OVERRIDE_DISCIPLINE: "Discretionary overrides",
  STOP_WIDENING_PATTERN: "Stop widening",
  PREMATURE_CLOSE_PATTERN: "Premature close",
  MISSED_OPPORTUNITY_DISCIPLINE: "Missed opportunities",
  BEHAVIOUR_LABEL_PATTERN: "Flagged behaviour pattern",
  OVERTRADING_DISCIPLINE: "Overtrading",
  RISK_LIMIT_DISCIPLINE: "Risk-limit breaches",
};

export function ruleKeyLabel(ruleKey: string): string {
  return hasAutomaticEvidenceRule(ruleKey) ? RULE_KEY_LABELS[ruleKey] : ruleKey;
}

// ── Continuation status (§4/§6 — deriving carry-forward from relationships, never a new status) ──

/**
 * A RETIRED commitment is ambiguous on its own: was it genuinely dismissed,
 * or superseded by a continuation/refinement? This is derivable purely
 * from whether another commitment's `previousCommitmentId` points back to
 * it — no extra status value needed (§4).
 */
export function describeRetirement(wasContinued: boolean): "SUPERSEDED" | "DISMISSED" {
  return wasContinued ? "SUPERSEDED" : "DISMISSED";
}

/** The effective lineage id every commitment in a chain shares (§3/§7) — the chain's ROOT id, whether or not this row IS the root. */
export function effectiveLineageId(commitment: { id: string; lineageId: string | null }): string {
  return commitment.lineageId ?? commitment.id;
}
