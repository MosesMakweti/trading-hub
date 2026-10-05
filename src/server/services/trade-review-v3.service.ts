import { prisma } from "@/server/db";
import { withLedgerProjection, withLedgerProjections } from "@/server/services/ledger-projection.service";
import { isBacktestScope } from "@/server/workspace/scope";
import { currentSettlementBasis, settlementInputs } from "@/server/services/settlement-basis";
import { getPerformanceConfig } from "@/server/services/performance-account.service";
import { listBehaviourLabels } from "@/server/services/behaviour-labels.service";
import { updateTradeSections } from "@/server/services/trades.service";
import { syncLiveTradeLifecycle } from "@/server/services/trade-lifecycle-sync.service";
import { computeTradeExecutionSummary } from "@/domain/trades/trade-execution-summary";
import { exitedPercentFrom } from "@/domain/trades/trade-lifecycle";
import { sanitizeAdherenceAnswers, scoreAdherence } from "@/domain/trades/adherence";
import { scorePsychology } from "@/domain/psychology/scoring";
import {
  buildCanonicalPsychologyAnswers,
  deriveBiasAlignment,
  deriveFomoAnswer,
  psychologyKeySources,
  type BiasAlignment,
  type PsychologyAnswerMap,
  type PsychologyKeySource,
  type TradeIntentValue,
} from "@/domain/psychology/review-adapter";
import {
  closedMomentFrom,
  deriveReviewState,
  type ReviewRequirement,
  type ReviewState,
} from "@/domain/trades/review-state";
import {
  exitAdherenceEvidence,
  filterSuggestionsToCatalog,
  riskAdherenceEvidence,
  stopWidened,
  suggestBehaviourLabelNames,
  type EvidenceResult,
  type ExitEvidenceResult,
  type LimitOverrideContext,
} from "@/domain/trades/review-evidence";
import {
  buildPlanVsActual,
  deriveReviewResult,
  type PlanVsActual,
  type ReviewResult,
} from "@/domain/trades/review-summary";
import { utcDateToKey } from "@/lib/date";

/**
 * Today V3 (Phase 3) — Review: DERIVE → SHOW EVIDENCE → ASK FOR JUDGEMENT →
 * REFLECT. The read model and the writes behind the V3 Review stage (LIVE
 * Today + the live Journal trade view). Every stored answer is an existing
 * canonical column/row — no V3-only review records:
 *   motive → Trade.tradeIntent · process → Trade.adherenceAnswers ·
 *   psychology → PsychologyQuestionnaireResponse (same 8 keys, same scorer,
 *   via domain/psychology/review-adapter.ts) · labels → TradeBehaviourLabel ·
 *   reflection → whatWentWell / whatCouldImprove / psychLessonsLearned /
 *   wouldTakeAgain · completion → Trade.reviewedAt (explicit).
 */

const reviewInclude = {
  plannedTargets: { orderBy: { targetOrder: "asc" as const } },
  actualPartialExits: { orderBy: { exitOrder: "asc" as const }, include: { plannedTarget: { select: { targetOrder: true } } } },
  performanceRiskSnapshot: true,
  planVersions: { orderBy: { versionNumber: "asc" as const } },
  psychology: true,
  behaviourLabels: { select: { behaviourLabelId: true } },
} as const;

export interface LegacyReflectionDTO {
  label: string;
  text: string;
}

export interface V3ReviewDTO {
  tradeId: string;
  dateKey: string;
  direction: "LONG" | "SHORT";
  assetSymbol: string;
  state: ReviewState;
  missing: ReviewRequirement[];
  /** reviewedAt exists but no longer satisfies the final review (interim /
   *  legacy / text-only). */
  hasEarlierReview: boolean;
  closed: boolean;
  cancelled: boolean;
  cancellationReason: string | null;
  reasonForTrade: string | null;
  result: ReviewResult;
  planVsActual: PlanVsActual;
  overrides: {
    /** Phase 2 daily-limit override — the HISTORICAL context, as frozen. */
    limit: { reason: string; context: LimitOverrideContext | null } | null;
    /** Setup Validation shield override (a different concept). */
    setupValidation: { reason: string | null; note: string | null } | null;
    /** Performance risk set away from the account default before entry. */
    performanceRisk: { riskPercent: number; defaultRiskPercent: number } | null;
  };
  biasAlignment: BiasAlignment;
  dailyBiasSnapshot: string | null;
  risk: EvidenceResult;
  exit: ExitEvidenceResult;
  psychology: {
    sources: Record<string, PsychologyKeySource>;
    /** The stored canonical answers ({} when never scored). */
    stored: PsychologyAnswerMap;
    derived: { fomo: "yes" | "no" | null; alignedWithBias: "yes" | "no" | null };
    complete: boolean;
    percent: number | null;
    grade: string | null;
  };
  tradeIntent: TradeIntentValue | null;
  adherenceAnswers: Record<string, boolean>;
  adherencePercent: number | null;
  wouldTakeAgain: boolean | null;
  reflection: { whatWentWell: string | null; whatCouldImprove: string | null; psychLessonsLearned: string | null };
  legacyReflection: LegacyReflectionDTO[];
  labelSuggestions: { labelId: string; name: string; reason: string }[];
  reviewedAt: string | null;
  /** Phase 4 — for a cancelled idea: the MISSED opportunity the trader
   *  explicitly recorded from it (TradeOpportunity.originTradeId), else null. */
  recordedMissedOpportunity: { id: string; missReason: string | null; missedOutcome: string | null } | null;
}

type ReviewTrade = NonNullable<Awaited<ReturnType<typeof loadReviewTrade>>>;

async function loadReviewTrade(userId: string, tradeId: string) {
  const trade = await prisma.trade.findFirst({ where: { id: tradeId, userId }, include: reviewInclude });
  // A QUANTITY_LEDGER trade's exits come from its fill ledger (derived, in memory).
  return trade ? withLedgerProjection(trade) : null;
}

const num = (v: { toNumber(): number } | null | undefined): number | null => (v == null ? null : v.toNumber());

function computeFacts(trade: ReviewTrade) {
  const lockedVersions = trade.planVersions.filter((v) => v.locked);
  const settlement = settlementInputs(
    { ...trade, planVersions: lockedVersions.slice(0, 1) },
    currentSettlementBasis(),
  );
  const exited = exitedPercentFrom(
    trade.actualPartialExits.map((p) => ({ percentClosed: num(p.percentClosed) })),
    num(trade.actualExit),
  );
  const hasActualEntry = trade.actualEntry != null;
  const cancelled = trade.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED";
  const hasLegacyResult = !hasActualEntry && trade.actualRR != null;
  const closed = hasActualEntry ? (exited ?? 0) >= 100 - 1e-6 || settlement.settled : hasLegacyResult;
  const summary = hasActualEntry
    ? computeTradeExecutionSummary({
        direction: trade.direction,
        actualEntry: trade.actualEntry?.toString() ?? null,
        actualStopLoss: trade.actualStopLoss?.toString() ?? null,
        actualExit: trade.actualExit?.toString() ?? null,
        resolvedInitialStop: settlement.resolvedInitialStop,
        partials: trade.actualPartialExits.map((p) => ({
          exitPrice: p.exitPrice.toString(),
          percentClosed: p.percentClosed?.toString() ?? null,
        })),
        settled: settlement.settled,
        settledRealizedR: settlement.settledRealizedR,
        settledPnl: settlement.settledPnl,
        realizedRSoFarOverride: trade.ledgerRealizedRSoFar,
      })
    : null;
  const review = deriveReviewState({
    cancelled,
    hasActualEntry,
    hasLegacyResult,
    closed,
    closedMoment: closedMomentFrom(
      trade.closedAt,
      trade.performanceRiskSnapshot?.settledAt ?? null,
      trade.actualPartialExits.map((p) => p.exitedAt),
    ),
    reviewedAt: trade.reviewedAt,
    answers: {
      tradeIntent: trade.tradeIntent,
      adherenceAnswers: (trade.adherenceAnswers as Record<string, boolean> | null) ?? {},
      wouldTakeAgain: trade.wouldTakeAgain,
    },
  });
  return { lockedVersions, settlement, exited, hasActualEntry, cancelled, closed, summary, review };
}

export async function getV3ReviewData(userId: string, tradeId: string): Promise<V3ReviewDTO> {
  const trade = await loadReviewTrade(userId, tradeId);
  if (!trade) throw new Error("Trade not found.");
  const f = computeFacts(trade);

  const [perf, day, catalog, recordedMissed] = await Promise.all([
    isBacktestScope() ? Promise.resolve(null) : getPerformanceConfig(userId),
    prisma.tradingDay.findFirst({
      where: { userId, date: trade.tradeDate },
      select: { riskBudgetPercent: true },
    }),
    listBehaviourLabels(userId),
    f.cancelled
      ? prisma.tradeOpportunity.findFirst({
          where: { userId, originTradeId: trade.id, deletedAt: null },
          select: { id: true, missReason: true, missedOutcome: true },
        })
      : Promise.resolve(null),
  ]);

  const direction = trade.direction;
  const lockedPlan = f.lockedVersions[0] ?? null;
  const initialStop = f.settlement.resolvedInitialStop;
  const currentStop = num(trade.actualStopLoss);
  const riskPercent = num(trade.performanceRiskSnapshot?.riskPercent);
  const defaultRiskPercent = perf ? perf.defaultRiskPercent.toNumber() : null;
  const dayRiskLimitPercent = num(day?.riskBudgetPercent);
  const limitOverride = trade.limitOverrideReason
    ? { reason: trade.limitOverrideReason, context: (trade.limitOverrideContext as unknown as LimitOverrideContext | null) ?? null }
    : null;

  // Planned targets: the LOCKED plan's frozen targets (what was planned
  // before execution); structured management flags from the live target rows.
  const snapshotTargets = (Array.isArray(lockedPlan?.targetsSnapshot) ? lockedPlan.targetsSnapshot : []) as {
    targetOrder: number;
    label: string;
    targetPrice: number | string;
    plannedClosePercent: number | string | null;
  }[];
  const targets = snapshotTargets.map((t) => {
    const live = trade.plannedTargets.find((p) => p.targetOrder === t.targetOrder);
    return {
      targetOrder: t.targetOrder,
      label: t.label,
      price: Number(t.targetPrice),
      closePercent: t.plannedClosePercent == null ? null : Number(t.plannedClosePercent),
      managementInstruction: live?.managementInstruction ?? null,
      moveToBreakEven: live?.moveToBreakEven ?? false,
    };
  });

  // Actual exits: partials, plus a final actualExit closing any remainder.
  const exits = trade.actualPartialExits.map((p) => ({
    price: p.exitPrice.toNumber(),
    percent: num(p.percentClosed),
    targetOrder: p.plannedTarget?.targetOrder ?? null,
  }));
  const partialSum = exits.reduce((s, e) => s + (e.percent ?? 0), 0);
  if (trade.actualExit != null && (exits.length === 0 || (exits.every((e) => e.percent != null) && partialSum < 100 - 1e-6))) {
    exits.push({ price: trade.actualExit.toNumber(), percent: exits.length === 0 ? 100 : 100 - partialSum, targetOrder: null });
  }

  const risk = riskAdherenceEvidence({
    direction,
    riskPercent,
    defaultRiskPercent,
    initialStop,
    currentStop,
    dayRiskLimitPercent,
    limitOverride,
  });
  const exit = exitAdherenceEvidence({
    direction,
    closed: f.closed,
    entry: num(trade.actualEntry),
    initialStop,
    targets,
    exits,
  });

  const exitFacts =
    exit.facts.length > 0
      ? exit.facts
      : exits.map((e) => `${e.percent != null ? `${Math.round(e.percent * 100) / 100}% ` : ""}at ${e.price}`);

  const biasAlignment = deriveBiasAlignment(direction, trade.dailyBiasSnapshot);
  const planVsActual = buildPlanVsActual({
    direction,
    assetSymbol: trade.assetSymbol,
    plan: lockedPlan
      ? {
          entry: num(lockedPlan.entry),
          stopLoss: num(lockedPlan.stopLoss),
          managementInstructions: targets
            .map((t) =>
              [t.managementInstruction?.trim(), t.moveToBreakEven ? `move stop to breakeven after ${t.label}` : null]
                .filter(Boolean)
                .join("; "),
            )
            .filter((s) => s !== ""),
        }
      : null,
    planConfirmedAfterEntry: !lockedPlan && trade.planVersions.length > 0 && f.hasActualEntry,
    actual: { entry: num(trade.actualEntry), initialStop },
    exitFacts,
    risk: { riskPercent, defaultRiskPercent, dayRiskLimitPercent },
    biasAlignment,
    dailyBiasSnapshot: trade.dailyBiasSnapshot,
    setup: { valid: trade.setupValid, rating: trade.setupRating, validationState: trade.validationState },
    confluencePercent: trade.confluencePercent,
    executionPercent: trade.executionPercent,
  });

  const stored = (trade.psychology?.answers as PsychologyAnswerMap | undefined) ?? {};
  const fomo = deriveFomoAnswer(trade.tradeIntent);
  const alignedWithBias = biasAlignment === "UNKNOWN" ? null : biasAlignment === "ALIGNED" ? "yes" : "no";

  const attachedIds = trade.behaviourLabels.map((l) => l.behaviourLabelId);
  const labelSuggestions = f.hasActualEntry
    ? filterSuggestionsToCatalog(
        suggestBehaviourLabelNames({
          tradeIntent: trade.tradeIntent,
          risk,
          exit,
          stopWidened: stopWidened(direction, initialStop, currentStop),
        }),
        catalog.map((c) => ({ id: c.id, name: c.name })),
        attachedIds,
      )
    : [];

  const legacyReflection: LegacyReflectionDTO[] = [
    { label: "What did I do wrong?", text: trade.whatWentWrong },
    { label: "What surprised me?", text: trade.whatSurprisedMe },
    { label: "General reflection", text: trade.psychPostTradeReflection },
    { label: "What will I work on?", text: trade.psychWhatToWorkOn },
  ]
    .filter((r): r is LegacyReflectionDTO => typeof r.text === "string" && r.text.trim() !== "");

  const adherenceAnswers = (trade.adherenceAnswers as Record<string, boolean> | null) ?? {};
  return {
    tradeId: trade.id,
    dateKey: utcDateToKey(trade.tradeDate),
    direction,
    assetSymbol: trade.assetSymbol,
    state: f.review.state,
    missing: f.review.missing,
    hasEarlierReview: f.review.hasEarlierReview,
    closed: f.closed,
    cancelled: f.cancelled,
    cancellationReason: trade.cancellationReason,
    reasonForTrade: trade.reasonForTrade,
    result: deriveReviewResult({
      cancelled: f.cancelled,
      hasActualEntry: f.hasActualEntry,
      closed: f.closed,
      exitedPercent: f.exited,
      summary: f.summary,
    }),
    planVsActual,
    overrides: {
      limit: limitOverride,
      setupValidation:
        trade.validationState === "OVERRIDDEN" ? { reason: trade.overrideReason, note: trade.overrideNote } : null,
      performanceRisk:
        riskPercent != null && defaultRiskPercent != null && Math.abs(riskPercent - defaultRiskPercent) > 1e-9
          ? { riskPercent, defaultRiskPercent }
          : null,
    },
    biasAlignment,
    dailyBiasSnapshot: trade.dailyBiasSnapshot,
    risk,
    exit,
    psychology: {
      sources: psychologyKeySources(direction, trade.dailyBiasSnapshot),
      stored,
      derived: { fomo, alignedWithBias },
      complete: trade.psychology != null,
      percent: trade.psychology?.psychologyPercent ?? null,
      grade: trade.psychology?.grade ?? null,
    },
    tradeIntent: trade.tradeIntent,
    adherenceAnswers,
    adherencePercent: scoreAdherence(adherenceAnswers).percent,
    wouldTakeAgain: trade.wouldTakeAgain,
    reflection: {
      whatWentWell: trade.whatWentWell,
      whatCouldImprove: trade.whatCouldImprove,
      psychLessonsLearned: trade.psychLessonsLearned,
    },
    legacyReflection,
    labelSuggestions,
    reviewedAt: trade.reviewedAt?.toISOString() ?? null,
    recordedMissedOpportunity: recordedMissed,
  };
}

/** Phase 4 — the centralized review/settlement facts for many trades at once
 *  (Close Day, Needs Attention). Same `computeFacts` the Review stage uses,
 *  so Close can never disagree with Review about final completeness. */
export interface TradeReviewFacts {
  state: ReviewState;
  missing: ReviewRequirement[];
  hasEarlierReview: boolean;
  hasActualEntry: boolean;
  cancelled: boolean;
  closed: boolean;
  exitedPercent: number | null;
  settled: boolean;
  hasPerformanceSnapshot: boolean;
  resolvedInitialStop: number | null;
  settledRealizedR: number | null;
  settledPnl: number | null;
}

export async function getTradeReviewFacts(userId: string, tradeIds: string[]): Promise<Record<string, TradeReviewFacts>> {
  if (tradeIds.length === 0) return {};
  const trades = await withLedgerProjections(await prisma.trade.findMany({ where: { id: { in: tradeIds }, userId }, include: reviewInclude }));
  const out: Record<string, TradeReviewFacts> = {};
  for (const trade of trades) {
    const f = computeFacts(trade);
    out[trade.id] = {
      state: f.review.state,
      missing: f.review.missing,
      hasEarlierReview: f.review.hasEarlierReview,
      hasActualEntry: f.hasActualEntry,
      cancelled: f.cancelled,
      closed: f.closed,
      exitedPercent: f.exited,
      settled: f.settlement.settled,
      hasPerformanceSnapshot: trade.performanceRiskSnapshot != null,
      resolvedInitialStop: f.settlement.resolvedInitialStop,
      settledRealizedR: f.settlement.settledRealizedR,
      settledPnl: f.settlement.settledPnl,
    };
  }
  return out;
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Re-scores the canonical questionnaire from the trader's answers plus the
 *  derived keys. Persists only a COMPLETE payload (the scorer needs all 8);
 *  an incomplete one never overwrites a stored score. */
async function persistPsychology(
  tradeId: string,
  trade: { tradeIntent: TradeIntentValue | null; direction: "LONG" | "SHORT"; dailyBiasSnapshot: string | null },
  traderAnswers: PsychologyAnswerMap,
): Promise<{ complete: boolean; missing: string[] }> {
  const payload = buildCanonicalPsychologyAnswers({
    tradeIntent: trade.tradeIntent,
    direction: trade.direction,
    dailyBiasSnapshot: trade.dailyBiasSnapshot,
    trader: traderAnswers,
  });
  if (!payload.complete) return { complete: false, missing: payload.missing };
  const { rawScore, percent, grade } = scorePsychology(
    Object.entries(payload.answers).map(([key, value]) => ({ key, value })),
  );
  const data = { answers: payload.answers, rawScore, psychologyPercent: percent, grade };
  await prisma.psychologyQuestionnaireResponse.upsert({
    where: { tradeId },
    create: { tradeId, ...data },
    update: data,
  });
  return { complete: true, missing: [] };
}

export async function saveReviewPsychology(userId: string, tradeId: string, traderAnswers: PsychologyAnswerMap) {
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, userId },
    select: { tradeIntent: true, direction: true, dailyBiasSnapshot: true, actualEntry: true },
  });
  if (!trade) throw new Error("Trade not found.");
  if (trade.actualEntry == null) throw new Error("Psychology is reviewed once the trade has been entered.");
  const result = await persistPsychology(tradeId, trade, traderAnswers);
  await syncLiveTradeLifecycle(userId, tradeId);
  return result;
}

/** The canonical motive. FOMO is derived from it, so an existing scored
 *  questionnaire is re-derived (same answers, new fomo) — never asked twice. */
export async function setReviewTradeIntent(userId: string, tradeId: string, intent: TradeIntentValue | null) {
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, userId },
    select: { direction: true, dailyBiasSnapshot: true, psychology: { select: { answers: true } } },
  });
  if (!trade) throw new Error("Trade not found.");
  await updateTradeSections(userId, tradeId, { tradeIntent: intent }, { stampReviewedAtFromText: false });
  if (trade.psychology && intent != null) {
    await persistPsychology(
      tradeId,
      { tradeIntent: intent, direction: trade.direction, dailyBiasSnapshot: trade.dailyBiasSnapshot },
      trade.psychology.answers as PsychologyAnswerMap,
    );
  }
  await syncLiveTradeLifecycle(userId, tradeId);
}

export interface ReviewFieldsPatch {
  whatWentWell?: string | null;
  whatCouldImprove?: string | null;
  psychLessonsLearned?: string | null;
  wouldTakeAgain?: boolean | null;
  adherenceAnswers?: Record<string, boolean>;
}

/** Process answers + reflection — written through the canonical section
 *  service WITHOUT the legacy text→reviewedAt stamp. */
export async function updateReviewFields(userId: string, tradeId: string, patch: ReviewFieldsPatch) {
  const clean: ReviewFieldsPatch = { ...patch };
  if (clean.adherenceAnswers) clean.adherenceAnswers = sanitizeAdherenceAnswers(clean.adherenceAnswers);
  if (Object.keys(clean).length === 0) return;
  await updateTradeSections(userId, tradeId, clean, { stampReviewedAtFromText: false });
}

export class ReviewIncompleteError extends Error {
  constructor(public readonly missing: ReviewRequirement[]) {
    super(`Complete these first: ${missing.map((m) => m.label).join(", ")}.`);
  }
}

/**
 * The explicit end of a review.
 *  - FINAL (position fully closed): every structured requirement must be
 *    answered; stamps reviewedAt AFTER the close moment.
 *  - INTERIM (still open / partially closed): saves "reviewed so far" — it
 *    can never satisfy the final review (once the position fully closes,
 *    closedAt > reviewedAt → final review required again).
 */
export async function completeReview(userId: string, tradeId: string, now = new Date()): Promise<{ mode: "FINAL" | "INTERIM" }> {
  // Make sure closedAt / reviewLifecycleStatus reflect the facts first.
  await syncLiveTradeLifecycle(userId, tradeId, now);
  const trade = await loadReviewTrade(userId, tradeId);
  if (!trade) throw new Error("Trade not found.");
  const f = computeFacts(trade);
  if (f.cancelled && !f.hasActualEntry) throw new Error("A cancelled idea has no execution to review.");
  if (!f.hasActualEntry && trade.actualRR == null) throw new Error("Review is available once the trade is entered.");

  if (!f.closed) {
    await prisma.trade.update({ where: { id: tradeId }, data: { reviewedAt: now } });
    await syncLiveTradeLifecycle(userId, tradeId, now);
    return { mode: "INTERIM" };
  }
  if (f.review.missing.length > 0) throw new ReviewIncompleteError(f.review.missing);
  const closedAt = trade.closedAt;
  const reviewedAt = closedAt && closedAt.getTime() > now.getTime() ? closedAt : now;
  await prisma.trade.update({ where: { id: tradeId }, data: { reviewedAt } });
  await syncLiveTradeLifecycle(userId, tradeId, now);
  return { mode: "FINAL" };
}

/** Whether V3 Review writes may proceed on an ARCHIVED day: only for a
 *  position that was carried past its own day and whose final review is
 *  still outstanding (or that is still open). Everything else on an
 *  archived day stays locked. */
export async function reviewWritableOnArchivedDay(userId: string, tradeId: string): Promise<boolean> {
  const trade = await loadReviewTrade(userId, tradeId);
  if (!trade || trade.actualEntry == null) return false;
  const f = computeFacts(trade);
  if (!f.closed) return true;
  if (f.review.state === "FINAL_REVIEW_COMPLETE") return false;
  const closedMoment = closedMomentFrom(
    trade.closedAt,
    trade.performanceRiskSnapshot?.settledAt ?? null,
    trade.actualPartialExits.map((p) => p.exitedAt),
  );
  return closedMoment != null && utcDateToKey(closedMoment) > utcDateToKey(trade.tradeDate);
}
