// The Counterfactual Engine — Traditorium's Discrepancy Gap, rebuilt from first
// principles. The gap is NO LONGER "expected − actual" (which wrongly penalised a
// correctly-executed loss). It is:
//
//   The cumulative R lost or gained because the trader deviated from their valid
//   process — reconstructed per event against the documented plan.
//
// Two curves:
//   • Actual Equity          = Σ realized R (what actually happened).
//   • Process-Perfect Equity = Σ the R a disciplined trader following the strategy,
//                              risk rules, execution rules and psychological process
//                              would have produced for the SAME opportunities.
//
// A correctly-executed valid win OR loss ⇒ processPerfectR == actualR ⇒ ZERO gap.
// The gap accrues ONLY from attributable deviations (execution slip, invalid trades,
// FOMO/revenge, over-risk, missed valid winners, adherence breaches, …).
//
// Where a deviation's R impact is objectively measurable we compute it (MEASURED).
// Where it is a real breach but the R cost cannot be known, we DO NOT invent a
// number — we record it FLAGGED (severity/confidence/category, rImpact = null) so it
// informs the attribution + process-quality score without fabricating equity.
//
// Lucky breaches (a trade the process would NOT have taken that happened to win) are
// flagged and their winnings recorded as `unearnedR` — never shaded, never rewarded.
//
// Pure + framework-free; fully unit-tested. Reuses the deviation-engine for the
// objective entry/exit/risk R-costs — no duplicate price math here.

import type { Deviation } from "./deviation-engine";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

// ── Vocabulary ───────────────────────────────────────────────────────────────

export type LeakageCategory =
  | "EXECUTION" // entry slip, premature exit, loss overrun — objective price deviations
  | "RISK" // over/under-risk vs plan, daily-risk-limit breach
  | "STRATEGY_ADHERENCE" // invalid setup, missing mandatory confluence, session/exec-confirmation breach
  | "BEHAVIORAL" // FOMO / revenge / impulse / would-not-repeat / manual override / overtrading
  | "OPPORTUNITY"; // valid winner that was missed

export type Severity = "LOW" | "MEDIUM" | "HIGH";
/** MEASURED = objective R; FLAGGED = a real breach whose R is not knowable (never fabricated). */
export type Confidence = "MEASURED" | "FLAGGED";

/** Behavioral intent tag (Trade.tradeIntent). Null on historical rows → inferred. */
export type BehaviorTag = "PLANNED" | "FOMO" | "REVENGE" | "BOREDOM" | "IMPULSE" | "MANUAL_OVERRIDE";

// Intents that mean "a disciplined process would NOT have taken this trade at all".
const SKIP_TAGS: ReadonlySet<BehaviorTag> = new Set(["FOMO", "REVENGE", "IMPULSE", "BOREDOM"]);

export interface LeakageEvent {
  category: LeakageCategory;
  cause: string; // stable slug, e.g. "late-entry" | "invalid-setup" | "fomo" | "missed-winner"
  label: string;
  /** Objective recoverable R (≥ 0), or null when the breach is real but its R is unknown. */
  rImpact: number | null;
  severity: Severity;
  confidence: Confidence;
  attributionKnown: boolean; // === (rImpact != null)
}

export interface EventCounterfactual {
  eventId: string;
  kind: "EXECUTED" | "MISSED";
  sequence: number;
  dateKey: string;
  actualR: number; // realized R (0 for a missed opportunity)
  processPerfectR: number; // disciplined counterfactual R for this event
  /** max(0, processPerfectR − actualR) — the measurable recoverable edge (shaded). */
  avoidableR: number;
  /** max(0, actualR − processPerfectR) — R won by breaching process (tracked, never shaded). */
  unearnedR: number;
  processBreach: boolean;
  validSetup: boolean;
  leakages: LeakageEvent[];
}

// ── Event inputs (the service maps Prisma → these) ───────────────────────────

export interface ExecutedEventInput {
  kind: "EXECUTED";
  eventId: string;
  sequence: number;
  dateKey: string;
  /** Realized R multiple. null = not yet settled (Stage C.1: pending, not a
   *  0R breakeven) → reconstructExecuted returns a true no-op for it,
   *  before any deviation/behavioral analysis runs, rather than fabricating
   *  a discrepancy against an unknown outcome. */
  actualR: number | null;
  /** setupValid — false ⇒ invalid setup taken. null = unknown (not treated as invalid). */
  validSetup: boolean | null;
  /** Expected-but-absent mandatory confluences — non-empty ⇒ invalid setup. */
  missingConfluences: string[];
  /** Objective entry/exit/risk deviations (from computeDeviations). */
  deviations: Deviation[];
  wouldTakeAgain: boolean | null;
  behaviorTag: BehaviorTag | null;
  psychologyPercent: number | null;
  // Flagged-only breach signals (real breaches, R not objectively knowable):
  sessionViolation?: boolean;
  missingExecutionConfirmations?: number;
  exceededDailyRisk?: boolean;
  overtrade?: boolean;
}

export interface MissedEventInput {
  kind: "MISSED";
  eventId: string;
  sequence: number;
  dateKey: string;
  validSetup: boolean | null;
  /** Trader-entered realized-if-taken R (>0 winner, <0 loser, null undetermined). */
  missedRealizedR: number | null;
}

export type CounterfactualInput = ExecutedEventInput | MissedEventInput;

// ── Per-event reconstruction ─────────────────────────────────────────────────

function severityFromR(r: number): Severity {
  const a = Math.abs(r);
  if (a >= 1) return "HIGH";
  if (a >= 0.4) return "MEDIUM";
  return "LOW";
}

const BEHAVIOR_LABEL: Record<BehaviorTag, string> = {
  PLANNED: "Planned",
  FOMO: "FOMO trade",
  REVENGE: "Revenge trade",
  BOREDOM: "Boredom trade",
  IMPULSE: "Impulsive trade",
  MANUAL_OVERRIDE: "Manual intervention vs plan",
};

function reconstructExecuted(input: ExecutedEventInput): EventCounterfactual {
  const invalid = input.validSetup === false || input.missingConfluences.length > 0;
  const skipTag = input.behaviorTag != null && SKIP_TAGS.has(input.behaviorTag);
  const shouldNotHaveTaken = invalid || skipTag;

  // Stage C.1 established the true no-op for OUTCOME-dependent math (never
  // fabricate avoidable/unearned R, or a deviation-derived processPerfectR,
  // against an unknown result). Today V2 Phase 2 §14 corrects the
  // over-conservative side effect that shipped with it: a pending trade can
  // still carry KNOWN process facts — an invalid setup, a skip-tagged
  // behavior (FOMO/revenge/…), a "wouldn't take again" answer, a manual
  // override, a session violation, a missing execution confirmation, an
  // over-risk/overtrading breach — and NONE of those depend on the final R
  // at all. Surface them as FLAGGED-only (rImpact always null — the SIZE of
  // the miss genuinely can't be known until settlement) while every
  // R-derived field stays at its additive-identity zero, so a pending
  // trade's process assessment is available even while its performance
  // assessment stays pending. Objective price deviations (input.deviations)
  // stay excluded here — they're priced in R terms against the final exit,
  // which is exactly the outcome-dependent math this branch must not touch.
  if (input.actualR == null) {
    const leakages: LeakageEvent[] = [];
    if (shouldNotHaveTaken) {
      const category: LeakageCategory = skipTag ? "BEHAVIORAL" : "STRATEGY_ADHERENCE";
      const cause = skipTag
        ? input.behaviorTag!.toLowerCase()
        : input.missingConfluences.length > 0
          ? "missing-confluence"
          : "invalid-setup";
      const label = skipTag
        ? BEHAVIOR_LABEL[input.behaviorTag!]
        : input.missingConfluences.length > 0
          ? "Missing mandatory confluence"
          : "Invalid setup taken";
      leakages.push({ category, cause, label, rImpact: null, severity: "MEDIUM", confidence: "FLAGGED", attributionKnown: false });
    } else {
      const flag = (category: LeakageCategory, cause: string, label: string, severity: Severity) =>
        leakages.push({ category, cause, label, rImpact: null, severity, confidence: "FLAGGED", attributionKnown: false });
      if (input.wouldTakeAgain === false) flag("BEHAVIORAL", "would-not-repeat", "Would not take again", "MEDIUM");
      if (input.behaviorTag === "MANUAL_OVERRIDE") flag("BEHAVIORAL", "manual-override", BEHAVIOR_LABEL.MANUAL_OVERRIDE, "MEDIUM");
      if (input.sessionViolation) flag("STRATEGY_ADHERENCE", "session-violation", "Traded outside strategy session", "MEDIUM");
      if ((input.missingExecutionConfirmations ?? 0) > 0)
        flag("STRATEGY_ADHERENCE", "execution-confirmation", "Missing execution confirmation", "LOW");
      if (input.exceededDailyRisk) flag("RISK", "daily-risk-limit", "Daily risk limit exceeded", "HIGH");
      if (input.overtrade) flag("BEHAVIORAL", "overtrading", "Overtrading (beyond daily cap)", "MEDIUM");
    }
    return {
      eventId: input.eventId,
      kind: "EXECUTED",
      sequence: input.sequence,
      dateKey: input.dateKey,
      actualR: 0,
      processPerfectR: 0,
      avoidableR: 0,
      unearnedR: 0,
      processBreach: leakages.length > 0,
      validSetup: !invalid,
      leakages,
    };
  }
  const actualR = input.actualR;
  const leakages: LeakageEvent[] = [];

  let processPerfectR: number;
  let processBreach = false;

  if (shouldNotHaveTaken) {
    // A disciplined process skips this trade entirely → its counterfactual R is 0.
    processBreach = true;
    processPerfectR = 0;
    const category: LeakageCategory = skipTag ? "BEHAVIORAL" : "STRATEGY_ADHERENCE";
    const cause = skipTag
      ? input.behaviorTag!.toLowerCase()
      : input.missingConfluences.length > 0
        ? "missing-confluence"
        : "invalid-setup";
    const baseLabel = skipTag
      ? BEHAVIOR_LABEL[input.behaviorTag!]
      : input.missingConfluences.length > 0
        ? "Missing mandatory confluence"
        : "Invalid setup taken";

    if (actualR < 0) {
      // The loss was avoidable — a disciplined pass recovers it.
      const rImpact = round2(-actualR);
      leakages.push({
        category,
        cause,
        label: baseLabel,
        rImpact,
        severity: severityFromR(rImpact),
        confidence: "MEASURED",
        attributionKnown: true,
      });
    } else {
      // Lucky breach: won on a trade the process would not take. Flag it, do NOT
      // reward it (processPerfectR stays 0 → the win becomes `unearnedR`).
      leakages.push({
        category,
        cause: `${cause}-won`,
        label: `${baseLabel} — won on a breach`,
        rImpact: null,
        severity: "HIGH",
        confidence: "FLAGGED",
        attributionKnown: false,
      });
    }
  } else {
    // Valid setup taken: start from what actually happened and add back the
    // objective edge that measurable deviations cost (clean execution recovers it).
    processPerfectR = actualR;
    for (const d of input.deviations) {
      const category: LeakageCategory = d.cause === "increased-risk" ? "RISK" : "EXECUTION";
      leakages.push({
        category,
        cause: d.cause,
        label: d.label,
        rImpact: d.costR,
        severity: severityFromR(d.costR),
        confidence: "MEASURED",
        attributionKnown: true,
      });
      processPerfectR = round2(processPerfectR + d.costR);
    }
    if (input.deviations.length > 0) processBreach = true;

    // Flagged-only breaches on an otherwise-valid trade — real, but R not knowable.
    const flag = (category: LeakageCategory, cause: string, label: string, severity: Severity) => {
      processBreach = true;
      leakages.push({ category, cause, label, rImpact: null, severity, confidence: "FLAGGED", attributionKnown: false });
    };
    if (input.wouldTakeAgain === false) flag("BEHAVIORAL", "would-not-repeat", "Would not take again", "MEDIUM");
    if (input.behaviorTag === "MANUAL_OVERRIDE") flag("BEHAVIORAL", "manual-override", BEHAVIOR_LABEL.MANUAL_OVERRIDE, "MEDIUM");
    if (input.sessionViolation) flag("STRATEGY_ADHERENCE", "session-violation", "Traded outside strategy session", "MEDIUM");
    if ((input.missingExecutionConfirmations ?? 0) > 0)
      flag("STRATEGY_ADHERENCE", "execution-confirmation", "Missing execution confirmation", "LOW");
    if (input.exceededDailyRisk) flag("RISK", "daily-risk-limit", "Daily risk limit exceeded", "HIGH");
    if (input.overtrade) flag("BEHAVIORAL", "overtrading", "Overtrading (beyond daily cap)", "MEDIUM");
  }

  const avoidableR = round2(Math.max(0, processPerfectR - actualR));
  const unearnedR = round2(Math.max(0, actualR - processPerfectR));
  return {
    eventId: input.eventId,
    kind: "EXECUTED",
    sequence: input.sequence,
    dateKey: input.dateKey,
    actualR: round2(actualR),
    processPerfectR: round2(processPerfectR),
    avoidableR,
    unearnedR,
    processBreach,
    validSetup: !invalid,
    leakages,
  };
}

function reconstructMissed(input: MissedEventInput): EventCounterfactual {
  const valid = input.validSetup !== false;
  const leakages: LeakageEvent[] = [];
  let processPerfectR = 0;
  let processBreach = false;

  // Only a MISSED valid WINNER is opportunity leakage. A missed loser was correctly
  // avoided (cost 0); an undetermined miss is behavior-only (no R fabricated).
  if (valid && input.missedRealizedR != null && input.missedRealizedR > 0) {
    processPerfectR = round2(input.missedRealizedR);
    processBreach = true;
    leakages.push({
      category: "OPPORTUNITY",
      cause: "missed-winner",
      label: "Missed valid winner",
      rImpact: processPerfectR,
      severity: severityFromR(processPerfectR),
      confidence: "MEASURED",
      attributionKnown: true,
    });
  }

  return {
    eventId: input.eventId,
    kind: "MISSED",
    sequence: input.sequence,
    dateKey: input.dateKey,
    actualR: 0,
    processPerfectR,
    avoidableR: processPerfectR, // == max(0, processPerfectR − 0)
    unearnedR: 0,
    processBreach,
    validSetup: valid,
    leakages,
  };
}

export function reconstructEvent(input: CounterfactualInput): EventCounterfactual {
  return input.kind === "EXECUTED" ? reconstructExecuted(input) : reconstructMissed(input);
}

// ── Cumulative curve ─────────────────────────────────────────────────────────

export interface CounterfactualPoint {
  sequence: number;
  dateKey: string;
  eventId: string;
  kind: "EXECUTED" | "MISSED";
  actualEquity: number; // cumulative Σ actualR
  processPerfectEquity: number; // cumulative Σ processPerfectR
  /** Cumulative Σ avoidableR — monotonic ≥ 0. The authoritative "total avoidable gap". */
  avoidableGap: number;
  stepAvoidableR: number; // this event's avoidableR (for click-through)
  stepUnearnedR: number;
  leakages: LeakageEvent[]; // this event's causes (for the clickable popover)
}

export function buildCounterfactualCurve(inputs: CounterfactualInput[]): CounterfactualPoint[] {
  const ordered = [...inputs].sort((a, b) => a.sequence - b.sequence);
  let actualEquity = 0;
  let processPerfectEquity = 0;
  let avoidableGap = 0;

  return ordered.map((input) => {
    const e = reconstructEvent(input);
    actualEquity = round2(actualEquity + e.actualR);
    processPerfectEquity = round2(processPerfectEquity + e.processPerfectR);
    avoidableGap = round2(avoidableGap + e.avoidableR);
    return {
      sequence: e.sequence,
      dateKey: e.dateKey,
      eventId: e.eventId,
      kind: e.kind,
      actualEquity,
      processPerfectEquity,
      avoidableGap,
      stepAvoidableR: e.avoidableR,
      stepUnearnedR: e.unearnedR,
      leakages: e.leakages,
    };
  });
}

// ── Attribution summary ──────────────────────────────────────────────────────

export interface CategoryAttribution {
  category: LeakageCategory;
  /** Σ measurable rImpact in this category. */
  measuredR: number;
  /** Count of flagged (unknown-R) breaches in this category. */
  flaggedCount: number;
  /** measuredR / totalAvoidableGapR × 100 (of the measurable gap). */
  sharePercent: number | null;
}

export interface AttributionSummary {
  events: number;
  /** Σ realized R actually banked. */
  realizedR: number;
  /** Σ disciplined counterfactual R. */
  processPerfectR: number;
  /** Σ avoidableR — the headline Total Avoidable Gap (measurable, ≥ 0). */
  totalAvoidableGapR: number;
  /** realizedR + totalAvoidableGapR — the disciplined potential. */
  potentialR: number;
  /** Σ unearnedR — R won by breaching process (surfaced, never in the gap). */
  unearnedR: number;
  /** realizedR / potentialR × 100 — share of achievable disciplined edge captured. */
  processEfficiencyPercent: number | null;
  /** Descriptive only (never shaded): realized minus normal-variance benchmark handled elsewhere. */
  byCategory: CategoryAttribution[];
  /** Share of events with no flagged (unknown-R) breach — how trustworthy the attribution is. */
  dataConfidencePercent: number | null;
  processBreaches: number;
}

const CATEGORIES: LeakageCategory[] = ["EXECUTION", "BEHAVIORAL", "RISK", "STRATEGY_ADHERENCE", "OPPORTUNITY"];

export function summarizeAttribution(inputs: CounterfactualInput[]): AttributionSummary {
  const measured = new Map<LeakageCategory, number>();
  const flagged = new Map<LeakageCategory, number>();
  let realizedR = 0;
  let processPerfectR = 0;
  let totalAvoidableGapR = 0;
  let unearnedR = 0;
  let processBreaches = 0;
  let confidentEvents = 0;
  let events = 0;

  for (const input of inputs) {
    const e = reconstructEvent(input);
    events += 1;
    realizedR = round2(realizedR + e.actualR);
    processPerfectR = round2(processPerfectR + e.processPerfectR);
    totalAvoidableGapR = round2(totalAvoidableGapR + e.avoidableR);
    unearnedR = round2(unearnedR + e.unearnedR);
    if (e.processBreach) processBreaches += 1;

    let hasFlagged = false;
    for (const l of e.leakages) {
      if (l.rImpact != null) {
        measured.set(l.category, round2((measured.get(l.category) ?? 0) + l.rImpact));
      } else {
        hasFlagged = true;
        flagged.set(l.category, (flagged.get(l.category) ?? 0) + 1);
      }
    }
    if (!hasFlagged) confidentEvents += 1;
  }

  const byCategory: CategoryAttribution[] = CATEGORIES.map((category) => {
    const measuredR = round2(measured.get(category) ?? 0);
    return {
      category,
      measuredR,
      flaggedCount: flagged.get(category) ?? 0,
      sharePercent: totalAvoidableGapR > 0 ? round1((measuredR / totalAvoidableGapR) * 100) : null,
    };
  }).filter((c) => c.measuredR > 0 || c.flaggedCount > 0);

  const potentialR = round2(realizedR + totalAvoidableGapR);

  return {
    events,
    realizedR,
    processPerfectR,
    totalAvoidableGapR,
    potentialR,
    unearnedR,
    processEfficiencyPercent: potentialR !== 0 ? round1((realizedR / potentialR) * 100) : null,
    byCategory,
    dataConfidencePercent: events > 0 ? round1((confidentEvents / events) * 100) : null,
    processBreaches,
  };
}
