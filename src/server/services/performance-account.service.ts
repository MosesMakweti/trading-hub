import { Decimal } from "decimal.js";

import { prisma, type TransactionClient } from "@/server/db";
import { getOrCreatePerformanceAccount, PERFORMANCE_ACCOUNT_STARTING_BALANCE } from "@/server/services/accounts.service";
import {
  computeCompoundedBalance,
  computePerformancePnl,
  computePerformanceRiskAmount,
  computeRealizedR,
  resolveInitialStop,
  type ExitInput,
} from "@/domain/performance/realized-r";

/** Falls back to the app's long-standing "1R = 1%" convention when the
 *  account has never had a default configured. */
export const DEFAULT_PERFORMANCE_RISK_PERCENT = 1;

export interface PerformanceConfig {
  accountId: string;
  startingBalance: Decimal;
  defaultRiskPercent: Decimal;
  maxRiskPercent: Decimal | null;
  compoundingEnabled: boolean;
  currency: string;
}

/** Resolves the Performance Account's own configuration (spec §2), lazily
 *  creating the account (accounts.service.ts) if this is the user's first
 *  visit — never inventing a starting balance if one is already configured. */
export async function getPerformanceConfig(userId: string): Promise<PerformanceConfig> {
  const account = await getOrCreatePerformanceAccount(userId);
  return {
    accountId: account.id,
    startingBalance: new Decimal(account.startingBalance?.toString() ?? PERFORMANCE_ACCOUNT_STARTING_BALANCE),
    defaultRiskPercent: new Decimal(account.defaultRiskPercent?.toString() ?? DEFAULT_PERFORMANCE_RISK_PERCENT),
    maxRiskPercent: account.maxRiskPercent ? new Decimal(account.maxRiskPercent.toString()) : null,
    compoundingEnabled: account.compoundingEnabled,
    currency: account.currency ?? "USD",
  };
}

export interface UpdatePerformanceConfigInput {
  startingBalance?: number;
  defaultRiskPercent?: number;
  maxRiskPercent?: number | null;
  compoundingEnabled?: boolean;
  currency?: string;
  effectiveDate?: Date | null;
}

/** Settings-flow update. `startingBalance` may only be changed while the
 *  account has no locked risk snapshots yet — once a trade has settled
 *  against it, the starting balance is load-bearing history (spec: "do not
 *  invent a starting balance… preserve any existing configured value"). */
export async function updatePerformanceConfig(userId: string, patch: UpdatePerformanceConfigInput) {
  const account = await getOrCreatePerformanceAccount(userId);

  if (patch.startingBalance != null) {
    const hasHistory = await prisma.performanceRiskSnapshot.findFirst({
      where: { userId, performanceAccountId: account.id },
      select: { id: true },
    });
    if (hasHistory) {
      throw new Error("Starting balance can't be changed once a trade has settled against this account.");
    }
  }
  if (patch.defaultRiskPercent != null && patch.defaultRiskPercent <= 0) {
    throw new Error("Default risk percentage must be greater than zero.");
  }
  if (patch.maxRiskPercent != null && patch.defaultRiskPercent != null && patch.maxRiskPercent < patch.defaultRiskPercent) {
    throw new Error("Maximum risk percentage can't be lower than the default risk percentage.");
  }

  return prisma.tradingAccount.update({
    where: { id: account.id, userId, kind: "PERFORMANCE" },
    data: {
      ...(patch.startingBalance != null ? { startingBalance: patch.startingBalance } : {}),
      ...(patch.defaultRiskPercent != null ? { defaultRiskPercent: patch.defaultRiskPercent } : {}),
      ...(patch.maxRiskPercent !== undefined ? { maxRiskPercent: patch.maxRiskPercent } : {}),
      ...(patch.compoundingEnabled != null ? { compoundingEnabled: patch.compoundingEnabled } : {}),
      ...(patch.currency != null ? { currency: patch.currency } : {}),
      ...(patch.effectiveDate !== undefined ? { effectiveDate: patch.effectiveDate } : {}),
    },
  });
}

interface TradeOrderKey {
  tradeDate: Date;
  executionMinutes: number;
  tradeNumber: number | null;
}

/**
 * Deterministic settlement ordering rule (spec §13): (tradeDate,
 * executionMinutes) as the primary chronological key, with the per-user
 * monotonic `tradeNumber` (assigned once at creation, never reused/shifted)
 * as the stable tie-breaker for same-instant trades. Used both for
 * "balance before this trade" and for any future recalculation pass.
 */
function isBefore(a: TradeOrderKey, b: TradeOrderKey): boolean {
  const at = a.tradeDate.getTime();
  const bt = b.tradeDate.getTime();
  if (at !== bt) return at < bt;
  if (a.executionMinutes !== b.executionMinutes) return a.executionMinutes < b.executionMinutes;
  return (a.tradeNumber ?? 0) < (b.tradeNumber ?? 0);
}

/**
 * Performance Balance Before Trade (spec §4/§11). With compounding enabled,
 * this is startingBalance plus every chronologically EARLIER trade's
 * already-settled Performance PnL (never later trades, regardless of save
 * order — this is what makes a backdated trade recalculate safely). With
 * compounding disabled, every trade risks against the same fixed
 * startingBalance (spec: "make the fixed-risk-base behavior explicit").
 */
export async function getPerformanceBalanceBefore(userId: string, orderKey: TradeOrderKey): Promise<Decimal> {
  const config = await getPerformanceConfig(userId);
  if (!config.compoundingEnabled) return config.startingBalance;

  const earlierSettled = await prisma.performanceRiskSnapshot.findMany({
    where: {
      userId,
      performanceAccountId: config.accountId,
      settledAt: { not: null },
      trade: { deletedAt: null },
    },
    select: { performancePnl: true, trade: { select: { tradeDate: true, executionMinutes: true, tradeNumber: true } } },
  });

  let balance = config.startingBalance;
  for (const s of earlierSettled) {
    if (isBefore(s.trade, orderKey)) {
      balance = computeCompoundedBalance(balance, s.performancePnl?.toString() ?? 0);
    }
  }
  return balance;
}

/**
 * Locks the immutable risk snapshot the moment a trade first receives an
 * actual entry (spec §4) — idempotent via the unique `tradeId` (a second
 * call is a no-op once locked; risk-amount inputs never change afterward).
 * The risk % used is whatever is currently on the Performance Account's own
 * TradeAccountAllocation.riskValue (the pre-execution override surface —
 * defaults to the account's configured default at trade creation, editable
 * up to this exact moment, see updatePerformanceRiskOverride below).
 */
export async function lockPerformanceRiskSnapshot(userId: string, tradeId: string): Promise<void> {
  const existing = await prisma.performanceRiskSnapshot.findUnique({ where: { tradeId } });
  if (existing) return;

  const trade = await prisma.trade.findFirst({ where: { id: tradeId, userId } });
  if (!trade || trade.actualEntry == null) return;

  const config = await getPerformanceConfig(userId);
  const performanceAllocation = await prisma.tradeAccountAllocation.findFirst({
    where: { tradeId, tradingAccountId: config.accountId },
  });
  const riskPercent = new Decimal(performanceAllocation?.riskValue.toString() ?? config.defaultRiskPercent.toString());
  if (!riskPercent.greaterThan(0)) throw new Error("Performance risk percentage must be greater than zero.");
  if (config.maxRiskPercent && riskPercent.greaterThan(config.maxRiskPercent)) {
    throw new Error(`Performance risk percentage can't exceed the configured maximum of ${config.maxRiskPercent}%.`);
  }

  const balanceBefore = await getPerformanceBalanceBefore(userId, trade);
  const riskAmount = computePerformanceRiskAmount(balanceBefore, riskPercent);

  const latestVersion = await prisma.tradePlanVersion.findFirst({
    where: { tradeId },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });

  await prisma.performanceRiskSnapshot.create({
    data: {
      userId,
      tradeId,
      performanceAccountId: config.accountId,
      planVersionId: latestVersion?.id ?? null,
      balanceBefore: balanceBefore.toString(),
      riskPercent: riskPercent.toString(),
      riskAmount: riskAmount.toString(),
      currency: config.currency,
      actualEntry: trade.actualEntry.toString(),
      direction: trade.direction,
      assetSymbol: trade.assetSymbol,
      lockedAt: new Date(),
    },
  });
}

/** Resolves and freezes the initial stop (spec §8) the first time one
 *  becomes available, via resolveInitialStop's 3-tier hierarchy (actual ->
 *  locked plan -> canonical planned stop) — never overwrites an
 *  already-resolved value, so moving the stop to break-even/trailing later
 *  can never redefine 1R.
 *
 *  KNOWN RESIDUAL AMBIGUITY (Stage C audit; Stage C.1 narrowed but did not
 *  fully close it): `Trade.actualStopLoss` is a single mutable column with
 *  no lock of its own. In the common paths this is safe — `actualEntry` and
 *  `actualStopLoss` are normally saved together in one Trade Execution
 *  submit (this function runs immediately after, in the same
 *  updateTradeSections call, via settlePerformanceTrade), and a trade with
 *  a locked TradingView plan or a simple planned stop resolves from that
 *  the moment entry locks, before any stop could plausibly have moved. The
 *  gap that remains: a freeform trade (no plan at all) whose trader saves
 *  `actualEntry` alone, then records `actualStopLoss` for the first time in
 *  a LATER, separate save — this function still can't distinguish "finally
 *  typing in the original stop" from "recording a stop that was already
 *  moved," because no stop-movement history is tracked anywhere in the live
 *  trade lifecycle (confirmed by audit — only the separate Replay
 *  simulation engine models a distinct current-vs-planned stop). Closing
 *  this fully needs either a dedicated, explicitly-locked initial-stop input
 *  or a stop-movement log — both real Trade Execution UX changes, out of
 *  scope here. Not changed further per explicit instruction to stop and
 *  report rather than redesign this. */
async function ensureInitialStopResolved(userId: string, tradeId: string): Promise<void> {
  const snapshot = await prisma.performanceRiskSnapshot.findUnique({ where: { tradeId } });
  if (!snapshot || snapshot.initialStop != null) return;

  const trade = await prisma.trade.findFirst({ where: { id: tradeId, userId } });
  if (!trade) return;

  const lockedPlan = await prisma.tradePlanVersion.findFirst({
    where: { tradeId, locked: true },
    orderBy: { versionNumber: "asc" },
    select: { stopLoss: true },
  });

  const { stop, source } = resolveInitialStop(
    trade.actualStopLoss?.toString() ?? null,
    lockedPlan?.stopLoss?.toString() ?? null,
    trade.plannedStopLoss?.toString() ?? null,
  );
  if (stop == null) return;

  await prisma.performanceRiskSnapshot.update({
    where: { tradeId },
    data: { initialStop: stop.toString(), initialStopSource: source },
  });
}

/** No PnL for these statuses (spec §14) — cancelled/invalidated/missed/
 *  not-taken trades never reach this codebase as a `Trade` row at all (they
 *  stay TradeOpportunity records), so the only real gate here is "does an
 *  actual entry exist" (Planned -> no effect) and "is the trade soft-deleted"
 *  (Voided -> reverse, handled by the deletedAt filter throughout). */
async function clearSettlement(tx: TransactionClient, tradeId: string, performanceAccountId: string): Promise<void> {
  await tx.performanceRiskSnapshot.update({
    where: { tradeId },
    data: { realizedR: null, performancePnl: null, settledAt: null, calculationVersion: { increment: 1 } },
  });
  // NULL, not 0 — a failed/incomplete settlement is "not calculable yet,"
  // never a breakeven trade. See the model's own doc comment in schema.prisma.
  await tx.tradeAccountAllocation.updateMany({
    where: { tradeId, tradingAccountId: performanceAccountId },
    data: { closingPnlGross: null, closingPnlNet: null },
  });
  // Deliberately does NOT touch Trade.actualRR here — see the write in
  // settlePerformanceTrade's success branch below for why this is one-way.
}

/** Explicit outcome of a settlement attempt (Stage C) — replaces the
 *  previous silent `void` return, so a caller (or a future UI) can tell
 *  "genuinely settled" apart from "couldn't be calculated yet" without
 *  re-deriving it from the snapshot/allocation rows itself. */
export type SettlementResult =
  | { status: "SETTLED"; realizedR: Decimal; performancePnl: Decimal }
  | { status: "NOT_CALCULABLE"; reason: string };

/**
 * The main recalculation entrypoint (spec §9/§10/§13) — call after any
 * change to actualEntry/actualStopLoss/actualExit/partial exits. Reads the
 * canonical actual execution data straight off the Trade Idea (never one
 * particular real account's execution — spec §7), computes realized R and
 * Performance PnL, and writes them onto the SAME snapshot row + the SAME
 * Performance TradeAccountAllocation row every time (never a second row for
 * the same trade — the unique `tradeId` on the snapshot and the unique
 * `[tradeId, tradingAccountId]` on the allocation are what make this
 * idempotent). Safe to call as often as needed; a not-yet-fully-closed or
 * not-yet-locked trade is simply left/reset at NOT_CALCULABLE (null ledger
 * PnL), never a fabricated 0.
 */
export async function settlePerformanceTrade(userId: string, tradeId: string): Promise<SettlementResult> {
  await ensureInitialStopResolved(userId, tradeId);

  const [trade, snapshot, partials] = await Promise.all([
    prisma.trade.findFirst({ where: { id: tradeId, userId } }),
    prisma.performanceRiskSnapshot.findUnique({ where: { tradeId } }),
    prisma.tradeActualPartialExit.findMany({ where: { tradeId, userId }, select: { exitPrice: true, percentClosed: true } }),
  ]);
  if (!trade || !snapshot) {
    return { status: "NOT_CALCULABLE", reason: "No locked Performance risk snapshot yet (no actual entry recorded)." };
  }

  return prisma.$transaction(async (tx) => {
    if (snapshot.initialStop == null) {
      await clearSettlement(tx, tradeId, snapshot.performanceAccountId);
      return { status: "NOT_CALCULABLE", reason: "No initial stop resolved yet — enter an actual stop loss or confirm a Trade Plan stop." };
    }

    const exits: ExitInput[] =
      partials.length > 0
        ? partials
            .filter((p) => p.percentClosed != null)
            .map((p) => ({ price: p.exitPrice.toString(), proportion: p.percentClosed!.toString() }))
        : trade.actualExit != null
          ? [{ price: trade.actualExit.toString(), proportion: 100 }]
          : [];

    const result = computeRealizedR(trade.direction, snapshot.actualEntry.toString(), snapshot.initialStop.toString(), exits);

    if (!result.fullyClosed || result.realizedR == null) {
      await clearSettlement(tx, tradeId, snapshot.performanceAccountId);
      return { status: "NOT_CALCULABLE", reason: result.reason ?? "Position is not fully closed yet." };
    }

    const pnl = computePerformancePnl(snapshot.riskAmount.toString(), result.realizedR);

    await tx.performanceRiskSnapshot.update({
      where: { tradeId },
      data: {
        realizedR: result.realizedR.toString(),
        performancePnl: pnl.toString(),
        settledAt: new Date(),
        calculationVersion: { increment: 1 },
      },
    });
    await tx.tradeAccountAllocation.updateMany({
      where: { tradeId, tradingAccountId: snapshot.performanceAccountId },
      data: { closingPnlGross: pnl.toString(), closingPnlNet: pnl.toString() },
    });
    // Trade Review overhaul (Stage 7 §3) — mirrors how Trade.expectedRR is
    // already kept in sync from the confirmed plan's weighted R (savePlan):
    // once real actual-execution data fully accounts for the position, the
    // computed realized R becomes Trade.actualRR automatically — the trader
    // no longer needs to type it manually, and every existing reader of
    // actualRR (Journal, Dashboard, analytics/discrepancy engines) picks it
    // up for free. Deliberately one-way (never cleared back to null here,
    // unlike the Performance snapshot above) — an already-closed trade's
    // Actual RR must not vanish just because an unrelated, still-in-flight
    // edit briefly makes exposure look incomplete elsewhere.
    await tx.trade.update({ where: { id: tradeId }, data: { actualRR: result.realizedR.toString() } });

    return { status: "SETTLED", realizedR: result.realizedR, performancePnl: pnl };
  });
}

/** Pre-execution risk override on the Performance Account's own allocation
 *  row (spec §5) — rejected once the risk snapshot is locked; changing risk
 *  after execution requires a plan revision-style flow, not a silent edit. */
export async function updatePerformanceRiskOverride(userId: string, tradeId: string, riskPercent: number): Promise<void> {
  if (riskPercent <= 0) throw new Error("Risk percentage must be greater than zero.");

  const trade = await prisma.trade.findFirst({ where: { id: tradeId, userId } });
  if (!trade) throw new Error("Trade not found.");

  const existingSnapshot = await prisma.performanceRiskSnapshot.findUnique({ where: { tradeId } });
  if (existingSnapshot) {
    throw new Error("Performance risk is locked once the trade has an actual entry — it can no longer be overridden here.");
  }

  const config = await getPerformanceConfig(userId);
  if (config.maxRiskPercent && new Decimal(riskPercent).greaterThan(config.maxRiskPercent)) {
    throw new Error(`Risk percentage can't exceed the configured maximum of ${config.maxRiskPercent}%.`);
  }

  await prisma.tradeAccountAllocation.updateMany({
    where: { tradeId, tradingAccountId: config.accountId },
    data: { riskValue: riskPercent },
  });
}
