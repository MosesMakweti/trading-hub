import { prisma } from "@/server/db";
import { addDaysToKey, dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { computeReviewPeriod } from "@/domain/replay/review-period";
import { tiptapToPlainText } from "@/lib/tiptap-text";
import { getWeeklyReview } from "@/server/services/edge.service";
import { getReplayComparison } from "@/server/services/replay-comparison.service";
import { buildImprovementAnalytics, getCommitmentLineage, listCommitmentsForSession } from "@/server/services/edge-review-commitment.service";
import { ruleKeyLabel } from "@/domain/improvements/commitment-adherence";
import type {
  BehaviorOccurrenceTrendEntry,
  BehaviouralEvidenceEntry,
  CommitmentBehaviorCrossCheckEntry,
  CommitmentEvidenceEntry,
  DiscrepancyEvidenceEntry,
  EvidenceCoverageSummary,
  EvidenceItem,
  PerformanceSummary,
  ReflectionEntry,
  SetupPerformanceEntry,
  TradeReflectionEntry,
  TraderReviewEvidencePackage,
  TruncationNote,
} from "@/domain/ai-review/types";

const PACKAGE_VERSION = "1.1.0";

// Deterministic caps (§13) — every truncation is recorded in `truncation`
// (§14), never silently applied.
const MAX_OVERRIDE_EVIDENCE = 15;
const MAX_BEHAVIOURAL_ENTRIES = 15;
const MAX_DISCREPANCY_ENTRIES_PER_CATEGORY = 10;
const MAX_PSYCHOLOGY_ENTRIES = 15;
const MAX_DAILY_REFLECTIONS = 10;
const MAX_TRADE_REFLECTIONS = 10;
/** Stage 20.1 §6 — "top recurring negative rules," never every rule ever
 *  tracked. Selection rule: highest total breach count across the rule's
 *  available points, ruleKey ascending as a deterministic tie-break. */
const MAX_BEHAVIOR_TREND_RULES = 6;
/** Stage 20.1 §6 — most recent periods only, per included rule. */
const MAX_BEHAVIOR_TREND_POINTS = 8;

type EvidenceIndexBuilder = Record<string, EvidenceItem>;

function addEvidence(index: EvidenceIndexBuilder, item: EvidenceItem): string {
  index[item.id] = item;
  return item.id;
}

/** Most recent first, then bounded — the one selection rule used
 *  throughout this builder for every truncated list (§13: "prefer
 *  relevance to repeated behavior/process," and recency is the simplest
 *  defensible proxy for that without touching PnL). */
function takeRecent<T>(items: T[], max: number, dateKeyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => (dateKeyOf(a) < dateKeyOf(b) ? 1 : dateKeyOf(a) > dateKeyOf(b) ? -1 : 0)).slice(0, max);
}

function performanceSummaryFromTrades(trades: { actualRR: { toNumber(): number } | null }[]): PerformanceSummary {
  let winCount = 0;
  let lossCount = 0;
  let totalR = 0;
  let rCount = 0;
  for (const t of trades) {
    if (t.actualRR == null) continue;
    const r = t.actualRR.toNumber();
    rCount += 1;
    totalR += r;
    if (r > 0) winCount += 1;
    else if (r < 0) lossCount += 1;
  }
  return {
    totalTrades: trades.length,
    winCount,
    lossCount,
    totalR: rCount > 0 ? Math.round(totalR * 100) / 100 : null,
    averageR: rCount > 0 ? Math.round((totalR / rCount) * 100) / 100 : null,
  };
}

/**
 * Composes the provider-independent evidence package for one FINALIZED
 * Edge Review period (§10, §37) from EXISTING read models/domain
 * functions — never a duplicate analytics calculation (§12). Deliberately
 * NOT the full Analytics engine output: a purpose-built, bounded summary
 * computed directly from Trade rows in the period, scoped exactly like the
 * review session itself (same strategyId/assetSymbols the Comparison tab
 * already uses). Throws if the session isn't finalized — defense in depth
 * so this can never be called for a still-mutable period (§37).
 */
export async function buildTraderReviewEvidencePackage(userId: string, sessionId: string): Promise<TraderReviewEvidencePackage> {
  const session = await prisma.replayReviewSession.findFirst({ where: { id: sessionId, userId } });
  if (!session) throw new Error("Review session not found.");
  if (!session.reviewFinalizedAt) throw new Error("Only a finalized review can be analyzed.");

  const startDate = utcDateToKey(session.startDate);
  const endDate = utcDateToKey(session.endDate);
  const evidenceIndex: EvidenceIndexBuilder = {};
  const missingData: string[] = [];
  const truncation: TruncationNote[] = [];

  const tradeWhere = {
    userId,
    tradeDate: { gte: session.startDate, lte: session.endDate },
    ...(session.strategyId ? { strategyId: session.strategyId } : {}),
    ...(session.assetSymbols.length > 0 ? { assetSymbol: { in: session.assetSymbols } } : {}),
  };

  const trades = await prisma.trade.findMany({
    where: tradeWhere,
    select: {
      id: true,
      tradeDate: true,
      assetSymbol: true,
      actualRR: true,
      executionPercent: true,
      validationState: true,
      setupTypeId: true,
      setupValidationSnapshot: true,
      strategyNameSnapshot: true,
      strategyVersionSnapshot: true,
      whatWentWell: true,
      whatWentWrong: true,
      whatCouldImprove: true,
      psychLessonsLearned: true,
      tradeIntent: true,
      wouldTakeAgain: true,
      behaviourLabels: { include: { behaviourLabel: true } },
      psychology: true,
    },
    orderBy: { tradeDate: "asc" },
  });

  const performanceSummary = performanceSummaryFromTrades(trades);
  if (trades.length === 0) missingData.push("NO_TRADES_IN_PERIOD");

  // ── Strategy/setup performance (§5) — historical snapshots only, never
  // a live Strategy Lab join (§9). ──────────────────────────────────────
  const strategyNameSnapshot = trades.find((t) => t.strategyNameSnapshot != null)?.strategyNameSnapshot ?? null;
  const strategyVersionSnapshot = trades.find((t) => t.strategyVersionSnapshot != null)?.strategyVersionSnapshot ?? null;
  const setupCounts = new Map<string, { name: string; trades: number; winCount: number }>();
  for (const t of trades) {
    const snapshot = t.setupValidationSnapshot as { setupType?: { id: string; name: string } } | null;
    const setupName = snapshot?.setupType?.name;
    if (!setupName) continue;
    const key = snapshot!.setupType!.id;
    const existing = setupCounts.get(key) ?? { name: setupName, trades: 0, winCount: 0 };
    existing.trades += 1;
    if (t.actualRR != null && t.actualRR.toNumber() > 0) existing.winCount += 1;
    setupCounts.set(key, existing);
  }
  const setupBreakdown: SetupPerformanceEntry[] = [...setupCounts.entries()].map(([setupTypeId, v]) => ({
    evidenceId: addEvidence(evidenceIndex, {
      id: `SETUP:${setupTypeId}`,
      strength: "OBJECTIVE",
      category: "SETUP_PERFORMANCE",
      statement: `${v.trades} trade(s) on setup "${v.name}", ${v.winCount} winner(s) this period.`,
    }),
    setupTypeName: v.name,
    trades: v.trades,
    winCount: v.winCount,
  }));

  // ── Planning adherence (§5) ────────────────────────────────────────────
  const tradesWithExecutionPercent = trades.filter((t) => t.executionPercent != null);
  const averageExecutionPercent =
    tradesWithExecutionPercent.length > 0
      ? Math.round(tradesWithExecutionPercent.reduce((s, t) => s + (t.executionPercent ?? 0), 0) / tradesWithExecutionPercent.length)
      : null;
  if (averageExecutionPercent == null) missingData.push("NO_EXECUTION_ADHERENCE_DATA");

  // ── Validation / overrides (§5) — real Trade.validationState, no Replay
  // dependency, mirroring Stage 19's own OVERRIDE_DISCIPLINE rule. ───────
  const validated = trades.filter((t) => t.validationState === "VALIDATED");
  const overridden = trades.filter((t) => t.validationState === "OVERRIDDEN");
  const notValidated = trades.filter((t) => t.validationState === "NOT_VALIDATED" || t.validationState == null);
  if (validated.length === 0 && overridden.length === 0) missingData.push("NO_SETUP_VALIDATION_DATA");
  const overrideEvidenceIdsFull = overridden.map((t) =>
    addEvidence(evidenceIndex, {
      id: `TRADE:${t.id}`,
      strength: "OBJECTIVE",
      category: "OVERRIDE_DISCIPLINE",
      statement: `Trade on ${utcDateToKey(t.tradeDate)} (${t.assetSymbol}) was taken via a discretionary override of an invalid setup.`,
      dateKey: utcDateToKey(t.tradeDate),
    }),
  );
  if (overrideEvidenceIdsFull.length > MAX_OVERRIDE_EVIDENCE) {
    truncation.push({ field: "validationOverrides.overrideEvidenceIds", totalAvailable: overrideEvidenceIdsFull.length, included: MAX_OVERRIDE_EVIDENCE, selectionRule: "most recent" });
  }
  const overrideEvidenceIds = overrideEvidenceIdsFull.slice(-MAX_OVERRIDE_EVIDENCE);

  // ── Behavioral evidence (§5) — real TradeBehaviourLabel links, no Replay
  // dependency, so behavioral evidence never disappears just because
  // Replay hasn't run for this period. ──────────────────────────────────
  const allBehaviouralEntries: BehaviouralEvidenceEntry[] = [];
  for (const t of trades) {
    for (const link of t.behaviourLabels) {
      allBehaviouralEntries.push({
        evidenceId: "",
        dateKey: utcDateToKey(t.tradeDate),
        label: link.behaviourLabel.name,
        polarity: link.behaviourLabel.polarity,
      });
    }
  }
  const negativeCount = allBehaviouralEntries.filter((e) => e.polarity === "NEGATIVE").length;
  const positiveCount = allBehaviouralEntries.filter((e) => e.polarity === "POSITIVE").length;
  if (allBehaviouralEntries.length > MAX_BEHAVIOURAL_ENTRIES) {
    truncation.push({ field: "behavioralEvidence.entries", totalAvailable: allBehaviouralEntries.length, included: MAX_BEHAVIOURAL_ENTRIES, selectionRule: "most recent" });
  }
  const boundedBehavioural = takeRecent(allBehaviouralEntries, MAX_BEHAVIOURAL_ENTRIES, (e) => e.dateKey);
  const behavioralEvidenceEntries = boundedBehavioural.map((e, i) => ({
    ...e,
    evidenceId: addEvidence(evidenceIndex, {
      id: `BEHAVIOUR:${e.dateKey}:${i}`,
      strength: "TRADER_REPORTED",
      category: "BEHAVIOUR_LABEL",
      statement: `${e.polarity === "NEGATIVE" ? "Negative" : "Positive"} behaviour label "${e.label}" attached to a trade on ${e.dateKey}.`,
      dateKey: e.dateKey,
    }),
  }));
  if (allBehaviouralEntries.length === 0) missingData.push("NO_BEHAVIOUR_LABELS");

  // ── Psychology (§5, §32) — trader-reported questionnaire score only. ──
  const psychologyEntriesFull = trades
    .filter((t) => t.psychology != null)
    .map((t) => ({ dateKey: utcDateToKey(t.tradeDate), percent: t.psychology!.psychologyPercent, grade: t.psychology!.grade as string }));
  if (psychologyEntriesFull.length === 0) missingData.push("NO_PSYCHOLOGY_DATA");
  if (psychologyEntriesFull.length > MAX_PSYCHOLOGY_ENTRIES) {
    truncation.push({ field: "psychology.entries", totalAvailable: psychologyEntriesFull.length, included: MAX_PSYCHOLOGY_ENTRIES, selectionRule: "most recent" });
  }
  const boundedPsychology = takeRecent(psychologyEntriesFull, MAX_PSYCHOLOGY_ENTRIES, (e) => e.dateKey);
  const psychologyEntries = boundedPsychology.map((e) => ({
    ...e,
    evidenceId: addEvidence(evidenceIndex, {
      id: `PSYCHOLOGY:${e.dateKey}`,
      strength: "TRADER_REPORTED",
      category: "PSYCHOLOGY",
      statement: `Pre-trade psychology questionnaire on ${e.dateKey}: ${e.percent}% (${e.grade}).`,
      dateKey: e.dateKey,
    }),
  }));
  const averagePsychologyPercent =
    psychologyEntriesFull.length > 0 ? Math.round(psychologyEntriesFull.reduce((s, e) => s + e.percent, 0) / psychologyEntriesFull.length) : null;

  // ── Replay comparison + discrepancy (§5, §23, §31) ────────────────────
  const comparison = session.status === "COMPLETED" ? await getReplayComparison(userId, sessionId).catch(() => null) : null;
  if (!comparison) missingData.push("NO_REPLAY_COMPARISON");

  function discrepancyEntries(events: { dateKey: string; assetSymbol: string; category: string; description: string }[], field: string): DiscrepancyEvidenceEntry[] {
    if (events.length > MAX_DISCREPANCY_ENTRIES_PER_CATEGORY) {
      truncation.push({ field, totalAvailable: events.length, included: MAX_DISCREPANCY_ENTRIES_PER_CATEGORY, selectionRule: "most recent" });
    }
    const bounded = takeRecent(events, MAX_DISCREPANCY_ENTRIES_PER_CATEGORY, (e) => e.dateKey);
    return bounded.map((e, i) => ({
      evidenceId: addEvidence(evidenceIndex, {
        id: `DISCREPANCY:${e.category}:${e.dateKey}:${i}`,
        strength: "DERIVED",
        category: e.category,
        statement: e.description,
        dateKey: e.dateKey,
      }),
      category: e.category,
      dateKey: e.dateKey,
      assetSymbol: e.assetSymbol,
      description: e.description,
    }));
  }

  const replayComparison = comparison
    ? {
        evidenceId: addEvidence(evidenceIndex, {
          id: "REPLAY:SUMMARY",
          strength: "DERIVED",
          category: "REPLAY_COMPARISON",
          statement: `Replay comparison: ${comparison.matched.length} matched decision(s), isProvisional=${comparison.isProvisional}.`,
        }),
        isProvisional: comparison.isProvisional,
        matchedDecisionCount: comparison.matched.length,
        sameDecisionCount: comparison.matched.filter((m) => m.classification === "SAME_DECISION").length,
        differentDecisionCount: comparison.matched.filter((m) => m.classification !== "SAME_DECISION").length,
        discrepancy: {
          strategyVarianceCount: comparison.discrepancy.strategyVariance.count,
          executionDiscrepancyEntries: discrepancyEntries(comparison.discrepancy.executionDiscrepancy.events, "replayComparison.discrepancy.executionDiscrepancyEntries"),
          behavioralDiscrepancyEntries: discrepancyEntries(comparison.discrepancy.behavioralDiscrepancy.events, "replayComparison.discrepancy.behavioralDiscrepancyEntries"),
          confirmedMissedOpportunityEntries: discrepancyEntries(
            comparison.discrepancy.opportunityDiscrepancy.entries.map((e) => ({
              dateKey: e.dateKey,
              assetSymbol: e.assetSymbol,
              category: "MISSED_OPPORTUNITY",
              description: `Confirmed missed opportunity on ${e.dateKey} (${e.assetSymbol}) — a valid, checklist-passing Replay setup was not taken.`,
            })),
            "replayComparison.discrepancy.confirmedMissedOpportunityEntries",
          ),
        },
      }
    : null;

  // ── Commitments (§5, §30) — this session's own, plus lifetime lineage
  // adherence reused directly from Stage 19's read model, never
  // recomputed here. ─────────────────────────────────────────────────────
  const sessionCommitments = await listCommitmentsForSession(userId, sessionId);
  async function toCommitmentEvidence(c: (typeof sessionCommitments)[number]): Promise<CommitmentEvidenceEntry> {
    const lineage = await getCommitmentLineage(userId, c.id);
    return {
      evidenceId: addEvidence(evidenceIndex, {
        id: `COMMITMENT:${c.id}`,
        strength: "DERIVED",
        category: "COMMITMENT",
        statement: `Commitment "${c.title}" (${c.category}, ${c.status}) — current period adherence ${lineage.current.adherencePercent == null ? "no data" : `${lineage.current.adherencePercent}%`} across ${lineage.current.applicableObservations} observation(s); lifetime trend ${lineage.trend}.`,
      }),
      title: c.title,
      category: c.category,
      status: c.status,
      currentAdherencePercent: lineage.current.adherencePercent,
      currentApplicableObservations: lineage.current.applicableObservations,
      previousAdherencePercent: lineage.previous?.adherencePercent ?? null,
      trend: lineage.trend,
      periodsActive: lineage.segments.length,
      resolutionEligible: lineage.resolutionEligible,
      ruleKey: c.sourceFindingType,
    };
  }
  const activeCommitments = await Promise.all(sessionCommitments.filter((c) => c.status === "ACTIVE").map(toCommitmentEvidence));
  const commitmentResults = await Promise.all(sessionCommitments.filter((c) => c.status !== "ACTIVE").map(toCommitmentEvidence));
  if (sessionCommitments.length === 0) missingData.push("NO_COMMITMENTS");

  const previousAdherenceValues = [...activeCommitments, ...commitmentResults].map((c) => c.previousAdherencePercent).filter((v): v is number => v != null);
  const previousPeriodAdherencePercent =
    previousAdherenceValues.length > 0 ? Math.round(previousAdherenceValues.reduce((s, v) => s + v, 0) / previousAdherenceValues.length) : null;

  // ── Longitudinal improvement (§5, §12) — reused directly, not
  // recomputed. Only the overview counts travel into the package; the
  // per-lineage detail is already covered by activeCommitments/
  // commitmentResults above. ─────────────────────────────────────────────
  const improvementAnalytics = await buildImprovementAnalytics(userId, session.reviewType);

  // ── Behavior occurrence trends (Stage 20.1 §2-6) — packaged directly
  // from Stage 19.1's own `behaviourOccurrence` series, never recomputed.
  // `session.reviewType` was already the scope `buildImprovementAnalytics`
  // was called with above, so weekly/monthly are never blended (§4). ─────
  const behaviorTrendCandidates = improvementAnalytics.behaviourOccurrence
    .map((series) => ({ ...series, totalBreaches: series.points.reduce((s, p) => s + p.breachCount, 0) }))
    .sort((a, b) => b.totalBreaches - a.totalBreaches || a.ruleKey.localeCompare(b.ruleKey));
  if (behaviorTrendCandidates.length > MAX_BEHAVIOR_TREND_RULES) {
    truncation.push({
      field: "behaviorOccurrenceTrends",
      totalAvailable: behaviorTrendCandidates.length,
      included: MAX_BEHAVIOR_TREND_RULES,
      selectionRule: "highest total breach count",
    });
  }
  const allCommitmentEvidence = [...activeCommitments, ...commitmentResults];
  const behaviorOccurrenceTrends: BehaviorOccurrenceTrendEntry[] = behaviorTrendCandidates.slice(0, MAX_BEHAVIOR_TREND_RULES).map((series) => {
    const pointsFull = series.points; // already chronological ascending (see buildImprovementAnalytics)
    if (pointsFull.length > MAX_BEHAVIOR_TREND_POINTS) {
      truncation.push({
        field: `behaviorOccurrenceTrends.points[${series.ruleKey}]`,
        totalAvailable: pointsFull.length,
        included: MAX_BEHAVIOR_TREND_POINTS,
        selectionRule: "most recent",
      });
    }
    const points = pointsFull.slice(-MAX_BEHAVIOR_TREND_POINTS);
    // Prefer an ACTIVE commitment's own trend/sample size for this rule — a
    // RETIRED/COMPLETED one's adherence no longer describes "current."
    const matchingCommitment = allCommitmentEvidence.find((c) => c.ruleKey === series.ruleKey) ?? null;
    const label = ruleKeyLabel(series.ruleKey);
    const trendPhrase = points.length >= 2 ? `${points.map((p) => p.breachCount).join(" → ")} breach(es) across the last ${points.length} ${session.reviewType.toLowerCase()} periods tracked` : `${points[0]?.breachCount ?? 0} breach(es) in the one ${session.reviewType.toLowerCase()} period tracked`;
    return {
      evidenceId: addEvidence(evidenceIndex, {
        id: `BEHAVIOR_TREND:${series.ruleKey}`,
        strength: "DERIVED",
        category: "BEHAVIOR_OCCURRENCE_TREND",
        statement: `${label} (${session.reviewType.toLowerCase()}): ${trendPhrase}.`,
      }),
      ruleKey: series.ruleKey,
      label,
      reviewType: session.reviewType,
      points,
      currentTrend: matchingCommitment?.trend ?? null,
      currentApplicableObservations: matchingCommitment?.currentApplicableObservations ?? null,
    };
  });
  if (behaviorOccurrenceTrends.length === 0) missingData.push("NO_LONGITUDINAL_BEHAVIOR_DATA");

  // ── Commitment vs. behavior cross-check (Stage 20.1 §9) — deterministic
  // pairing + conservative signal classification only; the analyst is told
  // (system prompt) to explain the signal in its own words, never to
  // silently reconcile a CONTRADICTORY one. ──────────────────────────────
  const commitmentBehaviorCrossChecks: CommitmentBehaviorCrossCheckEntry[] = [];
  for (const commitment of activeCommitments) {
    if (!commitment.ruleKey) continue;
    const trendEntry = behaviorOccurrenceTrends.find((t) => t.ruleKey === commitment.ruleKey);
    if (!trendEntry || trendEntry.points.length === 0) continue;

    const recentBreachCounts = trendEntry.points.map((p) => p.breachCount);
    const isPerfectAdherence = commitment.currentAdherencePercent === 100 && commitment.currentApplicableObservations >= 3;
    // Period-aligned, not "the last array entry" — the series only records
    // periods with >=1 breach, so an old breach with nothing but clean
    // periods since would otherwise be mistaken for a live contradiction.
    const currentPeriodBreach = trendEntry.points.find((p) => p.periodStart === startDate);
    const isNonIncreasing = recentBreachCounts.every((v, i) => i === 0 || v <= recentBreachCounts[i - 1]);
    const isDeclining = recentBreachCounts.length >= 2 && isNonIncreasing && recentBreachCounts[recentBreachCounts.length - 1] < recentBreachCounts[0];
    const isHealthyAdherence = commitment.currentAdherencePercent != null && commitment.currentAdherencePercent >= 70 && commitment.currentApplicableObservations >= 3;

    let signal: CommitmentBehaviorCrossCheckEntry["signal"] = "NEUTRAL";
    if (isPerfectAdherence && currentPeriodBreach && currentPeriodBreach.breachCount > 0) signal = "CONTRADICTORY";
    else if (isHealthyAdherence && isDeclining) signal = "CONVERGING";

    commitmentBehaviorCrossChecks.push({
      evidenceId: addEvidence(evidenceIndex, {
        id: `CROSS_CHECK:${commitment.ruleKey}`,
        strength: "DERIVED",
        category: "COMMITMENT_BEHAVIOR_CROSS_CHECK",
        statement: `Commitment "${commitment.title}" adherence ${commitment.currentAdherencePercent == null ? "no data" : `${commitment.currentAdherencePercent}%`} vs. ${ruleKeyLabel(commitment.ruleKey)} breach trend ${recentBreachCounts.join(" → ")} — signal: ${signal}.`,
      }),
      commitmentTitle: commitment.title,
      ruleKey: commitment.ruleKey,
      currentAdherencePercent: commitment.currentAdherencePercent,
      currentApplicableObservations: commitment.currentApplicableObservations,
      recentBreachCounts,
      signal,
    });
  }

  // ── Historical context (§11) — one prior period, summarized only. ─────
  const previousReferenceDate = addDaysToKey(startDate, -1);
  const previousPeriod = computeReviewPeriod(session.reviewType, previousReferenceDate);
  const previousPeriodTrades = await prisma.trade.findMany({
    where: {
      userId,
      tradeDate: { gte: dateKeyToUtcDate(previousPeriod.startDate), lte: dateKeyToUtcDate(previousPeriod.endDate) },
      ...(session.strategyId ? { strategyId: session.strategyId } : {}),
      ...(session.assetSymbols.length > 0 ? { assetSymbol: { in: session.assetSymbols } } : {}),
    },
    select: { actualRR: true },
  });
  const previousPeriodPerformance = previousPeriodTrades.length > 0 ? performanceSummaryFromTrades(previousPeriodTrades) : null;

  // ── Reflections (§5, §33) — trader-written, plain text extracted from
  // Tiptap JSON where applicable, always TRADER_REPORTED. ────────────────
  const weeklyReviewRow = await getWeeklyReview(userId, startDate, session.reviewType);
  const periodReflection = weeklyReviewRow
    ? {
        evidenceId: addEvidence(evidenceIndex, {
          id: "REFLECTION:PERIOD",
          strength: "TRADER_REPORTED",
          category: "REFLECTION",
          statement: [tiptapToPlainText(weeklyReviewRow.wentWell, 400), tiptapToPlainText(weeklyReviewRow.toImprove, 400), tiptapToPlainText(weeklyReviewRow.focusNextWeek, 400)]
            .filter(Boolean)
            .join(" | ") || "(reflection saved with no text content)",
        }),
        wentWell: tiptapToPlainText(weeklyReviewRow.wentWell, 400) || null,
        toImprove: tiptapToPlainText(weeklyReviewRow.toImprove, 400) || null,
        focusNextPeriod: tiptapToPlainText(weeklyReviewRow.focusNextWeek, 400) || null,
      }
    : null;
  if (!periodReflection) missingData.push("NO_PERIOD_REFLECTION");

  const dailyRows = await prisma.tradingDay.findMany({
    where: { userId, date: { gte: session.startDate, lte: session.endDate } },
    select: { date: true, dayWentWell: true, dayToImprove: true, dayMainLesson: true, dayCarryForward: true },
  });
  const dailyWithContent = dailyRows.filter((d) => d.dayWentWell || d.dayToImprove || d.dayMainLesson || d.dayCarryForward);
  if (dailyWithContent.length > MAX_DAILY_REFLECTIONS) {
    truncation.push({ field: "reflections.dailyReflections", totalAvailable: dailyWithContent.length, included: MAX_DAILY_REFLECTIONS, selectionRule: "most recent" });
  }
  const boundedDaily = takeRecent(dailyWithContent, MAX_DAILY_REFLECTIONS, (d) => utcDateToKey(d.date));
  const dailyReflections: ReflectionEntry[] = boundedDaily.map((d) => {
    const dateKey = utcDateToKey(d.date);
    return {
      evidenceId: addEvidence(evidenceIndex, {
        id: `REFLECTION:DAY:${dateKey}`,
        strength: "TRADER_REPORTED",
        category: "REFLECTION",
        statement: [d.dayWentWell, d.dayToImprove, d.dayMainLesson, d.dayCarryForward].filter(Boolean).join(" | "),
        dateKey,
      }),
      dateKey,
      wentWell: d.dayWentWell,
      toImprove: d.dayToImprove,
      lesson: d.dayMainLesson,
      carryForward: d.dayCarryForward,
    };
  });

  const tradesWithReflection = trades.filter(
    (t) => t.whatWentWell || t.whatWentWrong || t.whatCouldImprove || t.psychLessonsLearned,
  );
  if (tradesWithReflection.length > MAX_TRADE_REFLECTIONS) {
    truncation.push({ field: "reflections.tradeReflections", totalAvailable: tradesWithReflection.length, included: MAX_TRADE_REFLECTIONS, selectionRule: "most recent" });
  }
  const boundedTradeReflections = takeRecent(tradesWithReflection, MAX_TRADE_REFLECTIONS, (t) => utcDateToKey(t.tradeDate));
  const tradeReflections: TradeReflectionEntry[] = boundedTradeReflections.map((t) => {
    const dateKey = utcDateToKey(t.tradeDate);
    return {
      evidenceId: addEvidence(evidenceIndex, {
        id: `TRADE_REFLECTION:${t.id}`,
        strength: "TRADER_REPORTED",
        category: "TRADE_REFLECTION",
        statement: [t.whatWentWell, t.whatWentWrong, t.whatCouldImprove, t.psychLessonsLearned].filter(Boolean).join(" | "),
        dateKey,
      }),
      dateKey,
      whatWentWell: t.whatWentWell,
      whatWentWrong: t.whatWentWrong,
      whatCouldImprove: t.whatCouldImprove,
      wouldTakeAgain: t.wouldTakeAgain,
      ...(t.psychLessonsLearned ? { keyLesson: t.psychLessonsLearned } : {}),
      ...(t.tradeIntent ? { tradeIntent: t.tradeIntent } : {}),
    };
  });

  const coverageSummary: EvidenceCoverageSummary = {
    tradesIncluded: trades.length,
    behavioralEventsIncluded: behavioralEvidenceEntries.length,
    discrepancyEventsIncluded: replayComparison
      ? replayComparison.discrepancy.executionDiscrepancyEntries.length +
        replayComparison.discrepancy.behavioralDiscrepancyEntries.length +
        replayComparison.discrepancy.confirmedMissedOpportunityEntries.length
      : 0,
    commitmentsIncluded: activeCommitments.length + commitmentResults.length,
    replayAvailable: replayComparison != null,
    psychologyAvailable: psychologyEntriesFull.length > 0,
    longitudinalBehaviorAvailable: behaviorOccurrenceTrends.length > 0,
  };

  return {
    packageVersion: PACKAGE_VERSION,
    period: {
      sessionId,
      reviewType: session.reviewType,
      startDate,
      endDate,
      finalized: session.reviewFinalizedAt != null,
      strategyScopeName: strategyNameSnapshot,
      assetScopeSymbols: session.assetSymbols,
    },
    performanceSummary,
    strategyPerformance: { strategyName: strategyNameSnapshot, strategyVersion: strategyVersionSnapshot, setupBreakdown },
    planningAdherence: { averageExecutionPercent, tradesWithSetupType: setupCounts.size > 0 ? [...setupCounts.values()].reduce((s, v) => s + v.trades, 0) : 0, tradesTotal: trades.length },
    validationOverrides: { validatedCount: validated.length, overriddenCount: overridden.length, notValidatedCount: notValidated.length, overrideEvidenceIds },
    behavioralEvidence: { negativeCount, positiveCount, entries: behavioralEvidenceEntries },
    psychology: { averagePercent: averagePsychologyPercent, entries: psychologyEntries },
    replayComparison,
    activeCommitments,
    commitmentResults,
    longitudinalImprovement: {
      reviewType: session.reviewType,
      activeCount: improvementAnalytics.overview.activeCount,
      completedCount: improvementAnalytics.overview.completedCount,
      improvingCount: improvementAnalytics.overview.improvingCount,
      decliningCount: improvementAnalytics.overview.decliningCount,
      averageAdherencePercent: improvementAnalytics.overview.averageAdherencePercent,
    },
    reflections: { periodReflection, dailyReflections, tradeReflections },
    historicalContext: { previousPeriodPerformance, previousPeriodAdherencePercent },
    behaviorOccurrenceTrends,
    commitmentBehaviorCrossChecks,
    coverageSummary,
    missingData,
    truncation,
    evidenceIndex,
  };
}
