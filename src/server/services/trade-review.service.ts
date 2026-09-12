import { prisma } from "@/server/db";
import { computeTradeExecutionSummary } from "@/domain/trades/trade-execution-summary";
import { buildPlannedVsActual } from "@/domain/trades/planned-vs-actual";
import type { PlannedVsActualDTO } from "@/domain/trades/planned-vs-actual";
import type { SetupValidationSnapshot } from "@/domain/trades/setup-validation";
import { reconcileTradeLifecycle } from "@/domain/trades/lifecycle-reconciliation";
import type { SetReviewLifecycleStatusInput } from "@/lib/validation/trade-review";
import type { DailyAssetAnalysisDTO } from "@/types/today";

/**
 * Trade Review overhaul (Stage 7) — the read/write model for the four
 * questions Trade Review must answer. Deliberately a SEPARATE surface from
 * trade-workspace.mapper.ts's lean TradeWorkspaceDTO (same pattern as
 * trade-plan.service.ts's getPlanWorkspace): richer, secondary data fetched
 * on demand rather than bloating every trade list/card query.
 */

async function assertOwnsTrade(userId: string, tradeId: string) {
  const trade = await prisma.trade.findFirst({ where: { id: tradeId, userId } });
  if (!trade) throw new Error("Trade not found.");
  return trade;
}

/**
 * Sets the trader's own answer to "what's the current state of this trade?"
 * (Stage 7 §1). Deliberately does NOT touch the existing closedAt/reviewedAt/
 * status machinery (domain/trades/lifecycle.ts) — that stays driven by actual
 * result data exactly as before; this is an additive, independent signal.
 * cancellationReason is only ever persisted alongside CANCELLED_NEVER_TRIGGERED
 * — switching away from that status clears it, so it can never survive as a
 * stale reason on a trade that's no longer marked cancelled.
 */
export async function setReviewLifecycleStatus(
  userId: string,
  tradeId: string,
  input: SetReviewLifecycleStatusInput,
): Promise<void> {
  await assertOwnsTrade(userId, tradeId);
  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      reviewLifecycleStatus: input.status,
      cancellationReason:
        input.status === "CANCELLED_NEVER_TRIGGERED" ? (input.cancellationReason?.trim() || null) : null,
    },
  });
  // Stage 8 §4 — the trader's own confirmation is exactly the signal the
  // legacy closedAt/status machinery was missing for workspace-only trades.
  await reconcileTradeLifecycleForTrade(userId, tradeId);
}

/**
 * Close Trading Day (Stage 8 §4) — the ONE place that ever writes
 * Trade.closedAt/status from a reviewLifecycleStatus signal (delegates the
 * actual decision to the pure domain/trades/lifecycle-reconciliation.ts).
 * Idempotent: a no-op when the reconciled values already match what's
 * stored, so calling this repeatedly (every setReviewLifecycleStatus call,
 * plus once per trade at Close Day) is always safe and cheap.
 */
export async function reconcileTradeLifecycleForTrade(userId: string, tradeId: string): Promise<void> {
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, userId },
    select: { closedAt: true, reviewedAt: true, status: true, reviewLifecycleStatus: true },
  });
  if (!trade) return;

  const reconciled = reconcileTradeLifecycle({
    closedAt: trade.closedAt,
    reviewedAt: trade.reviewedAt,
    reviewLifecycleStatus: trade.reviewLifecycleStatus,
  });

  if (reconciled.closedAt?.getTime() === trade.closedAt?.getTime() && reconciled.status === trade.status) {
    return;
  }
  await prisma.trade.update({
    where: { id: tradeId },
    data: { closedAt: reconciled.closedAt, status: reconciled.status },
  });
}

export interface ValidationShieldConditionReviewDTO {
  name: string;
  mandatory: boolean;
  weight: number | null;
  checked: boolean;
}

export interface ValidationShieldReviewDTO {
  setupTypeName: string | null;
  scenarioDirection: "BULLISH" | "BEARISH" | null;
  validationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null;
  score: number | null;
  mandatoryGateMet: boolean | null;
  overrideReason: string | null;
  overrideNote: string | null;
  dailyBiasSnapshot: DailyAssetAnalysisDTO["finalBias"];
  /** Null when there's no daily bias recorded for this trade at all — never a
   *  false "conflict" for missing data. */
  biasAligned: boolean | null;
  /** The frozen Stage 4 snapshot's full condition list — mandatory/optional,
   *  each with whether it was actually checked (Stage 9 §8). Read verbatim
   *  from setupValidationSnapshot, never re-resolved from live Strategy Lab. */
  conditions: ValidationShieldConditionReviewDTO[];
}

export interface TradeReviewDataDTO {
  tradeId: string;
  direction: "LONG" | "SHORT";
  reviewLifecycleStatus: "FULLY_CLOSED" | "PARTIALLY_CLOSED" | "STILL_HOLDING" | "CANCELLED_NEVER_TRIGGERED" | null;
  cancellationReason: string | null;
  plannedVsActual: PlannedVsActualDTO;
  performance: {
    /** Present only once the Performance Account has actually settled this
     *  trade (fully closed) — never a fabricated number for an open or
     *  cancelled trade (Stage 7 §11). */
    realizedR: number | null;
    pnl: number | null;
    settled: boolean;
  };
  validationShield: ValidationShieldReviewDTO;
}

export async function getTradeReviewData(userId: string, tradeId: string): Promise<TradeReviewDataDTO> {
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, userId },
    include: {
      plannedTargets: { orderBy: { targetOrder: "asc" } },
      actualPartialExits: { orderBy: { exitOrder: "asc" } },
      performanceRiskSnapshot: true,
    },
  });
  if (!trade) throw new Error("Trade not found.");

  const planned: PlannedVsActualDTO["planned"] = {
    entry: trade.plannedEntry?.toNumber() ?? null,
    stopLoss: trade.plannedStopLoss?.toNumber() ?? null,
    targets: trade.plannedTargets.map((t) => ({
      targetOrder: t.targetOrder,
      label: t.label,
      plannedPrice: t.targetPrice.toNumber(),
      plannedClosePercent: t.plannedClosePercent?.toNumber() ?? null,
      plannedRMultiple: t.rMultiple?.toNumber() ?? null,
    })),
    realizedR: trade.expectedRR?.toNumber() ?? null,
  };

  const executionSummary = computeTradeExecutionSummary({
    direction: trade.direction,
    actualEntry: trade.actualEntry?.toString() ?? null,
    actualStopLoss: trade.actualStopLoss?.toString() ?? null,
    actualExit: trade.actualExit?.toString() ?? null,
    resolvedInitialStop: trade.performanceRiskSnapshot?.initialStop?.toString() ?? null,
    partials: trade.actualPartialExits.map((p) => ({
      exitPrice: p.exitPrice.toString(),
      percentClosed: p.percentClosed?.toString() ?? null,
    })),
    settled: trade.performanceRiskSnapshot?.settledAt != null,
    settledRealizedR: trade.performanceRiskSnapshot?.realizedR?.toString() ?? null,
    settledPnl: trade.performanceRiskSnapshot?.performancePnl?.toString() ?? null,
  });

  const actual: PlannedVsActualDTO["actual"] = {
    entry: trade.actualEntry?.toNumber() ?? null,
    stopLoss: trade.actualStopLoss?.toNumber() ?? (trade.performanceRiskSnapshot?.initialStop?.toNumber() ?? null),
    exits: trade.actualPartialExits.map((e) => ({
      exitOrder: e.exitOrder,
      exitPrice: e.exitPrice.toNumber(),
      percentClosed: e.percentClosed?.toNumber() ?? null,
      realizedR: e.realizedR?.toNumber() ?? null,
      exitedAt: e.exitedAt.toISOString(),
    })),
    finalExit: trade.actualExit?.toNumber() ?? null,
    realizedRSoFar: executionSummary.realizedRSoFar,
    proportionClosedPercent: executionSummary.proportionClosedPercent,
    remainingProportionPercent: executionSummary.remainingProportionPercent,
    isFullyClosed: executionSummary.isFullyClosed,
  };

  const snapshot = trade.setupValidationSnapshot as unknown as SetupValidationSnapshot | null;
  const dailyBias = (trade.dailyBiasSnapshot as DailyAssetAnalysisDTO["finalBias"]) ?? null;

  return {
    tradeId: trade.id,
    direction: trade.direction,
    reviewLifecycleStatus: trade.reviewLifecycleStatus,
    cancellationReason: trade.cancellationReason,
    plannedVsActual: buildPlannedVsActual(planned, actual),
    performance: {
      realizedR: executionSummary.settled ? executionSummary.realizedRSoFar : null,
      pnl: executionSummary.pnl,
      settled: executionSummary.settled,
    },
    validationShield: {
      setupTypeName: snapshot?.setupType.name ?? null,
      scenarioDirection: snapshot?.scenario.direction ?? null,
      validationState: trade.validationState,
      score: snapshot?.score ?? null,
      mandatoryGateMet: snapshot?.mandatoryGateMet ?? null,
      overrideReason: trade.overrideReason,
      overrideNote: trade.overrideNote,
      dailyBiasSnapshot: dailyBias,
      biasAligned: dailyBias == null || dailyBias === "NEUTRAL" ? null : dailyBias === trade.direction,
      conditions: (snapshot?.conditions ?? []).map((c) => ({
        name: c.name,
        mandatory: c.mandatory,
        weight: c.weight,
        checked: c.checked,
      })),
    },
  };
}
