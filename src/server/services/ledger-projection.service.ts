import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import {
  fromSpecSnapshot,
  projectLedgerForReaders,
  quoteValuePerPriceUnit,
  replayLedger,
  type LedgerFill,
  type LedgerState,
} from "@/domain/execution";

/**
 * Quantity ledger (Phase 2) — the ONE place existing readers get a
 * QUANTITY_LEDGER trade's execution facts in the shape they already consume.
 *
 * DERIVED IN MEMORY ONLY. Nothing here is persisted: PositionFill stays the
 * canonical history and TradeActualPartialExit is never written for a ledger
 * trade. After a reader loads its trades, `withLedgerProjection` swaps each
 * ledger trade's (always empty) `actualPartialExits` for rows projected from
 * its effective fills (percent of the ORIGINAL quantity, exit price, exit
 * time, per-fill R) and attaches `ledgerRealizedRSoFar` — the ledger's own
 * realized R (PnL / intended risk) for readers that show realized-so-far R on
 * an open position. LEGACY_PERCENT trades pass through untouched, and when a
 * batch has no ledger trade no query runs at all.
 */

type WithModel = { id: string; executionModel: "LEGACY_PERCENT" | "QUANTITY_LEDGER" };

export type LedgerProjected<T> = T & { ledgerRealizedRSoFar: string | null };

/** The reader-compatible row for one effective fill. A superset of every field readers select. */
function projectedRows(tradeId: string, userId: string, state: LedgerState) {
  const projection = projectLedgerForReaders(state);
  return state.effectiveCloses.map((f, i) => ({
    id: f.id,
    userId,
    tradeId,
    accountExecutionId: null,
    plannedTargetId: null,
    plannedTarget: null,
    exitOrder: i + 1,
    exitPrice: new Prisma.Decimal(f.price.toString()),
    percentClosed: new Prisma.Decimal(projection.partials[i].percentClosed),
    quantityClosed: new Prisma.Decimal(f.executedQuantity.toString()),
    exitedAt: f.executedAt,
    grossPnl: new Prisma.Decimal(f.grossPnl.toString()),
    fees: null,
    netPnl: new Prisma.Decimal(f.netPnl.toString()),
    realizedR: new Prisma.Decimal(f.realizedR.toString()),
    notes: null,
    source: "MANUAL" as const,
    createdAt: f.executedAt,
    updatedAt: f.executedAt,
  }));
}

export async function loadLedgerStates(tradeIds: string[]): Promise<Map<string, { userId: string; state: LedgerState }>> {
  const out = new Map<string, { userId: string; state: LedgerState }>();
  if (tradeIds.length === 0) return out;
  const snapshots = await prisma.performanceRiskSnapshot.findMany({
    where: { tradeId: { in: tradeIds }, executableQuantity: { not: null } },
    include: { fills: { orderBy: { sequence: "asc" } } },
  });
  for (const s of snapshots) {
    const spec = fromSpecSnapshot(s.specSnapshot);
    const fills: LedgerFill[] = s.fills.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      kind: r.kind,
      executedQuantity: r.executedQuantity.toString(),
      price: r.price.toString(),
      quantityBefore: r.quantityBefore.toString(),
      quantityAfter: r.quantityAfter.toString(),
      grossPnl: r.grossPnl.toString(),
      fees: r.fees?.toString() ?? null,
      conversionRate: r.conversionRate.toString(),
      reversesFillId: r.reversesFillId,
      executedAt: r.executedAt,
    }));
    const state = replayLedger(
      {
        direction: s.direction,
        entry: s.actualEntry.toString(),
        initialQuantity: s.executableQuantity!.toString(),
        riskAmount: s.riskAmount.toString(),
        quoteValuePerPriceUnit: quoteValuePerPriceUnit(spec),
        quantityStep: spec.quantityStep,
        minQuantity: spec.minQuantity,
      },
      fills,
    );
    out.set(s.tradeId, { userId: s.userId, state });
  }
  return out;
}

/** Batch form: replaces each ledger trade's `actualPartialExits` with its projection. */
export async function withLedgerProjections<T extends WithModel & { actualPartialExits: unknown[] }>(trades: T[]): Promise<LedgerProjected<T>[]> {
  const ledgerIds = trades.filter((t) => t.executionModel === "QUANTITY_LEDGER").map((t) => t.id);
  const states = await loadLedgerStates(ledgerIds);
  return trades.map((t) => {
    const ledger = states.get(t.id);
    if (!ledger) return { ...t, ledgerRealizedRSoFar: null };
    return {
      ...t,
      actualPartialExits: projectedRows(t.id, ledger.userId, ledger.state) as unknown as T["actualPartialExits"],
      ledgerRealizedRSoFar: ledger.state.realizedR.toString(),
    };
  });
}

/** Single-trade form. */
export async function withLedgerProjection<T extends WithModel & { actualPartialExits: unknown[] }>(trade: T): Promise<LedgerProjected<T>> {
  return (await withLedgerProjections([trade]))[0];
}
