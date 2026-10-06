import { Decimal } from "decimal.js";

import { prisma } from "@/server/db";
import { withLedgerProjection } from "@/server/services/ledger-projection.service";
import { resolveInstrumentSpecForSymbol } from "@/server/services/trade-plan.service";
import {
  buildAlignmentFlags,
  compareEntry,
  compareRiskAndResult,
  compareStop,
  compareTargets,
  type EntryComparison,
  type ExecutionAlignmentFlag,
  type RiskResultComparison,
  type StopComparison,
  type TargetsComparison,
} from "@/domain/trade-plan/plan-execution-comparison";
import { matchPartialsToTargets, type PartialMatchResult } from "@/domain/trade-plan/partial-matching";

/**
 * Assembles the Plan-vs-Execution comparison (checkpoint 2 §3/§4/§14) —
 * fetches the EXECUTION-TIME baseline plan version (never the latest live
 * plan, so a later revision can't silently change what an already-executed
 * trade is judged against — spec §3) plus the trade's actual fields and
 * partial exits, then hands everything to the pure domain comparison
 * functions. This file is orchestration only; all the actual math lives in
 * domain/trade-plan/plan-execution-comparison.ts and partial-matching.ts.
 */

async function assertOwnsTrade(userId: string, tradeId: string) {
  const trade = await prisma.trade.findFirst({ where: { id: tradeId, userId } });
  if (!trade) throw new Error("Trade not found.");
  return trade;
}

export interface ExecutionBaseline {
  versionNumber: number;
  direction: "LONG" | "SHORT" | null;
  entry: Decimal | null;
  stopLoss: Decimal | null;
  targets: { targetOrder: number; label: string; targetPrice: string; rMultiple: number | null }[];
  weightedPlannedR: Decimal | null;
  createdAt: Date;
}

/** The plan version active when the trade FIRST became executed — the
 *  lowest-numbered version with `locked: true` (locking happens once; every
 *  later revision inherits `locked: true` forward, so the earliest locked
 *  version is unambiguously "the one in force at execution time" — spec
 *  §3). A later revision (a higher-numbered locked version) is available
 *  separately for display, never as the comparison baseline. */
export async function getExecutionBaselineVersion(userId: string, tradeId: string): Promise<ExecutionBaseline | null> {
  await assertOwnsTrade(userId, tradeId);
  const version = await prisma.tradePlanVersion.findFirst({
    where: { tradeId, locked: true },
    orderBy: { versionNumber: "asc" },
  });
  if (!version) return null;
  return {
    versionNumber: version.versionNumber,
    direction: version.direction,
    entry: version.entry,
    stopLoss: version.stopLoss,
    targets: Array.isArray(version.targetsSnapshot) ? (version.targetsSnapshot as unknown as ExecutionBaseline["targets"]) : [],
    weightedPlannedR: version.weightedPlannedR,
    createdAt: version.createdAt,
  };
}

export interface PlanExecutionComparisonResult {
  available: true;
  baselineVersionNumber: number;
  hasLaterRevisions: boolean;
  entry: EntryComparison;
  stop: StopComparison;
  targets: TargetsComparison;
  riskResult: RiskResultComparison;
  alignmentFlags: ExecutionAlignmentFlag[];
  partials: { exitOrder: number; matchedTargetOrder: number | null; confidence: PartialMatchResult["confidence"] }[];
}

export interface PlanExecutionComparisonUnavailable {
  available: false;
  reason: string;
}

export async function getPlanExecutionComparison(
  userId: string,
  tradeId: string,
): Promise<PlanExecutionComparisonResult | PlanExecutionComparisonUnavailable> {
  const trade = await assertOwnsTrade(userId, tradeId);
  const baseline = await getExecutionBaselineVersion(userId, tradeId);
  if (!baseline) {
    return { available: false, reason: "This trade hasn't been executed yet — plan vs. execution has nothing to compare." };
  }

  const [latestVersion, execution, partials] = await Promise.all([
    prisma.tradePlanVersion.findFirst({ where: { tradeId }, orderBy: { versionNumber: "desc" } }),
    prisma.tradeAccountExecution.findFirst({ where: { tradeId, userId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.tradeActualPartialExit
      .findMany({ where: { tradeId, userId }, orderBy: { exitOrder: "asc" } })
      // A QUANTITY_LEDGER trade's exits come from its fill ledger (derived, in memory).
      .then(async (rows) => (await withLedgerProjection({ id: trade.id, executionModel: trade.executionModel, actualPartialExits: rows })).actualPartialExits),
  ]);

  const spec = resolveInstrumentSpecForSymbol(trade.assetSymbol);
  const plannedRiskDistance = baseline.entry != null && baseline.stopLoss != null ? new Decimal(baseline.entry).minus(baseline.stopLoss).abs() : null;
  const direction = baseline.direction ?? trade.direction;

  const entry = compareEntry(direction, baseline.entry, trade.actualEntry, spec, plannedRiskDistance);
  const stop = compareStop(baseline.entry, baseline.stopLoss, trade.actualEntry, trade.actualStopLoss, spec);
  const targetsComparison = compareTargets(
    direction,
    trade.actualEntry,
    trade.actualExit,
    plannedRiskDistance,
    baseline.targets.map((t) => ({ targetOrder: t.targetOrder, label: t.label, targetPrice: t.targetPrice, rMultiple: t.rMultiple })),
    spec,
    execution?.actualR ?? null,
  );

  const riskResult = compareRiskAndResult({
    plannedRiskAmount: execution?.plannedRiskAmount ?? null,
    plannedWeightedR: baseline.weightedPlannedR,
    realizedR: targetsComparison.realizedR,
    actualNetPnl: execution?.netPnl ?? null,
  });

  const alignmentFlags = buildAlignmentFlags(entry, stop);

  const matchResults = matchPartialsToTargets(
    direction,
    partials.map((p) => ({ exitOrder: p.exitOrder, exitPrice: p.exitPrice })),
    baseline.targets.map((t) => ({ targetOrder: t.targetOrder, targetPrice: t.targetPrice })),
    spec,
  );

  return {
    available: true,
    baselineVersionNumber: baseline.versionNumber,
    hasLaterRevisions: (latestVersion?.versionNumber ?? baseline.versionNumber) > baseline.versionNumber,
    entry,
    stop,
    targets: targetsComparison,
    riskResult,
    alignmentFlags,
    partials: matchResults,
  };
}
