/**
 * Matches Actual trades to Replay decisions (Stage 15, upgraded Stage
 * 15.1 §12-15, classified Stage 15.2 §3) and classifies each pair/entry
 * into the distinct difference categories from Stage 15 §2 plus Stage 15.2's
 * per-pair Validation/Behaviour layers.
 *
 * TWO MATCHING PATHS (Stage 15.1 §10-11):
 *  - ENRICHED (`baseline.schemaVersion === 2`): candidates are scored from
 *    real evidence — direction/strategy/setup agreement, historical-time
 *    proximity, entry-price proximity normalized by risk — then assigned
 *    one-to-one, highest score first, within deterministic thresholds.
 *    Confidence is HIGH or MEDIUM (never claimed higher than the evidence
 *    supports); a net-negative score is left UNMATCHED rather than forced.
 *  - LEGACY (older baselines with no `actualTradeSnapshots`): falls back to
 *    the original (dateKey, assetSymbol) + array-order pairing, always
 *    tagged `confidence: "MEDIUM"`, `reason: "LEGACY_BASELINE_FALLBACK"`.
 *
 * Both paths honor `manualLinks` (persisted as `ReplayComparisonLink`)
 * FIRST: a `MATCHED` link forces that exact pairing at HIGH confidence
 * regardless of score (`source: "MANUAL"`); an `EXCLUDED` link removes that
 * specific candidate pair from consideration AND marks both sides
 * `EXCLUDED_DIFFERENT_OPPORTUNITY` if they end up unmatched, rather than a
 * plain "unmatched" — a trader who reviewed and ruled out a pairing gets a
 * different (more confident) badge than one nobody has looked at yet.
 *
 * DECISION CLASSIFICATION (Stage 15.2 §3) — factual relationship
 * categories, never a blame judgment: SAME_DECISION /
 * ACTUAL_TAKEN_REPLAY_SKIPPED for matched pairs; UNMATCHED_ACTUAL /
 * ACTUAL_ABSENT_REPLAY_TAKEN / UNMATCHED_REPLAY / EXCLUDED_DIFFERENT_
 * OPPORTUNITY for unmatched entries. `opportunityConfirmations` carries
 * the trader's confirm/reject decision on each "Potential Missed
 * Opportunity" (a `ACTUAL_ABSENT_REPLAY_TAKEN` entry) — unconfirmed by
 * default, never auto-counted as missed (§5-6).
 */
import { utcDateToKey } from "@/lib/date";
import { buildValidationDifference } from "@/domain/replay-comparison/validation-difference";
import { buildExecutionDifference } from "@/domain/replay-comparison/execution-difference";
import { buildBehaviourPairDifference } from "@/domain/replay-comparison/behaviour-pair-difference";
import type {
  ManualComparisonLink,
  MatchConfidence,
  MatchReason,
  MatchedDecisionPair,
  OpportunityConfirmation,
  OutcomeDifference,
  UnmatchedActualEntry,
  UnmatchedReplayEntry,
} from "@/domain/replay-comparison/types";
import type { ActualTradeComparisonSnapshot, ActualTradeRefDTO, ReplayActualBaseline, ReplayTradeDTO } from "@/types/replay";

function groupKey(dateKey: string, assetSymbol: string): string {
  return `${dateKey}::${assetSymbol}`;
}

function replayDateKey(replay: ReplayTradeDTO): string {
  return utcDateToKey(new Date(replay.historicalTimestamp));
}

function buildOutcomeDifference(actual: ActualTradeRefDTO, replay: ReplayTradeDTO): OutcomeDifference {
  const actualR = actual.realizedR;
  const replayR = replay.decisionType === "TAKEN" ? replay.realizedReplayR : null;
  return { actualR, replayR, deltaR: actualR != null && replayR != null ? replayR - actualR : null };
}

function buildPair(
  actual: ActualTradeRefDTO,
  replay: ReplayTradeDTO,
  confidence: MatchConfidence,
  reason: MatchReason,
  actualSnapshot: ActualTradeComparisonSnapshot | null,
): MatchedDecisionPair {
  return {
    dateKey: actual.dateKey,
    assetSymbol: actual.assetSymbol,
    actual,
    replay,
    outcome: buildOutcomeDifference(actual, replay),
    decision: {
      actualDirection: actual.direction,
      replayDirection: replay.direction,
      sameDirection: replay.direction != null && replay.direction === actual.direction,
      actualStrategyName: actual.strategyName,
      replayStrategyName: replay.strategyNameSnapshot,
      sameStrategy:
        (actual.strategyName == null && replay.strategyNameSnapshot == null) ||
        (actual.strategyName != null && actual.strategyName === replay.strategyNameSnapshot),
      actualSetupTypeName: actual.setupTypeName,
      replaySetupTypeName: replay.setupTypeNameSnapshot,
      sameSetupType:
        (actual.setupTypeName == null && replay.setupTypeNameSnapshot == null) ||
        (actual.setupTypeName != null && actual.setupTypeName === replay.setupTypeNameSnapshot),
      actualValidationState: actual.validationState,
      replayValidationState: replay.validationState,
      sameValidationState: actual.validationState === replay.validationState,
      actualDailyBiasSnapshot: actualSnapshot?.dailyBiasSnapshot ?? null,
      replayDecisionType: replay.decisionType,
    },
    validation: buildValidationDifference(actualSnapshot, replay),
    execution: buildExecutionDifference(actualSnapshot, actual, replay),
    behaviour: buildBehaviourPairDifference(actualSnapshot, replay),
    classification: replay.decisionType === "SKIPPED" ? "ACTUAL_TAKEN_REPLAY_SKIPPED" : "SAME_DECISION",
    confidence,
    reason,
    source: reason === "MANUAL_LINK" ? "MANUAL" : "AUTO",
    actualSnapshot,
  };
}

export interface DecisionMatchResult {
  matched: MatchedDecisionPair[];
  unmatchedActual: UnmatchedActualEntry[];
  unmatchedReplayTaken: UnmatchedReplayEntry[];
  unmatchedReplaySkipped: UnmatchedReplayEntry[];
}

function unmatchedReplayEntry(
  replay: ReplayTradeDTO,
  excludedReplayIds: Set<string>,
  confirmations: Map<string, "CONFIRMED_MISSED" | "NOT_MISSED">,
  confirmedAtById: Map<string, string | null>,
): UnmatchedReplayEntry {
  const excluded = excludedReplayIds.has(replay.id);
  if (replay.decisionType === "TAKEN") {
    const confirmation = confirmations.get(replay.id) ?? null;
    return {
      dateKey: replayDateKey(replay),
      assetSymbol: replay.assetSymbol,
      replay,
      classification: excluded ? "EXCLUDED_DIFFERENT_OPPORTUNITY" : "ACTUAL_ABSENT_REPLAY_TAKEN",
      missedOpportunityStatus: excluded ? null : (confirmation ?? "UNCONFIRMED"),
      confirmedAt: confirmedAtById.get(replay.id) ?? null,
    };
  }
  return {
    dateKey: replayDateKey(replay),
    assetSymbol: replay.assetSymbol,
    replay,
    classification: excluded ? "EXCLUDED_DIFFERENT_OPPORTUNITY" : "UNMATCHED_REPLAY",
    missedOpportunityStatus: null,
    confirmedAt: null,
  };
}

function unmatchedActualEntry(
  actual: ActualTradeRefDTO,
  actualSnapshot: ActualTradeComparisonSnapshot | null,
  excludedActualIds: Set<string>,
): UnmatchedActualEntry {
  return {
    dateKey: actual.dateKey,
    assetSymbol: actual.assetSymbol,
    actual,
    actualSnapshot,
    classification: excludedActualIds.has(actual.tradeId) ? "EXCLUDED_DIFFERENT_OPPORTUNITY" : "UNMATCHED_ACTUAL",
  };
}

// ── Legacy path (Stage 15, pre-15.1 baselines) ──────────────────────────────

function legacyMatch(
  actualTrades: ActualTradeRefDTO[],
  replayTrades: ReplayTradeDTO[],
  excludedActualIds: Set<string>,
  excludedReplayIds: Set<string>,
  confirmations: Map<string, "CONFIRMED_MISSED" | "NOT_MISSED">,
  confirmedAtById: Map<string, string | null>,
): DecisionMatchResult {
  const actualByGroup = new Map<string, ActualTradeRefDTO[]>();
  for (const a of actualTrades) {
    const key = groupKey(a.dateKey, a.assetSymbol);
    (actualByGroup.get(key) ?? actualByGroup.set(key, []).get(key)!).push(a);
  }
  const replayByGroup = new Map<string, ReplayTradeDTO[]>();
  for (const r of replayTrades) {
    const key = groupKey(replayDateKey(r), r.assetSymbol);
    (replayByGroup.get(key) ?? replayByGroup.set(key, []).get(key)!).push(r);
  }

  const matched: MatchedDecisionPair[] = [];
  const unmatchedActual: UnmatchedActualEntry[] = [];
  const unmatchedReplayTaken: UnmatchedReplayEntry[] = [];
  const unmatchedReplaySkipped: UnmatchedReplayEntry[] = [];

  const allGroupKeys = new Set([...actualByGroup.keys(), ...replayByGroup.keys()]);
  for (const key of allGroupKeys) {
    const actuals = actualByGroup.get(key) ?? [];
    const replays = replayByGroup.get(key) ?? [];
    const pairCount = Math.min(actuals.length, replays.length);

    for (let i = 0; i < pairCount; i++) {
      matched.push(buildPair(actuals[i], replays[i], "MEDIUM", "LEGACY_BASELINE_FALLBACK", null));
    }
    for (let i = pairCount; i < actuals.length; i++) {
      unmatchedActual.push(unmatchedActualEntry(actuals[i], null, excludedActualIds));
    }
    for (let i = pairCount; i < replays.length; i++) {
      const entry = unmatchedReplayEntry(replays[i], excludedReplayIds, confirmations, confirmedAtById);
      if (entry.classification === "UNMATCHED_REPLAY") unmatchedReplaySkipped.push(entry);
      else unmatchedReplayTaken.push(entry);
    }
  }
  return { matched, unmatchedActual, unmatchedReplayTaken, unmatchedReplaySkipped };
}

// ── Enriched path (Stage 15.1) — evidence-based scoring ─────────────────────

const HIGH_CONFIDENCE_THRESHOLD = 60;
const MIN_MATCH_SCORE = 0;
const TIE_EPSILON = 10;

function minutesBetween(isoA: string, isoB: string): number {
  return Math.abs(new Date(isoA).getTime() - new Date(isoB).getTime()) / 60_000;
}

function timeProximityScore(actualTime: string, replayTime: string): number {
  const diff = minutesBetween(actualTime, replayTime);
  if (diff <= 15) return 15;
  if (diff <= 60) return 10;
  if (diff <= 180) return 5;
  return 0;
}

/** Entry-price proximity, normalized by each side's own risk unit — so a
 *  $2 difference is meaningful on a tight-stop scalp but noise on a
 *  wide-stop swing trade. Contributes 0 (never a penalty) when either side
 *  lacks the prices/risk needed to compute it. */
function priceProximityScore(actual: ActualTradeComparisonSnapshot, replay: ReplayTradeDTO): number {
  const actualEntry = actual.actualEntry ?? actual.plannedEntry;
  const actualStop = actual.resolvedInitialStop ?? actual.actualStopLoss ?? actual.plannedStopLoss;
  const replayEntry = replay.simulatedEntry ?? replay.plannedEntry;
  const replayStop = replay.plannedStopLoss;

  if (actualEntry == null || actualStop == null || replayEntry == null || replayStop == null) return 0;
  const actualRisk = Math.abs(actualEntry - actualStop);
  const replayRisk = Math.abs(replayEntry - replayStop);
  if (actualRisk === 0 || replayRisk === 0) return 0;

  const normalizedDiff = Math.abs(actualEntry - replayEntry) / ((actualRisk + replayRisk) / 2);
  if (normalizedDiff <= 0.25) return 10;
  if (normalizedDiff <= 0.75) return 5;
  return 0;
}

function scoreCandidate(actual: ActualTradeComparisonSnapshot, replay: ReplayTradeDTO): number {
  let score = 0;
  if (replay.direction != null) {
    // A direction conflict is a strong negative signal, penalized harder
    // than the combined max of every positive-only-coincidence signal
    // (time+price = 25) so a same-time/same-price coincidence alone can
    // never outweigh trading in the opposite direction into an accidental
    // match.
    score += replay.direction === actual.direction ? 40 : -50;
  }
  if (actual.strategyName != null && replay.strategyNameSnapshot != null) {
    score += actual.strategyName === replay.strategyNameSnapshot ? 20 : -10;
  }
  if (actual.setupTypeName != null && replay.setupTypeNameSnapshot != null) {
    score += actual.setupTypeName === replay.setupTypeNameSnapshot ? 15 : -10;
  }
  score += timeProximityScore(actual.executionStartedAt, replay.historicalTimestamp);
  score += priceProximityScore(actual, replay);
  return score;
}

interface Candidate {
  actual: ActualTradeComparisonSnapshot;
  replay: ReplayTradeDTO;
  score: number;
}

interface GroupAssignment {
  matched: { actual: ActualTradeComparisonSnapshot; replay: ReplayTradeDTO; confidence: MatchConfidence }[];
  leftoverActual: ActualTradeComparisonSnapshot[];
  leftoverReplay: ReplayTradeDTO[];
}

/**
 * Deterministic one-to-one assignment within one (dateKey, assetSymbol)
 * group: score every candidate pair, assign highest score first, never
 * reusing either side. A candidate scoring below `MIN_MATCH_SCORE` is never
 * assigned (false matches are worse than unmatched), and a pair the trader
 * explicitly `EXCLUDED` is scored at -Infinity so it can never be assigned.
 * When the winning score for either side isn't clearly ahead of the
 * next-best remaining option (within `TIE_EPSILON`), the match is still
 * made but capped at MEDIUM confidence rather than guessed at HIGH.
 */
function assignGroup(actuals: ActualTradeComparisonSnapshot[], replays: ReplayTradeDTO[], excludedPairs: Set<string>): GroupAssignment {
  const candidates: Candidate[] = [];
  for (const actual of actuals) {
    for (const replay of replays) {
      const excluded = excludedPairs.has(`${actual.tradeId}::${replay.id}`);
      candidates.push({ actual, replay, score: excluded ? -Infinity : scoreCandidate(actual, replay) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedActual = new Set<string>();
  const usedReplay = new Set<string>();
  const matched: GroupAssignment["matched"] = [];

  for (const cand of candidates) {
    if (usedActual.has(cand.actual.tradeId) || usedReplay.has(cand.replay.id)) continue;
    if (cand.score < MIN_MATCH_SCORE) continue;

    const ambiguous = candidates.some(
      (other) =>
        other !== cand &&
        !usedActual.has(other.actual.tradeId) &&
        !usedReplay.has(other.replay.id) &&
        (other.actual.tradeId === cand.actual.tradeId || other.replay.id === cand.replay.id) &&
        Math.abs(other.score - cand.score) <= TIE_EPSILON,
    );

    usedActual.add(cand.actual.tradeId);
    usedReplay.add(cand.replay.id);
    matched.push({
      actual: cand.actual,
      replay: cand.replay,
      confidence: !ambiguous && cand.score >= HIGH_CONFIDENCE_THRESHOLD ? "HIGH" : "MEDIUM",
    });
  }

  return {
    matched,
    leftoverActual: actuals.filter((a) => !usedActual.has(a.tradeId)),
    leftoverReplay: replays.filter((r) => !usedReplay.has(r.id)),
  };
}

function enrichedMatch(
  actualTrades: ActualTradeRefDTO[],
  actualTradeSnapshots: ActualTradeComparisonSnapshot[],
  replayTrades: ReplayTradeDTO[],
  manualLinks: ManualComparisonLink[],
  excludedActualIds: Set<string>,
  excludedReplayIds: Set<string>,
  confirmations: Map<string, "CONFIRMED_MISSED" | "NOT_MISSED">,
  confirmedAtById: Map<string, string | null>,
): DecisionMatchResult {
  const actualRefById = new Map(actualTrades.map((a) => [a.tradeId, a]));
  const snapshotById = new Map(actualTradeSnapshots.map((s) => [s.tradeId, s]));
  const replayById = new Map(replayTrades.map((r) => [r.id, r]));

  const matched: MatchedDecisionPair[] = [];
  const manuallyUsedActual = new Set<string>();
  const manuallyUsedReplay = new Set<string>();
  const excludedPairs = new Set<string>();

  for (const link of manualLinks) {
    const pairKey = `${link.actualTradeId}::${link.replayTradeId}`;
    if (link.linkType === "EXCLUDED") {
      excludedPairs.add(pairKey);
      continue;
    }
    const actualRef = actualRefById.get(link.actualTradeId);
    const replay = replayById.get(link.replayTradeId);
    if (!actualRef || !replay) continue; // stale link — referenced trade no longer in this baseline/session
    matched.push(buildPair(actualRef, replay, "HIGH", "MANUAL_LINK", snapshotById.get(link.actualTradeId) ?? null));
    manuallyUsedActual.add(link.actualTradeId);
    manuallyUsedReplay.add(link.replayTradeId);
  }

  const remainingSnapshots = actualTradeSnapshots.filter((s) => !manuallyUsedActual.has(s.tradeId));
  const remainingReplays = replayTrades.filter((r) => !manuallyUsedReplay.has(r.id));

  const snapshotsByGroup = new Map<string, ActualTradeComparisonSnapshot[]>();
  for (const s of remainingSnapshots) {
    const key = groupKey(s.dateKey, s.assetSymbol);
    (snapshotsByGroup.get(key) ?? snapshotsByGroup.set(key, []).get(key)!).push(s);
  }
  const replaysByGroup = new Map<string, ReplayTradeDTO[]>();
  for (const r of remainingReplays) {
    const key = groupKey(replayDateKey(r), r.assetSymbol);
    (replaysByGroup.get(key) ?? replaysByGroup.set(key, []).get(key)!).push(r);
  }

  const unmatchedActual: UnmatchedActualEntry[] = [];
  const unmatchedReplayTaken: UnmatchedReplayEntry[] = [];
  const unmatchedReplaySkipped: UnmatchedReplayEntry[] = [];

  const allGroupKeys = new Set([...snapshotsByGroup.keys(), ...replaysByGroup.keys()]);
  for (const key of allGroupKeys) {
    const snapshots = snapshotsByGroup.get(key) ?? [];
    const replays = replaysByGroup.get(key) ?? [];
    const assignment = assignGroup(snapshots, replays, excludedPairs);

    for (const m of assignment.matched) {
      const actualRef = actualRefById.get(m.actual.tradeId)!;
      matched.push(
        buildPair(
          actualRef,
          m.replay,
          m.confidence,
          m.confidence === "HIGH" ? "EXACT_CONTEXT_MATCH" : "TIME_PROXIMITY_MATCH",
          m.actual,
        ),
      );
    }
    for (const leftover of assignment.leftoverActual) {
      unmatchedActual.push(unmatchedActualEntry(actualRefById.get(leftover.tradeId)!, leftover, excludedActualIds));
    }
    for (const leftover of assignment.leftoverReplay) {
      const entry = unmatchedReplayEntry(leftover, excludedReplayIds, confirmations, confirmedAtById);
      if (entry.classification === "UNMATCHED_REPLAY") unmatchedReplaySkipped.push(entry);
      else unmatchedReplayTaken.push(entry);
    }
  }

  return { matched, unmatchedActual, unmatchedReplayTaken, unmatchedReplaySkipped };
}

export function matchActualToReplayDecisions(
  baseline: Pick<ReplayActualBaseline, "actualTrades" | "actualTradeSnapshots" | "schemaVersion">,
  replayTrades: ReplayTradeDTO[],
  manualLinks: ManualComparisonLink[] = [],
  opportunityConfirmations: OpportunityConfirmation[] = [],
  opportunityConfirmedAt: Map<string, string | null> = new Map(),
): DecisionMatchResult {
  const excludedActualIds = new Set(manualLinks.filter((l) => l.linkType === "EXCLUDED").map((l) => l.actualTradeId));
  const excludedReplayIds = new Set(manualLinks.filter((l) => l.linkType === "EXCLUDED").map((l) => l.replayTradeId));
  const confirmations = new Map(opportunityConfirmations.map((c) => [c.replayTradeId, c.classification] as const));

  if (baseline.schemaVersion === 2 && baseline.actualTradeSnapshots) {
    return enrichedMatch(
      baseline.actualTrades,
      baseline.actualTradeSnapshots,
      replayTrades,
      manualLinks,
      excludedActualIds,
      excludedReplayIds,
      confirmations,
      opportunityConfirmedAt,
    );
  }
  return legacyMatch(baseline.actualTrades, replayTrades, excludedActualIds, excludedReplayIds, confirmations, opportunityConfirmedAt);
}
