import { Decimal } from "decimal.js";

import type { TransactionClient } from "@/server/db";
import {
  fromSpecSnapshot,
  quoteValuePerPriceUnit,
  replayLedger,
  type LedgerFill,
  type LedgerState,
  type LedgerTerms,
  type ResolvedExecutionSpec,
} from "@/domain/execution";

/**
 * Quantity ledger (Phase 2) — loading a Performance ledger and settling it
 * into the EXISTING canonical outputs. Every function here takes the caller's
 * transaction client: authoritative ledger reads and writes always happen
 * inside the same transaction that holds the ledger's advisory lock
 * (`lockPerformanceLedger`).
 *
 * Canonical outputs (the compatibility boundary every reader already uses):
 *   PerformanceRiskSnapshot.realizedR / performancePnl / settledAt
 *   Performance TradeAccountAllocation.closingPnlGross / closingPnlNet
 *   Trade.actualRR
 * Fully closed → all written from the complete immutable ledger. Not fully
 * closed (never closed, or re-opened by a reversal) → all cleared, including
 * Trade.actualRR (QUANTITY_LEDGER only — LEGACY_PERCENT keeps its one-way
 * actualRR exactly as before).
 */

/** Deterministic per-ledger lock key (Phase 3 account ledgers will key by execution id). */
export function performanceLedgerLockKey(tradeId: string): string {
  return `perf-ledger:${tradeId}`;
}

export async function lockPerformanceLedger(tx: TransactionClient, tradeId: string): Promise<void> {
  const key = performanceLedgerLockKey(tradeId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export interface LoadedLedger {
  snapshot: {
    id: string;
    userId: string;
    performanceAccountId: string;
    currency: string;
    riskAmount: Decimal;
    settledAt: Date | null;
    realizedR: Decimal | null;
    performancePnl: Decimal | null;
  };
  spec: ResolvedExecutionSpec;
  terms: LedgerTerms;
  fills: LedgerFill[];
  state: LedgerState;
}

const s = (v: { toString(): string }) => v.toString();

/** Loads + replays the Performance ledger of a QUANTITY_LEDGER trade. Null when the trade has no sized snapshot. */
export async function loadPerformanceLedger(tx: TransactionClient, userId: string, tradeId: string): Promise<LoadedLedger | null> {
  const snapshot = await tx.performanceRiskSnapshot.findUnique({ where: { tradeId } });
  if (!snapshot || snapshot.userId !== userId || snapshot.executableQuantity == null || snapshot.specSnapshot == null) return null;

  const spec = fromSpecSnapshot(snapshot.specSnapshot);
  const terms: LedgerTerms = {
    direction: snapshot.direction,
    entry: s(snapshot.actualEntry),
    initialQuantity: s(snapshot.executableQuantity),
    riskAmount: s(snapshot.riskAmount),
    quoteValuePerPriceUnit: quoteValuePerPriceUnit(spec),
    quantityStep: spec.quantityStep,
    minQuantity: spec.minQuantity,
  };
  const rows = await tx.positionFill.findMany({ where: { performanceSnapshotId: snapshot.id }, orderBy: { sequence: "asc" } });
  const fills: LedgerFill[] = rows.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    kind: r.kind,
    executedQuantity: s(r.executedQuantity),
    price: s(r.price),
    quantityBefore: s(r.quantityBefore),
    quantityAfter: s(r.quantityAfter),
    grossPnl: s(r.grossPnl),
    fees: r.fees == null ? null : s(r.fees),
    conversionRate: s(r.conversionRate),
    reversesFillId: r.reversesFillId,
    executedAt: r.executedAt,
  }));
  return {
    snapshot: {
      id: snapshot.id,
      userId: snapshot.userId,
      performanceAccountId: snapshot.performanceAccountId,
      currency: snapshot.currency,
      riskAmount: new Decimal(s(snapshot.riskAmount)),
      settledAt: snapshot.settledAt,
      realizedR: snapshot.realizedR == null ? null : new Decimal(s(snapshot.realizedR)),
      performancePnl: snapshot.performancePnl == null ? null : new Decimal(s(snapshot.performancePnl)),
    },
    spec,
    terms,
    fills,
    state: replayLedger(terms, fills),
  };
}

export type LedgerSettlementResult =
  | { status: "SETTLED"; realizedR: Decimal; performancePnl: Decimal }
  | { status: "NOT_CALCULABLE"; reason: string };

/** Storage precision of the canonical columns (Decimal(8,4) / (14,2) / Trade.actualRR (8,2)), rounded HALF-EVEN here so the database never rounds. */
const toSnapshotR = (r: Decimal) => r.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN);
const toActualRR = (r: Decimal) => r.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

/** Writes (or clears) the canonical settlement from the complete ledger. Caller holds the ledger lock. */
export async function settleLoadedLedger(tx: TransactionClient, tradeId: string, ledger: LoadedLedger): Promise<LedgerSettlementResult> {
  const { snapshot, state } = ledger;

  if (!state.fullyClosed) {
    await tx.performanceRiskSnapshot.update({
      where: { tradeId },
      data: { realizedR: null, performancePnl: null, settledAt: null, calculationVersion: { increment: 1 } },
    });
    await tx.tradeAccountAllocation.updateMany({
      where: { tradeId, tradingAccountId: snapshot.performanceAccountId },
      data: { closingPnlGross: null, closingPnlNet: null },
    });
    // D8 — a ledger trade that is not fully closed has no final result.
    await tx.trade.update({ where: { id: tradeId }, data: { actualRR: null } });
    return { status: "NOT_CALCULABLE", reason: state.fills.length === 0 ? "No exit recorded yet." : "Part of the position remains open." };
  }

  const realizedR = new Decimal(toSnapshotR(state.realizedR).toString());
  const pnl = new Decimal(state.realizedPnl.toString()); // Σ booked fill nets — already exact cents
  const unchanged = snapshot.settledAt != null && snapshot.realizedR?.equals(realizedR) && snapshot.performancePnl?.equals(pnl);

  await tx.performanceRiskSnapshot.update({
    where: { tradeId },
    data: {
      realizedR: realizedR.toString(),
      performancePnl: pnl.toString(),
      settledAt: unchanged ? snapshot.settledAt : new Date(),
      calculationVersion: { increment: 1 },
    },
  });
  await tx.tradeAccountAllocation.updateMany({
    where: { tradeId, tradingAccountId: snapshot.performanceAccountId },
    data: { closingPnlGross: pnl.toString(), closingPnlNet: pnl.toString() },
  });
  await tx.trade.update({ where: { id: tradeId }, data: { actualRR: toActualRR(state.realizedR).toString() } });
  return { status: "SETTLED", realizedR, performancePnl: pnl };
}

/** Lock → load → settle, in the caller's transaction. */
export async function settlePerformanceLedger(tx: TransactionClient, userId: string, tradeId: string): Promise<LedgerSettlementResult> {
  await lockPerformanceLedger(tx, tradeId);
  const ledger = await loadPerformanceLedger(tx, userId, tradeId);
  if (!ledger) return { status: "NOT_CALCULABLE", reason: "No sized quantity-ledger snapshot." };
  return settleLoadedLedger(tx, tradeId, ledger);
}
