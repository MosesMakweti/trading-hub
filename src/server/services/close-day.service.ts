import type { TagColor, TradingDay } from "@prisma/client";

import { prisma } from "@/server/db";
import { withLedgerProjections } from "@/server/services/ledger-projection.service";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { computeTradeExecutionSummary } from "@/domain/trades/trade-execution-summary";
import { settledWinLossClass } from "@/domain/analytics/canonical-dataset";
import { toTradeDiscrepancy } from "@/server/services/trade-discrepancy";
import { currentSettlementBasis, settlementInclude, settlementInputs } from "@/server/services/settlement-basis";
import { getOrCreateTradingDay, endDay } from "@/server/services/trading-day.service";
import { reconcileTradeLifecycleForTrade } from "@/server/services/trade-review.service";
import { syncLiveTradeLifecycle } from "@/server/services/trade-lifecycle-sync.service";
import { getTradeReviewFacts } from "@/server/services/trade-review-v3.service";
import { isBacktestScope } from "@/server/workspace/scope";
import type { DailyReflectionInput, CloseTradingDayInput } from "@/lib/validation/close-day";

/**
 * Close Trading Day (Stage 8) — summarizes existing evidence (Stages 4-7's
 * frozen snapshots + actual-execution data) and finalizes the day by REUSING
 * the existing endDay/archive mechanism (trading-day.service.ts) rather than
 * building a second one. Never recalculates historical strategy/setup
 * evidence from live Strategy Lab state — every figure here is read straight
 * off already-frozen Trade columns.
 */

function tradeWhereForDay(userId: string, dateKey: string) {
  return { userId, tradeDate: dateKeyToUtcDate(dateKey), deletedAt: null } as const;
}

const dayCloseTradeInclude = {
  actualPartialExits: true,
  ...settlementInclude,
  behaviourLabels: { include: { behaviourLabel: true } },
  psychology: { select: { psychologyPercent: true } },
} as const;

export interface BehaviourLabelCountDTO {
  id: string;
  name: string;
  polarity: "POSITIVE" | "NEGATIVE";
  color: TagColor;
  count: number;
}

export interface DayCloseSummaryDTO {
  dateKey: string;
  dayStatus: "ACTIVE" | "ARCHIVED";
  tradeCount: number;
  fullyClosedCount: number;
  partiallyClosedCount: number;
  stillHoldingCount: number;
  cancelledCount: number;
  /** Executed (has an actual entry) but never given a reviewLifecycleStatus. */
  unresolvedCount: number;
  /** Today V2 Final Phase §8/§11 — the canonical Performance-settled split
   *  (isPerformanceSettled: PerformanceRiskSnapshot.settledAt != null),
   *  distinct from the reviewLifecycleStatus buckets above: a trade can be
   *  STILL_HOLDING/unset yet already Performance-settled (fully closed
   *  execution, review just not filled in yet), or vice versa. Pending here
   *  always means "outcome not yet calculable," never a $0 stand-in. */
  settledCount: number;
  pendingCount: number;
  totalRealizedRSoFar: number;
  totalPnl: number;
  wins: number;
  losses: number;
  breakevens: number;
  overrideCount: number;
  averageTradeQualityPercent: number | null;
  /** Today V2 Final Phase §8 — average of Trade.psychologyPercent across
   *  trades with an answered Honest Questionnaire that day; null when none
   *  answered one (never a fabricated average of zero data points). */
  averagePsychologyPercent: number | null;
  /** Today V2 Final Phase §8/§17 — valid setups the trader spotted but never
   *  took (TradeOpportunity: status MISSED, scored valid — setupValid ===
   *  true; `{ not: false }` excludes NULL in SQL, i.e. unscored setups are not
   *  counted), the same
   *  "missed opportunity" concept the Discrepancy Gap already scores.
   *  Deliberately never conflated with a losing Trade — a missed setup has
   *  no Trade row at all. */
  missedValidOpportunityCount: number;
  /** Today V2 Final Phase §12 — trades with a known process breach
   *  (invalid setup, FOMO/revenge/impulse, would-not-repeat, session
   *  violation, missing confirmation, manual override, …), counted whether
   *  or not the trade has settled yet — reuses the same per-trade
   *  Counterfactual reconstruction the Journal/workspace badges use, so a
   *  Pending trade's known process facts are never suppressed here either
   *  (Phase 2 §14's correction, carried through to Day Summary). */
  processBreachCount: number;
  behaviourLabels: BehaviourLabelCountDTO[];
  /** Today V3 (Phase 4) — LIVE only: trades whose FINAL review is outstanding
   *  under the centralized V3 review state (review-state.ts via
   *  getTradeReviewFacts), never `reviewedAt != null`. Null in a backtest,
   *  which keeps the V2 review flow. */
  finalReviewRequiredCount: number | null;
  reflection: {
    dayWentWell: string | null;
    dayToImprove: string | null;
    dayMainLesson: string | null;
    dayCarryForward: string | null;
  };
  /** Informational — Close Day never hard-blocks on these (Stage 8 §5). */
  warnings: string[];
}

/**
 * A trade's win/loss/breakeven for the Journal's day counts — the canonical
 * settled result (`settledWinLossClass`), the exact rule Analytics uses, in
 * both environments: LIVE by Performance Account settlement, BACKTEST by
 * price-derived settlement (`summary` is built from the basis's settlement).
 * The trader's FULLY_CLOSED confirmation no longer gates the count (LIVE used
 * to require it — a leftover from before Analytics V2, commit 8e88cc7 — so a
 * settled-but-unreviewed trade was a win in Analytics and uncounted here).
 *
 * CONTRADICTORY isn't a result: it flags a LIVE trade the trader marked
 * Fully Closed that has no settled result yet (a readiness warning only).
 * Backtesting never raised it and still doesn't.
 */
function dayOutcome(
  trade: { reviewLifecycleStatus: string | null },
  summary: { settled: boolean; realizedRSoFar: number | null },
  basis: "PERFORMANCE_ACCOUNT" | "PRICE_DERIVED",
): "WIN" | "LOSS" | "BREAKEVEN" | "CONTRADICTORY" | null {
  const settled = settledWinLossClass(summary);
  if (settled) return settled;
  return basis === "PERFORMANCE_ACCOUNT" && trade.reviewLifecycleStatus === "FULLY_CLOSED" ? "CONTRADICTORY" : null;
}

/** The compact pre-close summary + readiness warnings (Stage 8 §1/§5/§8/§9). */
export async function getDayCloseSummary(userId: string, dateKey: string): Promise<DayCloseSummaryDTO> {
  const [day, trades, missedValidOpportunityCount] = await Promise.all([
    prisma.tradingDay.findFirst({ where: { userId, date: dateKeyToUtcDate(dateKey) } }),
    prisma.trade.findMany({ where: tradeWhereForDay(userId, dateKey), include: dayCloseTradeInclude }).then(withLedgerProjections),
    // TradeOpportunity = "a valid setup appeared," deliberately separate from
    // Trade (Final Phase §17) — a missed valid opportunity has no Trade row
    // at all, so it can only ever be counted here, never conflated with a
    // losing trade. "Valid" = scored valid (setupValid === true): the Prisma
    // `{ not: false }` filter excludes NULL, matching the Discrepancy Gap's
    // own definition (opportunity-mapper.ts: `valid: setupValid === true`).
    prisma.tradeOpportunity.count({
      where: { userId, spottedAt: dateKeyToUtcDate(dateKey), status: "MISSED", setupValid: { not: false }, deletedAt: null },
    }),
  ]);

  let fullyClosedCount = 0;
  let partiallyClosedCount = 0;
  let stillHoldingCount = 0;
  let cancelledCount = 0;
  let unresolvedCount = 0;
  let totalRealizedRSoFar = 0;
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let overrideCount = 0;
  let qualitySum = 0;
  let qualityCount = 0;
  let psychologySum = 0;
  let psychologyCount = 0;
  let settledCount = 0;
  let pendingCount = 0;
  let processBreachCount = 0;
  const warnings: string[] = [];
  const labelCounts = new Map<string, BehaviourLabelCountDTO>();

  let noReflectionCount = 0;
  let contradictoryFullyClosedCount = 0;
  const basis = currentSettlementBasis();

  for (const trade of trades) {
    const settlement = settlementInputs(trade, basis);
    switch (trade.reviewLifecycleStatus) {
      case "FULLY_CLOSED":
        fullyClosedCount++;
        break;
      case "PARTIALLY_CLOSED":
        partiallyClosedCount++;
        break;
      case "STILL_HOLDING":
        stillHoldingCount++;
        break;
      case "CANCELLED_NEVER_TRIGGERED":
        cancelledCount++;
        break;
      default:
        if (trade.actualEntry != null) unresolvedCount++;
    }

    if (trade.validationState === "OVERRIDDEN") overrideCount++;
    if (trade.tradeQualityPercent != null) {
      qualitySum += trade.tradeQualityPercent;
      qualityCount++;
    }
    if (trade.psychology?.psychologyPercent != null) {
      psychologySum += trade.psychology.psychologyPercent;
      psychologyCount++;
    }

    // A cancelled idea was never meant to settle — excluded from the
    // settled/pending split the same way it's excluded from R/PnL below.
    if (trade.reviewLifecycleStatus !== "CANCELLED_NEVER_TRIGGERED") {
      if (settlement.settled) settledCount++;
      else pendingCount++;
    }

    // Today V2 Final Phase §12 — reuses the exact per-trade Counterfactual
    // reconstruction (Phase 2 §14's fix) so a still-Pending trade's known
    // process breach still counts here, without fabricating an
    // outcome-dependent number for it.
    if (
      toTradeDiscrepancy({
        tradeNumber: trade.tradeNumber,
        actualRR: trade.actualRR,
        direction: trade.direction,
        plannedEntry: trade.plannedEntry,
        plannedStopLoss: trade.plannedStopLoss,
        plannedTarget: trade.plannedTarget,
        actualEntry: trade.actualEntry,
        actualExit: trade.actualExit,
        setupValid: trade.setupValid,
        missingConfluences: trade.missingConfluences,
        wouldTakeAgain: trade.wouldTakeAgain,
        tradeIntent: trade.tradeIntent,
        executionPercent: trade.executionPercent,
        psychology: trade.psychology,
      })?.processBreach
    ) {
      processBreachCount++;
    }

    // Cancelled ideas never contribute R/PnL/win-loss (Stage 8 §4/§11) — the
    // executionSummary math is skipped entirely rather than trusted to
    // naturally return nulls, so a cancelled idea's stray actual fields
    // (there shouldn't be any) can never leak into the totals.
    if (trade.reviewLifecycleStatus !== "CANCELLED_NEVER_TRIGGERED") {
      const summary = computeTradeExecutionSummary({
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
      });

      if (summary.realizedRSoFar != null) totalRealizedRSoFar += summary.realizedRSoFar;
      if (summary.pnl != null) totalPnl += summary.pnl;

      const outcome = dayOutcome(trade, summary, basis);
      if (outcome === "WIN") wins++;
      else if (outcome === "LOSS") losses++;
      else if (outcome === "BREAKEVEN") breakevens++;
      else if (outcome === "CONTRADICTORY") contradictoryFullyClosedCount++;
    }

    const hasReflectionText = [trade.whatWentWell, trade.whatWentWrong, trade.whatCouldImprove].some(
      (v) => typeof v === "string" && v.trim() !== "",
    );
    if (
      !hasReflectionText &&
      (trade.reviewLifecycleStatus === "FULLY_CLOSED" || trade.reviewLifecycleStatus === "PARTIALLY_CLOSED")
    ) {
      noReflectionCount++;
    }

    for (const link of trade.behaviourLabels) {
      const label = link.behaviourLabel;
      if (label.deletedAt) continue;
      const existing = labelCounts.get(label.id);
      if (existing) existing.count++;
      else labelCounts.set(label.id, { id: label.id, name: label.name, polarity: label.polarity, color: label.color, count: 1 });
    }
  }

  if (unresolvedCount > 0) {
    warnings.push(
      `${unresolvedCount} executed trade${unresolvedCount === 1 ? "" : "s"} ${unresolvedCount === 1 ? "has" : "have"} no review status set yet.`,
    );
  }
  if (contradictoryFullyClosedCount > 0) {
    warnings.push(
      `${contradictoryFullyClosedCount} trade${contradictoryFullyClosedCount === 1 ? " is" : "s are"} marked Fully Closed but ${contradictoryFullyClosedCount === 1 ? "doesn't" : "don't"} have enough execution data to determine a result yet.`,
    );
  }
  // Today V3 (Phase 4) — LIVE review readiness is the centralized FINAL
  // review state, not free text: the old "no reflection notes" rule counted
  // a trade with notes but no final review as fine, and an interim review as
  // final. Backtesting keeps its V2 rule (reviewedAt there still means text).
  let finalReviewRequiredCount: number | null = null;
  if (basis === "PERFORMANCE_ACCOUNT") {
    const reviewFacts = await getTradeReviewFacts(userId, trades.map((t) => t.id));
    finalReviewRequiredCount = Object.values(reviewFacts).filter((f) => f.state === "FINAL_REVIEW_REQUIRED").length;
    if (finalReviewRequiredCount > 0) {
      warnings.push(
        `${finalReviewRequiredCount} trade${finalReviewRequiredCount === 1 ? " still requires" : "s still require"} a final review.`,
      );
    }
  } else if (noReflectionCount > 0) {
    warnings.push(`${noReflectionCount} closed trade${noReflectionCount === 1 ? "" : "s"} ${noReflectionCount === 1 ? "has" : "have"} no reflection notes yet.`);
  }
  const stillOpenCount = partiallyClosedCount + stillHoldingCount;
  if (stillOpenCount > 0) {
    warnings.push(
      `${stillOpenCount} trade${stillOpenCount === 1 ? "" : "s"} will remain open after this day closes (partially closed / still holding).`,
    );
  }

  return {
    dateKey,
    dayStatus: day?.status ?? "ACTIVE",
    tradeCount: trades.length,
    fullyClosedCount,
    partiallyClosedCount,
    stillHoldingCount,
    cancelledCount,
    unresolvedCount,
    settledCount,
    pendingCount,
    totalRealizedRSoFar,
    totalPnl,
    wins,
    losses,
    breakevens,
    overrideCount,
    averageTradeQualityPercent: qualityCount > 0 ? qualitySum / qualityCount : null,
    averagePsychologyPercent: psychologyCount > 0 ? psychologySum / psychologyCount : null,
    missedValidOpportunityCount,
    processBreachCount,
    behaviourLabels: Array.from(labelCounts.values()).sort((a, b) => b.count - a.count),
    finalReviewRequiredCount,
    reflection: {
      dayWentWell: day?.dayWentWell ?? null,
      dayToImprove: day?.dayToImprove ?? null,
      dayMainLesson: day?.dayMainLesson ?? null,
      dayCarryForward: day?.dayCarryForward ?? null,
    },
    warnings,
  };
}

/** Autosave-friendly patch — same pattern as updateTodaysPlan (Stage §2). */
export async function saveDailyReflection(userId: string, dateKey: string, input: DailyReflectionInput): Promise<void> {
  const day = await getOrCreateTradingDay(userId, dateKey);
  await prisma.tradingDay.update({
    where: { id: day.id },
    data: {
      ...("dayWentWell" in input ? { dayWentWell: input.dayWentWell ?? null } : {}),
      ...("dayToImprove" in input ? { dayToImprove: input.dayToImprove ?? null } : {}),
      ...("dayMainLesson" in input ? { dayMainLesson: input.dayMainLesson ?? null } : {}),
      ...("dayCarryForward" in input ? { dayCarryForward: input.dayCarryForward ?? null } : {}),
    },
  });
}

/**
 * The Close Trading Day action itself (Stage 8 §1/§6): save the reflection
 * (a last safety-net write — autosave should already have most of it),
 * reconcile every trade's legacy status/closedAt via the one authoritative
 * function (Stage 8 §4), then REUSE the existing endDay archive mechanism —
 * never a second archive path. A day may legitimately close with open
 * positions (PARTIALLY_CLOSED/STILL_HOLDING trades) — nothing here blocks
 * on that; getDayCloseSummary's warnings are informational only.
 */
export async function closeTradingDay(
  userId: string,
  dateKey: string,
  reflection: CloseTradingDayInput,
): Promise<TradingDay> {
  const day = await getOrCreateTradingDay(userId, dateKey);
  await prisma.tradingDay.update({
    where: { id: day.id },
    data: {
      ...("dayWentWell" in reflection ? { dayWentWell: reflection.dayWentWell ?? null } : {}),
      ...("dayToImprove" in reflection ? { dayToImprove: reflection.dayToImprove ?? null } : {}),
      ...("dayMainLesson" in reflection ? { dayMainLesson: reflection.dayMainLesson ?? null } : {}),
      ...("dayCarryForward" in reflection ? { dayCarryForward: reflection.dayCarryForward ?? null } : {}),
    },
  });

  await reconcileDayTradesForClose(userId, dateKey);
  return endDay(userId, dateKey);
}

/**
 * Brings every trade's stored lifecycle columns in step before the day
 * archives. Today V3 (Phase 4) fix: a LIVE entered trade is synced from its
 * execution facts by the Phase 3 service (syncLiveTradeLifecycle), whose
 * status=REVIEWED requires the FINAL review. The V2 reconcile it used to get
 * marks REVIEWED whenever closedAt and reviewedAt both exist — which turned
 * an interim review (reviewedAt before the close) into "reviewed" on close
 * and dropped the trade from the carried "final review required" list.
 * Everything else — Backtesting/Replay (V2 flow), cancelled ideas, LIVE rows
 * whose review status was never set (unsynced legacy), and LIVE legacy
 * results recorded as actualRR with no exit/settlement facts — keeps the V2
 * reconcile exactly as before.
 */
export async function reconcileDayTradesForClose(userId: string, dateKey: string): Promise<void> {
  const live = !isBacktestScope();
  const trades = await prisma.trade.findMany({
    where: tradeWhereForDay(userId, dateKey),
    select: {
      id: true,
      actualEntry: true,
      actualExit: true,
      actualRR: true,
      reviewLifecycleStatus: true,
      _count: { select: { actualPartialExits: true } },
      performanceRiskSnapshot: { select: { settledAt: true } },
    },
  });
  for (const trade of trades) {
    const hasCloseFacts =
      trade.actualExit != null || trade._count.actualPartialExits > 0 || trade.performanceRiskSnapshot?.settledAt != null;
    // Only trades already in the synced lifecycle (stored status set by the
    // Phase 3 sync); an unsynced legacy row (status never set) is left
    // exactly as it was, as before.
    const v3Synced =
      live &&
      trade.actualEntry != null &&
      trade.reviewLifecycleStatus != null &&
      trade.reviewLifecycleStatus !== "CANCELLED_NEVER_TRIGGERED" &&
      (trade.actualRR == null || hasCloseFacts);
    if (v3Synced) await syncLiveTradeLifecycle(userId, trade.id);
    else await reconcileTradeLifecycleForTrade(userId, trade.id);
  }
}

// ── Journal calendar (Stage 9 §2/§19) ────────────────────────────────────────

export interface DailyPerformanceSummaryDTO {
  dateKey: string;
  /** Executed trades only — cancelled ideas are counted separately and never
   *  contribute to R/PnL/win-loss (Stage 8 §4/§11). */
  executedTradeCount: number;
  cancelledCount: number;
  totalRealizedR: number;
  totalPnl: number;
  wins: number;
  losses: number;
  breakevens: number;
  /** Valid setups recorded as MISSED on this day — the same filter Day
   *  Summary uses (`setupValid: { not: false }`, which in SQL excludes NULL,
   *  i.e. only setups scored valid). */
  missedCount: number;
}

/**
 * One batched read for the trader's ENTIRE trade history (same scale
 * assumption as trades.service.ts's listDailyPnl, which this calendar used to
 * consume) — a single Prisma query with the necessary nested includes, then
 * grouped by day in memory. Deliberately NOT one query per day (Stage 9 §19).
 */
export async function listDailyPerformanceSummaries(userId: string): Promise<DailyPerformanceSummaryDTO[]> {
  const loaded = await prisma.trade.findMany({
    where: { userId },
    select: {
      id: true,
      executionModel: true,
      tradeDate: true,
      direction: true,
      actualEntry: true,
      actualStopLoss: true,
      actualExit: true,
      actualRR: true,
      reviewLifecycleStatus: true,
      plannedStopLoss: true,
      actualPartialExits: { select: { exitPrice: true, percentClosed: true } },
      ...settlementInclude,
    },
  });
  const trades = await withLedgerProjections(loaded);

  const byDay = new Map<string, DailyPerformanceSummaryDTO>();
  const get = (dateKey: string) => {
    let entry = byDay.get(dateKey);
    if (!entry) {
      entry = { dateKey, executedTradeCount: 0, cancelledCount: 0, totalRealizedR: 0, totalPnl: 0, wins: 0, losses: 0, breakevens: 0, missedCount: 0 };
      byDay.set(dateKey, entry);
    }
    return entry;
  };

  const basis = currentSettlementBasis();
  for (const trade of trades) {
    const dateKey = utcDateToKey(trade.tradeDate);
    const entry = get(dateKey);

    if (trade.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED") {
      entry.cancelledCount++;
      continue;
    }
    if (trade.actualEntry == null) continue; // a pending/unstarted idea — no result yet either way

    entry.executedTradeCount++;
    const settlement = settlementInputs(trade, basis);
    const summary = computeTradeExecutionSummary({
      direction: trade.direction,
      actualEntry: trade.actualEntry.toString(),
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
    });

    if (summary.realizedRSoFar != null) entry.totalRealizedR += summary.realizedRSoFar;
    if (summary.pnl != null) entry.totalPnl += summary.pnl;

    const outcome = dayOutcome(trade, summary, basis);
    if (outcome === "WIN") entry.wins++;
    else if (outcome === "LOSS") entry.losses++;
    else if (outcome === "BREAKEVEN") entry.breakevens++;
  }

  // One grouped query for missed setups (environment-scoped like the trades above).
  const missed = await prisma.tradeOpportunity.groupBy({
    by: ["spottedAt"],
    where: { userId, status: "MISSED", setupValid: { not: false }, deletedAt: null },
    _count: { _all: true },
  });
  for (const m of missed) get(utcDateToKey(m.spottedAt)).missedCount += m._count._all;

  return Array.from(byDay.values());
}

/** Date keys of the CLOSED (archived) days in the current workspace scope —
 *  the Backtesting Journal's "completed day" marker. Read-only. */
export async function listClosedDayKeys(userId: string): Promise<string[]> {
  const days = await prisma.tradingDay.findMany({ where: { userId, status: "ARCHIVED" }, select: { date: true }, orderBy: { date: "asc" } });
  return days.map((d) => utcDateToKey(d.date));
}
