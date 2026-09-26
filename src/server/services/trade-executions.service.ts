import { Decimal } from "decimal.js";

import { prisma, type TransactionClient } from "@/server/db";
import { postLedgerEntry, removeLedgerEntriesForSource } from "@/server/services/account-ledger.service";
import {
  computeActualR,
  computeNetPnl,
  computePlannedR,
  estimateNetPnlFromActualR,
  plannedRiskAmount as computePlannedRiskAmount,
  resolvePlannedPrices,
  resolveRiskBase,
  FixedSizeRiskAmountError,
} from "@/domain/prop-firms/risk";
import { sizeCfdPosition, sizeFuturesPosition, type PositionSizeResult } from "@/domain/prop-firms/position-sizing";
import { evaluateAllocationWarnings, type RiskWarning, type RuleBreachActionLike } from "@/domain/prop-firms/risk-warnings";
import type { ExecutionStatus, MarketCategory, RiskBasis, RiskEntryMode } from "@prisma/client";

export interface InstrumentSizingInput {
  stopDistance?: number | null;
  pipOrTickValue?: number | null;
  conversionRate?: number | null;
  stopDistanceTicks?: number | null;
  tickValue?: number | null;
}

export interface UpsertExecutionInput {
  propFirmAccountId: string;
  riskEntryMode: RiskEntryMode;
  riskBasis: RiskBasis;
  riskInputValue: number;
  plannedEntryOverride?: number | null;
  plannedStopLossOverride?: number | null;
  plannedTargetOverride?: number | null;
  actualEntry?: number | null;
  actualExit?: number | null;
  actualLotSize?: number | null;
  actualContractQty?: number | null;
  grossPnl?: number | null;
  commission?: number | null;
  swapFinancing?: number | null;
  otherFees?: number | null;
  actualR?: number | null;
  status?: ExecutionStatus;
  executionNotes?: string | null;
  instrumentSizing?: InstrumentSizingInput;
}

const INACTIVE_ACCOUNT_STATUSES = ["FAILED", "BREACHED", "ARCHIVED"] as const;

/** Everything needed to compute risk/sizing/warnings for one account: its
 *  identity/status, its currently active stage, and a ledger-derived
 *  balance. Shared by previewAllocation and upsertExecution so the preview
 *  the trader sees before saving matches exactly what gets persisted. */
async function loadAllocationContext(userId: string, propFirmAccountId: string, excludeExecutionId?: string) {
  const account = await prisma.propFirmAccount.findFirst({
    where: { id: propFirmAccountId, userId },
    include: { stages: { where: { status: "ACTIVE" }, orderBy: { order: "desc" }, take: 1, include: { rules: true } } },
  });
  if (!account) throw new Error("Prop firm account not found.");

  const stage = account.stages[0] ?? null;

  const latestLedgerEntry = await prisma.accountLedgerEntry.findFirst({
    where: { accountId: propFirmAccountId },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    select: { balanceAfter: true },
  });
  const currentBalance = latestLedgerEntry ? new Decimal(latestLedgerEntry.balanceAfter.toString()) : new Decimal(account.startingBalance.toString());

  const otherOpenExecutions = await prisma.tradeAccountExecution.findMany({
    where: {
      propFirmAccountId,
      status: { in: ["PLANNED", "ALLOCATED", "EXECUTED", "PARTIALLY_CLOSED"] },
      ...(excludeExecutionId ? { id: { not: excludeExecutionId } } : {}),
    },
    select: { plannedRiskAmount: true },
  });
  const combinedOpenRisk = otherOpenExecutions.reduce((sum, e) => sum.plus(e.plannedRiskAmount.toString()), new Decimal(0));

  return { account, stage, currentBalance, combinedOpenRisk };
}

function ruleByKey(
  rules: { ruleKey: string; numericValue: { toString(): string } | null; breachAction: RuleBreachActionLike | null }[],
  key: string,
): { numericValue: string; breachAction: RuleBreachActionLike | null } | null {
  const rule = rules.find((r) => r.ruleKey === key);
  if (!rule || rule.numericValue == null) return null;
  return { numericValue: rule.numericValue.toString(), breachAction: rule.breachAction };
}

function sizePosition(marketCategory: MarketCategory, riskAmount: Decimal, sizing?: InstrumentSizingInput): PositionSizeResult {
  if (marketCategory === "FUTURES") {
    return sizeFuturesPosition({
      riskAmount,
      stopDistanceTicks: sizing?.stopDistanceTicks ?? undefined,
      tickValue: sizing?.tickValue ?? undefined,
    });
  }
  return sizeCfdPosition({
    riskAmount,
    stopDistance: sizing?.stopDistance ?? undefined,
    pipOrTickValue: sizing?.pipOrTickValue ?? undefined,
    conversionRate: sizing?.conversionRate ?? undefined,
  });
}

async function loadIdea(userId: string, tradeId: string) {
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, userId },
    select: { id: true, direction: true, plannedEntry: true, plannedStopLoss: true, plannedTarget: true, backtestRunId: true },
  });
  if (!trade) throw new Error("Trade not found.");
  // Backtesting — also enforced by a DB trigger; this is the friendly error.
  if (trade.backtestRunId != null) throw new Error("Backtest trades can't be executed on Prop Firm accounts.");
  return trade;
}

export interface AllocationPreview {
  plannedRiskAmount: Decimal;
  positionSize: PositionSizeResult;
  plannedR: Decimal | null;
  plannedRReason?: string;
  warnings: RiskWarning[];
}

/** No-write preview of what saving this allocation would produce — powers
 *  the Account Allocation row's live risk/position-size/warnings display
 *  before the trader confirms. */
export async function previewAllocation(userId: string, tradeId: string, input: UpsertExecutionInput): Promise<AllocationPreview> {
  const idea = await loadIdea(userId, tradeId);
  const { account, stage, currentBalance, combinedOpenRisk } = await loadAllocationContext(userId, input.propFirmAccountId);

  const base = resolveRiskBase(input.riskBasis, {
    currentBalance,
    currentEquity: account.currentEquity?.toString() ?? null,
    stageStartingBalance: stage?.startingBalance.toString() ?? account.startingBalance.toString(),
  });

  let riskAmount: Decimal;
  if (input.riskEntryMode === "FIXED_SIZE") {
    riskAmount = new Decimal(0); // resolved below once position size math confirms feasibility
  } else {
    riskAmount = computePlannedRiskAmount(input.riskEntryMode, input.riskInputValue, base);
  }

  let positionSize: PositionSizeResult;
  if (input.riskEntryMode === "FIXED_SIZE") {
    positionSize = { kind: "computed", positionSize: new Decimal(input.riskInputValue), unit: account.marketCategory === "FUTURES" ? "CONTRACTS" : "LOTS" };
  } else {
    positionSize = sizePosition(account.marketCategory, riskAmount, input.instrumentSizing);
  }

  const resolved = resolvePlannedPrices(
    { plannedEntry: idea.plannedEntry?.toString() ?? null, plannedStopLoss: idea.plannedStopLoss?.toString() ?? null, plannedTarget: idea.plannedTarget?.toString() ?? null },
    {
      plannedEntryOverride: input.plannedEntryOverride ?? null,
      plannedStopLossOverride: input.plannedStopLossOverride ?? null,
      plannedTargetOverride: input.plannedTargetOverride ?? null,
    },
  );
  const plannedRResult = computePlannedR(idea.direction, resolved.entry, resolved.stopLoss, resolved.target);

  const rules = stage?.rules ?? [];
  const warnings = evaluateAllocationWarnings({
    accountStatus: account.status,
    stageStatus: stage?.status ?? "PENDING",
    plannedRiskAmount: riskAmount,
    riskBase: base,
    maxRiskPerTradeRule: ruleByKey(rules, "MAX_RISK_PER_TRADE"),
    combinedOpenRisk,
    maxRiskPerDayRule: ruleByKey(rules, "MAX_RISK_PER_DAY"),
    remainingDailyLossRoom: null, // requires rule-health.ts's live evaluation — surfaced separately in the UI, not duplicated here
    remainingDrawdownRoom: null,
    proposedPositionSize: positionSize.kind === "computed" ? positionSize.positionSize : null,
    maxLotOrContractRule: ruleByKey(rules, account.marketCategory === "FUTURES" ? "MAX_CONTRACT_SIZE" : "MAX_LOT_SIZE"),
  });

  return { plannedRiskAmount: riskAmount, positionSize, plannedR: plannedRResult.plannedR, plannedRReason: plannedRResult.reason, warnings };
}

async function upsertExecutionWithinTx(
  tx: TransactionClient,
  userId: string,
  tradeId: string,
  input: UpsertExecutionInput,
) {
  const idea = await loadIdea(userId, tradeId);
  const existing = await tx.tradeAccountExecution.findUnique({
    where: { tradeId_propFirmAccountId: { tradeId, propFirmAccountId: input.propFirmAccountId } },
  });

  const { account, stage, currentBalance, combinedOpenRisk } = await loadAllocationContext(userId, input.propFirmAccountId, existing?.id);
  if (INACTIVE_ACCOUNT_STATUSES.includes(account.status as (typeof INACTIVE_ACCOUNT_STATUSES)[number])) {
    throw new Error(`This account is ${account.status.toLowerCase()} and can't take new allocations.`);
  }
  if (!stage || stage.status !== "ACTIVE") {
    throw new Error("This account has no active stage to allocate against.");
  }

  // Current resolved base — always fresh, used for the live warning preview
  // below (e.g. "your frozen $ risk is now a bigger % of a since-shrunk
  // balance"). It is NOT what gets persisted as the risk amount unless this
  // is a new allocation or the trader explicitly changed the risk inputs —
  // see riskInputsChanged below.
  const currentBase = resolveRiskBase(input.riskBasis, {
    currentBalance,
    currentEquity: account.currentEquity?.toString() ?? null,
    stageStartingBalance: stage.startingBalance.toString(),
  });

  // Spec §1: "Do not recalculate the original risk amount from a future
  // account balance. Historical records must remain accurate after the
  // account balance changes." So plannedRiskAmount/riskBaseSnapshot are only
  // (re)computed on a brand-new allocation or when the trader explicitly
  // changes riskEntryMode/riskBasis/riskInputValue — never as a side effect
  // of saving an unrelated field (execution notes, actuals, status, …).
  const riskInputsChanged =
    !existing ||
    existing.riskEntryMode !== input.riskEntryMode ||
    existing.riskBasis !== input.riskBasis ||
    !new Decimal(existing.riskInputValue.toString()).equals(input.riskInputValue);

  let riskAmount: Decimal;
  let riskBaseSnapshot: Decimal;
  let positionSize: PositionSizeResult;

  if (!riskInputsChanged && existing) {
    riskBaseSnapshot = new Decimal(existing.riskBaseSnapshot.toString());
    riskAmount = new Decimal(existing.plannedRiskAmount.toString());
    // Position size may still be refined from newly entered instrument data
    // without perturbing the frozen risk dollar amount.
    positionSize =
      input.riskEntryMode === "FIXED_SIZE"
        ? { kind: "computed", positionSize: new Decimal(input.riskInputValue), unit: account.marketCategory === "FUTURES" ? "CONTRACTS" : "LOTS" }
        : sizePosition(account.marketCategory, riskAmount, input.instrumentSizing);
  } else {
    riskBaseSnapshot = currentBase;
    if (input.riskEntryMode === "FIXED_SIZE") {
      const sized = sizePosition(account.marketCategory, new Decimal(1), input.instrumentSizing); // probe: is instrument data present at all?
      if (sized.kind === "insufficient_data") {
        throw new FixedSizeRiskAmountError();
      }
      const perUnitRisk = account.marketCategory === "FUTURES"
        ? new Decimal(input.instrumentSizing!.stopDistanceTicks!).times(input.instrumentSizing!.tickValue!)
        : new Decimal(input.instrumentSizing!.stopDistance!).times(input.instrumentSizing!.pipOrTickValue!).times(input.instrumentSizing!.conversionRate ?? 1);
      riskAmount = perUnitRisk.times(input.riskInputValue);
      positionSize = { kind: "computed", positionSize: new Decimal(input.riskInputValue), unit: account.marketCategory === "FUTURES" ? "CONTRACTS" : "LOTS" };
    } else {
      riskAmount = computePlannedRiskAmount(input.riskEntryMode, input.riskInputValue, currentBase);
      positionSize = sizePosition(account.marketCategory, riskAmount, input.instrumentSizing);
    }
  }

  const rules = stage.rules ?? [];
  const warnings = evaluateAllocationWarnings({
    accountStatus: account.status,
    stageStatus: stage.status,
    plannedRiskAmount: riskAmount,
    riskBase: currentBase,
    maxRiskPerTradeRule: ruleByKey(rules, "MAX_RISK_PER_TRADE"),
    combinedOpenRisk,
    maxRiskPerDayRule: ruleByKey(rules, "MAX_RISK_PER_DAY"),
    remainingDailyLossRoom: null,
    remainingDrawdownRoom: null,
    proposedPositionSize: positionSize.kind === "computed" ? positionSize.positionSize : null,
    maxLotOrContractRule: ruleByKey(rules, account.marketCategory === "FUTURES" ? "MAX_CONTRACT_SIZE" : "MAX_LOT_SIZE"),
  });
  const hardBlock = warnings.find((w) => w.severity === "hard_block");
  if (hardBlock) throw new Error(hardBlock.message);

  const resolvedPrices = resolvePlannedPrices(
    { plannedEntry: idea.plannedEntry?.toString() ?? null, plannedStopLoss: idea.plannedStopLoss?.toString() ?? null, plannedTarget: idea.plannedTarget?.toString() ?? null },
    {
      plannedEntryOverride: input.plannedEntryOverride ?? null,
      plannedStopLossOverride: input.plannedStopLossOverride ?? null,
      plannedTargetOverride: input.plannedTargetOverride ?? null,
    },
  );
  const plannedRResult = computePlannedR(idea.direction, resolvedPrices.entry, resolvedPrices.stopLoss, resolvedPrices.target);

  const netPnlFromGross = computeNetPnl(input.grossPnl ?? null, input.commission ?? null, input.swapFinancing ?? null, input.otherFees ?? null);
  let netPnl: Decimal | null = netPnlFromGross;
  let isPnlEstimated = false;
  let actualR: Decimal | null = null;
  if (netPnl != null) {
    actualR = computeActualR(netPnl, riskAmount);
  } else if (input.actualR != null) {
    const estimated = estimateNetPnlFromActualR(input.actualR, riskAmount);
    netPnl = estimated.netPnl;
    isPnlEstimated = true;
    actualR = new Decimal(input.actualR);
  }

  const status = input.status ?? existing?.status ?? "PLANNED";
  // Only a full CLOSED marks the participation as settled; PARTIALLY_CLOSED
  // can already carry a realized netPnl (the closed slice) while the
  // position is still open, so closedAt stays null until the whole thing is
  // done. CANCELLED/MISSED/NOT_TAKEN never touch either timestamp.
  const closedAt = status === "CLOSED" ? (existing?.closedAt ?? new Date()) : existing?.closedAt ?? null;
  const openedAt =
    status === "EXECUTED" || status === "PARTIALLY_CLOSED" || status === "CLOSED"
      ? (existing?.openedAt ?? new Date())
      : existing?.openedAt ?? null;

  // Spec §9: a closed (or partially closed) participation with no way to
  // know its result — no gross PnL entered and no actual R entered either —
  // is an inconsistent state, not a silently-zeroed one.
  if ((status === "CLOSED" || status === "PARTIALLY_CLOSED") && netPnl == null) {
    throw new Error("A closed execution needs either a gross PnL or an actual R to compute its realized result.");
  }

  const data = {
    userId,
    tradeId,
    propFirmAccountId: input.propFirmAccountId,
    accountStageId: stage.id,
    riskEntryMode: input.riskEntryMode,
    riskBasis: input.riskBasis,
    riskInputValue: input.riskInputValue,
    riskBaseSnapshot: riskBaseSnapshot.toString(),
    plannedRiskAmount: riskAmount.toString(),
    plannedPositionSize: positionSize.kind === "computed" ? positionSize.positionSize.toString() : null,
    positionSizeMissingReason: positionSize.kind === "insufficient_data" ? positionSize.explanation : null,
    plannedEntryOverride: input.plannedEntryOverride ?? null,
    plannedStopLossOverride: input.plannedStopLossOverride ?? null,
    plannedTargetOverride: input.plannedTargetOverride ?? null,
    plannedR: plannedRResult.plannedR?.toString() ?? null,
    actualEntry: input.actualEntry ?? null,
    actualExit: input.actualExit ?? null,
    actualLotSize: input.actualLotSize ?? null,
    actualContractQty: input.actualContractQty ?? null,
    grossPnl: input.grossPnl ?? null,
    commission: input.commission ?? null,
    swapFinancing: input.swapFinancing ?? null,
    otherFees: input.otherFees ?? null,
    netPnl: netPnl?.toString() ?? null,
    isPnlEstimated,
    actualR: actualR?.toString() ?? null,
    status,
    executionNotes: input.executionNotes ?? null,
    closedAt,
    openedAt,
  };

  const execution = existing
    ? await tx.tradeAccountExecution.update({ where: { id: existing.id }, data })
    : await tx.tradeAccountExecution.create({ data });

  // Post (or clear) the idempotent TRADE_PNL ledger entry to match this
  // execution's current resolved PnL — an edit that changes/removes PnL
  // updates the SAME ledger row via postLedgerEntry's idempotency, never
  // duplicating; an edit that removes PnL entirely (e.g. reopened) clears it.
  // Only CLOSED/PARTIALLY_CLOSED ever affect the account balance (spec §3) —
  // PLANNED/ALLOCATED/EXECUTED (still open, unrealized) and
  // CANCELLED/MISSED/NOT_TAKEN never do.
  if ((status === "CLOSED" || status === "PARTIALLY_CLOSED") && netPnl != null) {
    await postLedgerEntry(tx, {
      accountId: input.propFirmAccountId,
      stageId: stage.id,
      eventType: "TRADE_PNL",
      amount: netPnl,
      occurredAt: closedAt ?? new Date(),
      sourceType: "TRADE_EXECUTION",
      sourceId: execution.id,
    });
  } else {
    await removeLedgerEntriesForSource(tx, input.propFirmAccountId, "TRADE_EXECUTION", execution.id);
  }

  return execution;
}

export async function upsertExecution(userId: string, tradeId: string, input: UpsertExecutionInput) {
  return prisma.$transaction((tx) => upsertExecutionWithinTx(tx, userId, tradeId, input));
}

async function removeExecutionWithinTx(tx: TransactionClient, userId: string, tradeId: string, propFirmAccountId: string): Promise<void> {
  const execution = await tx.tradeAccountExecution.findFirst({
    where: { tradeId, propFirmAccountId, userId },
  });
  if (!execution) return;
  await removeLedgerEntriesForSource(tx, propFirmAccountId, "TRADE_EXECUTION", execution.id);
  await tx.tradeAccountExecution.update({ where: { id: execution.id }, data: { deletedAt: new Date() } });
}

export async function removeExecution(userId: string, tradeId: string, propFirmAccountId: string): Promise<void> {
  await prisma.$transaction((tx) => removeExecutionWithinTx(tx, userId, tradeId, propFirmAccountId));
}

/** Diffs `desiredAccountIds` against a trade's existing executions and
 *  removes whichever aren't present anymore — called by trades.service.ts's
 *  createTrade/updateTrade after upserting every entry in the new payload,
 *  inside the SAME transaction (so a trade save is atomic end to end). */
export async function syncExecutionsWithinTx(
  tx: TransactionClient,
  userId: string,
  tradeId: string,
  executions: UpsertExecutionInput[],
): Promise<void> {
  for (const execution of executions) {
    await upsertExecutionWithinTx(tx, userId, tradeId, execution);
  }
  const desiredAccountIds = new Set(executions.map((e) => e.propFirmAccountId));
  const existing = await tx.tradeAccountExecution.findMany({ where: { tradeId, userId }, select: { propFirmAccountId: true } });
  for (const row of existing) {
    if (!desiredAccountIds.has(row.propFirmAccountId)) {
      await removeExecutionWithinTx(tx, userId, tradeId, row.propFirmAccountId);
    }
  }
}

export async function listExecutionsForTrade(userId: string, tradeId: string) {
  return prisma.tradeAccountExecution.findMany({
    where: { tradeId, userId },
    include: {
      propFirmAccount: { include: { userPropFirm: { include: { directoryEntry: true } } } },
      accountStage: true,
      trade: { select: { id: true, tradeDate: true, assetSymbol: true, direction: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Bulk variant for surfaces showing several trades at once (e.g. Today) —
 *  one query instead of N, grouped by tradeId for the caller. */
export async function listExecutionsForTrades(userId: string, tradeIds: string[]) {
  if (tradeIds.length === 0) return [];
  return prisma.tradeAccountExecution.findMany({
    where: { tradeId: { in: tradeIds }, userId },
    include: {
      propFirmAccount: { include: { userPropFirm: { include: { directoryEntry: true } } } },
      accountStage: true,
      trade: { select: { id: true, tradeDate: true, assetSymbol: true, direction: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Account Trade Track Record (spec §6) — every execution for this account,
 *  enriched with the shared idea's strategy/entry-model (for filtering/
 *  display) and the ledger-derived balance before/after this execution's own
 *  TRADE_PNL event (when it has one). Balance before/after is only knowable
 *  from the ledger — TradeAccountExecution itself only snapshots the RISK
 *  base, not the full account balance — so it's computed here rather than
 *  stored redundantly. */
export async function listExecutionsForAccount(userId: string, propFirmAccountId: string) {
  const owned = await prisma.propFirmAccount.findFirst({ where: { id: propFirmAccountId, userId }, select: { id: true } });
  if (!owned) throw new Error("Account not found.");
  const executions = await prisma.tradeAccountExecution.findMany({
    where: { propFirmAccountId },
    include: {
      trade: { select: { id: true, tradeDate: true, assetSymbol: true, direction: true, strategyNameSnapshot: true, selectedEntryModel: true } },
      accountStage: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const ledgerEntries = await prisma.accountLedgerEntry.findMany({
    where: { accountId: propFirmAccountId, sourceType: "TRADE_EXECUTION", eventType: "TRADE_PNL", sourceId: { in: executions.map((e) => e.id) } },
    select: { sourceId: true, amount: true, balanceAfter: true },
  });
  const ledgerBySourceId = new Map(ledgerEntries.map((e) => [e.sourceId as string, e]));

  return executions.map((execution) => {
    const entry = ledgerBySourceId.get(execution.id);
    const balanceAfter = entry ? new Decimal(entry.balanceAfter.toString()) : null;
    const balanceBefore = entry ? balanceAfter!.minus(entry.amount.toString()) : null;
    return { ...execution, balanceBefore, balanceAfter };
  });
}
