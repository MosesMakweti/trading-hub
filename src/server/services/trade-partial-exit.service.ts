import { prisma } from "@/server/db";
import { computeNetPnl } from "@/domain/prop-firms/risk";
import { settlePerformanceTrade } from "@/server/services/performance-account.service";
import { syncLiveTradeLifecycle } from "@/server/services/trade-lifecycle-sync.service";
import type { PartialExitUpsertInput } from "@/lib/validation/trade-plan";

/**
 * Structured actual partial exits (checkpoint 2 §13) — the actual-side
 * sibling to PlannedTarget. Deliberately normalized (one row per exit)
 * rather than a JSON blob, matching this app's convention for anything
 * queried/aggregated later (PlannedTarget, TradeAccountExecution, …).
 */

async function assertOwnsTrade(userId: string, tradeId: string) {
  const trade = await prisma.trade.findFirst({ where: { id: tradeId, userId } });
  if (!trade) throw new Error("Trade not found.");
  return trade;
}

/** Quantity ledger (Phase 2): a QUANTITY_LEDGER trade's exits are immutable
 *  PositionFill rows — its execution history is never written here too (a
 *  DB trigger enforces the same). */
export class LedgerTradePartialExitError extends Error {
  constructor() {
    super("This trade uses quantity-ledger execution — exits are recorded as fills, not partial exits.");
    this.name = "LedgerTradePartialExitError";
  }
}

async function assertLegacyExecution(userId: string, tradeId: string) {
  const trade = await assertOwnsTrade(userId, tradeId);
  if (trade.executionModel === "QUANTITY_LEDGER") throw new LedgerTradePartialExitError();
  return trade;
}

export async function listPartialExits(userId: string, tradeId: string) {
  await assertOwnsTrade(userId, tradeId);
  return prisma.tradeActualPartialExit.findMany({
    where: { tradeId, userId },
    orderBy: { exitOrder: "asc" },
    include: { plannedTarget: true },
  });
}

/** Sum of every OTHER partial's percentClosed, for the ≤100% validation
 *  (spec §13: "total percentage closed does not exceed 100%"). */
async function otherPartialsPercentTotal(tradeId: string, excludeId?: string): Promise<number> {
  const rows = await prisma.tradeActualPartialExit.findMany({
    where: { tradeId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { percentClosed: true },
  });
  return rows.reduce((sum, r) => sum + (r.percentClosed?.toNumber() ?? 0), 0);
}

export async function upsertPartialExit(userId: string, tradeId: string, input: PartialExitUpsertInput) {
  await assertLegacyExecution(userId, tradeId);

  if (input.plannedTargetId) {
    const target = await prisma.plannedTarget.findFirst({ where: { id: input.plannedTargetId, tradeId } });
    if (!target) throw new Error("Planned target not found on this trade.");
  }
  if (input.accountExecutionId) {
    const execution = await prisma.tradeAccountExecution.findFirst({ where: { id: input.accountExecutionId, tradeId, userId } });
    if (!execution) throw new Error("Account execution not found on this trade.");
  }

  if (input.percentClosed != null) {
    const otherTotal = await otherPartialsPercentTotal(tradeId, input.id);
    if (otherTotal + input.percentClosed > 100.001) {
      throw new Error(`Total percentage closed would be ${(otherTotal + input.percentClosed).toFixed(1)}%, which exceeds 100%.`);
    }
  }

  const netPnl = input.netPnl ?? computeNetPnl(input.grossPnl ?? null, input.fees ?? null, null, null)?.toNumber() ?? null;

  const data = {
    userId,
    tradeId,
    accountExecutionId: input.accountExecutionId ?? null,
    plannedTargetId: input.plannedTargetId ?? null,
    exitOrder: input.exitOrder,
    exitPrice: input.exitPrice.toString(),
    percentClosed: input.percentClosed ?? null,
    quantityClosed: input.quantityClosed ?? null,
    exitedAt: input.exitedAt,
    grossPnl: input.grossPnl ?? null,
    fees: input.fees ?? null,
    netPnl,
    notes: input.notes ?? null,
    source: input.source ?? ("MANUAL" as const),
  };

  let result;
  if (input.id) {
    const existing = await prisma.tradeActualPartialExit.findFirst({ where: { id: input.id, tradeId, userId } });
    if (!existing) throw new Error("Partial exit not found.");
    result = await prisma.tradeActualPartialExit.update({ where: { id: input.id }, data });
  } else {
    const duplicateOrder = await prisma.tradeActualPartialExit.findFirst({ where: { tradeId, exitOrder: input.exitOrder } });
    if (duplicateOrder) throw new Error(`Exit #${input.exitOrder} already exists for this trade.`);
    result = await prisma.tradeActualPartialExit.create({ data });
  }

  // Performance Account automatic benchmark (spec §9/§13): a partial exit is
  // part of the canonical actual-execution result, so it must recompute
  // realized R / settlement the same way changing actualExit does.
  await settlePerformanceTrade(userId, tradeId);
  await syncLiveTradeLifecycle(userId, tradeId);
  return result;
}

export async function deletePartialExit(userId: string, tradeId: string, partialExitId: string): Promise<void> {
  await assertLegacyExecution(userId, tradeId);
  await prisma.tradeActualPartialExit.deleteMany({ where: { id: partialExitId, tradeId, userId } });
  await settlePerformanceTrade(userId, tradeId);
  await syncLiveTradeLifecycle(userId, tradeId);
}

/** Sets a partial's planned-target mapping explicitly — the trader's own
 *  resolution of an AMBIGUOUS or CLOSEST automatic match (spec §14: "if
 *  matching remains ambiguous, allow the trader to select"). */
export async function mapPartialToTarget(userId: string, tradeId: string, partialExitId: string, plannedTargetId: string | null): Promise<void> {
  await assertLegacyExecution(userId, tradeId);
  if (plannedTargetId) {
    const target = await prisma.plannedTarget.findFirst({ where: { id: plannedTargetId, tradeId } });
    if (!target) throw new Error("Planned target not found on this trade.");
  }
  const existing = await prisma.tradeActualPartialExit.findFirst({ where: { id: partialExitId, tradeId, userId } });
  if (!existing) throw new Error("Partial exit not found.");
  await prisma.tradeActualPartialExit.update({ where: { id: partialExitId }, data: { plannedTargetId } });
}
