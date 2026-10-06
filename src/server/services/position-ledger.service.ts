import { Decimal } from "decimal.js";

import { prisma, type TransactionClient } from "@/server/db";
import { isBacktestScope } from "@/server/workspace/scope";
import { getPerformanceBalanceBefore, getPerformanceConfig } from "@/server/services/performance-account.service";
import { resolveSpecForUser } from "@/server/services/instrument-spec.service";
import { syncLiveTradeLifecycle } from "@/server/services/trade-lifecycle-sync.service";
import {
  loadPerformanceLedger,
  lockPerformanceLedger,
  settleLoadedLedger,
  type LedgerSettlementResult,
  type LoadedLedger,
} from "@/server/services/ledger-settlement.service";
import {
  LedgerError,
  SIZING_VERSION,
  computeValuePerPriceUnit,
  planCloseFill,
  planReversal,
  projectLedgerForReaders,
  sizePosition,
  toSpecSnapshot,
  type CloseRequest,
  type LedgerErrorCode,
  type PlannedFill,
} from "@/domain/execution";
import { resolveInitialStop } from "@/domain/performance/realized-r";

/**
 * Quantity ledger (Phase 2) — the Performance Account's quantity-ledger
 * write paths. Service-only (no UI yet; reached from Today V3
 * recordFirstEntry when QUANTITY_LEDGER is on, and from tests).
 *
 *   risk budget → frozen sizing inputs → executable quantity → immutable
 *   fills → realized PnL → realized R → existing canonical settlement
 *
 * Every write runs in ONE transaction holding the ledger's advisory lock,
 * with every authoritative read inside it. LIVE only: a backtest scope or a
 * backtest trade is rejected (DB triggers enforce the same).
 */

export type LedgerEntryErrorCode =
  | "INITIAL_STOP_REQUIRED"
  | "INITIAL_STOP_INVALID"
  | "INSTRUMENT_SPEC_INSUFFICIENT"
  | "CONVERSION_REQUIRED"
  | "CANNOT_SIZE_WITHIN_RISK"
  | "INVALID_SIZING"
  | "RISK_PERCENT_INVALID"
  | "ALREADY_ENTERED"
  | "BACKTEST_NOT_ALLOWED"
  | "TRADE_NOT_FOUND";

/** A first entry the quantity engine cannot size. Never downgraded to LEGACY_PERCENT. */
export class QuantityLedgerEntryError extends Error {
  constructor(
    readonly code: LedgerEntryErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "QuantityLedgerEntryError";
  }
}

export type LedgerWriteErrorCode = LedgerErrorCode | "NOT_A_LEDGER_TRADE" | "BACKTEST_NOT_ALLOWED" | "TRADE_NOT_FOUND" | "CONVERSION_REQUIRED";

export class QuantityLedgerError extends Error {
  constructor(
    readonly code: LedgerWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QuantityLedgerError";
  }
}

function assertLive() {
  if (isBacktestScope()) throw new QuantityLedgerError("BACKTEST_NOT_ALLOWED", "Backtest trades never use the Performance quantity ledger.");
}

const str = (v: { toString(): string } | null | undefined) => (v == null ? null : v.toString());

// ── First entry: sizing + model selection ──────────────────────────────────

export interface LedgerEntryInput {
  actualEntry: number | string;
  entryMinutes: number;
  /** The stop actually used, submitted with the first entry. */
  actualStopLoss?: number | string | null;
}

export interface LedgerEntryResult {
  tradeId: string;
  /** False when this call found the trade already sized by an identical earlier submission. */
  created: boolean;
  riskAmount: string;
  effectiveRiskAmount: string;
  executableQuantity: string;
}

/**
 * Records the FIRST actual entry of a trade as a QUANTITY_LEDGER trade:
 * lock → re-read → verify no snapshot → resolve stop / spec / currency /
 * risk → size → write entry facts + executionModel → create the sized
 * snapshot. Atomic: on any eligibility failure nothing is written and a
 * structured QuantityLedgerEntryError is thrown.
 */
export async function enterQuantityLedgerTrade(userId: string, tradeId: string, input: LedgerEntryInput): Promise<LedgerEntryResult> {
  if (isBacktestScope()) throw new QuantityLedgerEntryError("BACKTEST_NOT_ALLOWED", "Backtest trades never use the quantity ledger.");
  const config = await getPerformanceConfig(userId);

  return prisma.$transaction(async (tx) => {
    await lockPerformanceLedger(tx, tradeId);
    const trade = await tx.trade.findFirst({
      where: { id: tradeId, userId },
      include: { performanceRiskSnapshot: true },
    });
    if (!trade) throw new QuantityLedgerEntryError("TRADE_NOT_FOUND", "Trade not found.");
    if (trade.backtestRunId != null) throw new QuantityLedgerEntryError("BACKTEST_NOT_ALLOWED", "Backtest trades never use the quantity ledger.");

    const existing = trade.performanceRiskSnapshot;
    if (existing || trade.actualEntry != null) {
      // Idempotent double submit: the same entry already sized this trade.
      if (
        existing?.executableQuantity != null &&
        trade.executionModel === "QUANTITY_LEDGER" &&
        new Decimal(existing.actualEntry.toString()).equals(new Decimal(String(input.actualEntry)))
      ) {
        return {
          tradeId,
          created: false,
          riskAmount: existing.riskAmount.toString(),
          effectiveRiskAmount: str(existing.effectiveRiskAmount)!,
          executableQuantity: str(existing.executableQuantity)!,
        };
      }
      throw new QuantityLedgerEntryError("ALREADY_ENTERED", "An entry is already recorded for this trade.");
    }

    // Genuine initial stop: the stop submitted with this entry, else the
    // plan stop / planned stop that existed BEFORE execution. Resolved and
    // frozen here, in the entry transaction — a stop typed later can never
    // become this trade's 1R reference.
    const latestPlan = await tx.tradePlanVersion.findFirst({
      where: { tradeId },
      orderBy: { versionNumber: "desc" },
      select: { id: true, stopLoss: true },
    });
    const { stop, source } = resolveInitialStop(
      input.actualStopLoss ?? null,
      str(latestPlan?.stopLoss),
      str(trade.plannedStopLoss),
    );
    if (stop == null || source == null) {
      throw new QuantityLedgerEntryError("INITIAL_STOP_REQUIRED", "A genuine initial stop is required before a quantity-ledger entry can be sized.");
    }

    const spec = await resolveSpecForUser(userId, trade.assetSymbol, tx);
    if (spec.status !== "RESOLVED") {
      throw new QuantityLedgerEntryError("INSTRUMENT_SPEC_INSUFFICIENT", `Instrument economics for ${trade.assetSymbol} are incomplete.`, {
        symbol: spec.symbol,
        missing: spec.missing,
        invalid: spec.invalid,
      });
    }
    const value = computeValuePerPriceUnit(spec.spec, config.currency, null);
    if (value.status !== "OK") {
      throw new QuantityLedgerEntryError("CONVERSION_REQUIRED", value.reason, { from: value.from, to: value.to });
    }

    const allocation = await tx.tradeAccountAllocation.findFirst({ where: { tradeId, tradingAccountId: config.accountId } });
    const riskPercent = new Decimal(allocation?.riskValue.toString() ?? config.defaultRiskPercent.toString());
    if (!riskPercent.greaterThan(0)) throw new QuantityLedgerEntryError("RISK_PERCENT_INVALID", "Performance risk percentage must be greater than zero.");
    if (config.maxRiskPercent && riskPercent.greaterThan(config.maxRiskPercent)) {
      throw new QuantityLedgerEntryError("RISK_PERCENT_INVALID", `Performance risk percentage can't exceed the configured maximum of ${config.maxRiskPercent}%.`);
    }

    const balanceBefore = await getPerformanceBalanceBefore(userId, {
      tradeDate: trade.tradeDate,
      executionMinutes: input.entryMinutes,
      tradeNumber: trade.tradeNumber,
    });
    const sizing = sizePosition({
      direction: trade.direction,
      balanceBasis: balanceBefore.toString(),
      riskPercent: riskPercent.toString(),
      entry: String(input.actualEntry),
      initialStop: stop.toString(),
      spec: spec.spec,
      accountValuePerPriceUnit: value.accountValuePerPriceUnit,
    });
    if (sizing.status === "INVALID") {
      const stopSide = /stop must be/i.test(sizing.reason);
      throw new QuantityLedgerEntryError(stopSide ? "INITIAL_STOP_INVALID" : "INVALID_SIZING", sizing.reason);
    }
    if (sizing.status === "CANNOT_SIZE_WITHIN_RISK") {
      throw new QuantityLedgerEntryError("CANNOT_SIZE_WITHIN_RISK", "The minimum tradable quantity would risk more than the intended budget.", {
        intendedRiskAmount: sizing.intendedRiskAmount.toString(),
        riskAtMinQuantity: sizing.riskAtMinQuantity.toString(),
        minQuantity: sizing.minQuantity.toString(),
        rawQuantity: sizing.rawQuantity.toString(),
      });
    }

    // Model first (the DB forbids changing it once a snapshot exists), then the sized snapshot.
    await tx.trade.update({
      where: { id: tradeId },
      data: {
        executionModel: "QUANTITY_LEDGER",
        actualEntry: String(input.actualEntry),
        executionMinutes: input.entryMinutes,
        ...(input.actualStopLoss != null ? { actualStopLoss: String(input.actualStopLoss) } : {}),
      },
    });
    await tx.performanceRiskSnapshot.create({
      data: {
        userId,
        tradeId,
        performanceAccountId: config.accountId,
        planVersionId: latestPlan?.id ?? null,
        balanceBefore: balanceBefore.toString(),
        riskPercent: riskPercent.toString(),
        riskAmount: sizing.intendedRiskAmount.toString(),
        currency: value.accountCurrency,
        actualEntry: String(input.actualEntry),
        direction: trade.direction,
        assetSymbol: trade.assetSymbol,
        lockedAt: new Date(),
        initialStop: stop.toString(),
        initialStopSource: source,
        effectiveRiskAmount: sizing.effectiveRiskAmount.toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN).toString(),
        rawQuantity: sizing.rawQuantity.toDecimalPlaces(16, Decimal.ROUND_DOWN).toString(),
        executableQuantity: sizing.executableQuantity.toString(),
        quantityUnit: spec.spec.quantityUnit,
        valuePerPriceUnit: value.accountValuePerPriceUnit.toString(),
        sizingConversionRate: value.conversionRate.toString(),
        specSnapshot: toSpecSnapshot(spec.spec) as object,
        sizingVersion: SIZING_VERSION,
      },
    });
    return {
      tradeId,
      created: true,
      riskAmount: sizing.intendedRiskAmount.toString(),
      effectiveRiskAmount: sizing.effectiveRiskAmount.toString(),
      executableQuantity: sizing.executableQuantity.toString(),
    };
  });
}

// ── Fills ──────────────────────────────────────────────────────────────────

async function loadForWrite(tx: TransactionClient, userId: string, tradeId: string): Promise<LoadedLedger> {
  await lockPerformanceLedger(tx, tradeId);
  const trade = await tx.trade.findFirst({ where: { id: tradeId, userId }, select: { executionModel: true, backtestRunId: true } });
  if (!trade) throw new QuantityLedgerError("TRADE_NOT_FOUND", "Trade not found.");
  if (trade.backtestRunId != null) throw new QuantityLedgerError("BACKTEST_NOT_ALLOWED", "Backtest trades never use the Performance quantity ledger.");
  if (trade.executionModel !== "QUANTITY_LEDGER") throw new QuantityLedgerError("NOT_A_LEDGER_TRADE", "This trade uses LEGACY_PERCENT execution.");
  const ledger = await loadPerformanceLedger(tx, userId, tradeId);
  if (!ledger) throw new QuantityLedgerError("NOT_A_LEDGER_TRADE", "This trade has no sized quantity ledger.");
  return ledger;
}

/** Phase 2 currency rule: quote = account currency → 1; otherwise CONVERSION_REQUIRED (no FX service, never 1:1). */
function fillConversionRate(ledger: LoadedLedger): string {
  if (ledger.spec.quoteCurrency.toUpperCase() !== ledger.snapshot.currency.toUpperCase()) {
    throw new QuantityLedgerError("CONVERSION_REQUIRED", `A ${ledger.spec.quoteCurrency}→${ledger.snapshot.currency} rate is required for this fill.`);
  }
  return "1";
}

async function insertFill(
  tx: TransactionClient,
  userId: string,
  tradeId: string,
  ledger: LoadedLedger,
  planned: PlannedFill,
  meta: {
    source: "MANUAL" | "PLANNED_TARGET" | "CORRECTION" | "IMPORTED";
    executedAt: Date;
    planVersionId?: string | null;
    plannedTargetOrder?: number | null;
    replacesFillId?: string | null;
    note?: string | null;
  },
) {
  return tx.positionFill.create({
    data: {
      userId,
      tradeId,
      performanceSnapshotId: ledger.snapshot.id,
      sequence: ledger.fills.length + 1,
      kind: planned.kind,
      source: meta.source,
      requestedPercent: str(planned.requestedPercent),
      percentBasis: planned.requestedPercent != null ? "REMAINING_QUANTITY" : null,
      requestedQuantity: str(planned.requestedQuantity),
      executedQuantity: planned.executedQuantity.toString(),
      price: planned.price.toString(),
      quantityBefore: planned.quantityBefore.toString(),
      quantityAfter: planned.quantityAfter.toString(),
      grossPnl: planned.grossPnl.toString(),
      fees: str(planned.fees),
      conversionRate: planned.conversionRate.toString(),
      executedAt: meta.executedAt,
      planVersionId: meta.planVersionId ?? null,
      plannedTargetOrder: meta.plannedTargetOrder ?? null,
      reversesFillId: planned.reversesFillId,
      replacesFillId: meta.replacesFillId ?? null,
      note: meta.note ?? null,
    },
  });
}

function asLedgerError(e: unknown): never {
  if (e instanceof LedgerError) throw new QuantityLedgerError(e.code, e.message);
  throw e;
}

export type CloseFillInput = CloseRequest & {
  price: number | string;
  executedAt: Date;
  source?: "MANUAL" | "PLANNED_TARGET" | "IMPORTED";
  planVersionId?: string | null;
  plannedTargetOrder?: number | null;
  note?: string | null;
};

export interface FillWriteResult {
  fillIds: string[];
  remainingQuantity: string;
  fullyClosed: boolean;
  settlement: LedgerSettlementResult;
}

async function finish(tx: TransactionClient, userId: string, tradeId: string, fillIds: string[]): Promise<FillWriteResult> {
  const after = await loadPerformanceLedger(tx, userId, tradeId); // replays + verifies the new tail
  const settlement = await settleLoadedLedger(tx, tradeId, after!);
  return { fillIds, remainingQuantity: after!.state.remainingQuantity.toString(), fullyClosed: after!.state.fullyClosed, settlement };
}

/** Appends one CLOSE fill (by quantity, or percent of the CURRENT remaining quantity) and re-settles. */
export async function recordCloseFill(userId: string, tradeId: string, input: CloseFillInput): Promise<FillWriteResult> {
  assertLive();
  const result = await prisma.$transaction(async (tx) => {
    const ledger = await loadForWrite(tx, userId, tradeId);
    const rate = fillConversionRate(ledger);
    const request: CloseRequest =
      input.percentOfRemaining != null ? { percentOfRemaining: String(input.percentOfRemaining) } : { quantity: String(input.quantity) };
    let planned: PlannedFill;
    try {
      planned = planCloseFill(ledger.terms, ledger.state, request, String(input.price), rate);
    } catch (e) {
      asLedgerError(e);
    }
    const fill = await insertFill(tx, userId, tradeId, ledger, planned!, {
      source: input.source ?? "MANUAL",
      executedAt: input.executedAt,
      planVersionId: input.planVersionId,
      plannedTargetOrder: input.plannedTargetOrder,
      note: input.note,
    });
    return finish(tx, userId, tradeId, [fill.id]);
  });
  await syncLifecycle(userId, tradeId);
  return result;
}

export interface CorrectFillInput {
  note?: string | null;
  /** Optional replacement CLOSE, appended right after the reversal. */
  replacement?: { quantity: number | string; price: number | string; executedAt: Date; note?: string | null };
}

/**
 * Corrects a fill without UPDATE or DELETE: appends a REVERSAL that exactly
 * negates an unreversed CLOSE of THIS ledger, then (optionally) a replacement
 * CLOSE linked by replacesFillId. Re-settles from the complete ledger — a
 * reversal that re-opens a settled trade clears its canonical result.
 */
export async function correctFill(userId: string, tradeId: string, fillId: string, input: CorrectFillInput = {}): Promise<FillWriteResult> {
  assertLive();
  const result = await prisma.$transaction(async (tx) => {
    const ledger = await loadForWrite(tx, userId, tradeId);
    let reversal: PlannedFill;
    try {
      // Only fills of THIS ledger are candidates — another trade's or another
      // owner's fill is simply not found.
      reversal = planReversal(ledger.state, ledger.fills, fillId);
    } catch (e) {
      asLedgerError(e);
    }
    const rev = await insertFill(tx, userId, tradeId, ledger, reversal!, { source: "CORRECTION", executedAt: new Date(), note: input.note });
    const ids = [rev.id];

    if (input.replacement) {
      const mid = await loadPerformanceLedger(tx, userId, tradeId);
      const rate = fillConversionRate(mid!);
      let planned: PlannedFill;
      try {
        planned = planCloseFill(mid!.terms, mid!.state, { quantity: String(input.replacement.quantity) }, String(input.replacement.price), rate);
      } catch (e) {
        asLedgerError(e);
      }
      const rep = await insertFill(tx, userId, tradeId, mid!, planned!, {
        source: "CORRECTION",
        executedAt: input.replacement.executedAt,
        replacesFillId: fillId,
        note: input.replacement.note,
      });
      ids.push(rep.id);
    }
    return finish(tx, userId, tradeId, ids);
  });
  await syncLifecycle(userId, tradeId);
  return result;
}

// ── Read model ─────────────────────────────────────────────────────────────

export async function getPerformanceLedger(userId: string, tradeId: string) {
  return prisma.$transaction(async (tx) => {
    const ledger = await loadPerformanceLedger(tx, userId, tradeId);
    if (!ledger) return null;
    return { ...ledger, projection: projectLedgerForReaders(ledger.state) };
  });
}

async function syncLifecycle(userId: string, tradeId: string) {
  await syncLiveTradeLifecycle(userId, tradeId);
}
