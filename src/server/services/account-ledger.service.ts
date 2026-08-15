import { Decimal } from "decimal.js";
import { Prisma } from "@prisma/client";
import type { LedgerEventType, LedgerSourceType } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";

const REASON_REQUIRED_EVENT_TYPES: LedgerEventType[] = ["MANUAL_ADJUSTMENT", "CUSTOM_ADJUSTMENT"];

export interface PostLedgerEntryInput {
  accountId: string;
  stageId?: string | null;
  eventType: LedgerEventType;
  /** Signed — positive increases the account's ledger-derived balance, negative decreases it. */
  amount: Decimal.Value;
  occurredAt?: Date;
  reason?: string | null;
  /** Omit both for a plain, never-deduped insert (manual/custom adjustments). Provide
   *  both to make this post idempotent: a repeat call with the same (sourceType,
   *  sourceId, eventType) updates the SAME row instead of creating a duplicate — the
   *  mechanism that prevents double-posting a trade's PnL on edit/import/resync. */
  sourceType?: LedgerSourceType | null;
  sourceId?: string | null;
}

/** Recomputes every entry's `balanceAfter` for an account in chronological
 *  (occurredAt, then createdAt as a tiebreak) order, inside the same
 *  transaction as the write that triggered it. Correctness over
 *  micro-perf — account ledgers are small, and this is the only way a
 *  backdated entry or an edited historical entry's amount stays consistent
 *  for every entry after it. */
async function recomputeRunningBalances(tx: TransactionClient, accountId: string): Promise<void> {
  const entries = await tx.accountLedgerEntry.findMany({
    where: { accountId },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, amount: true, balanceAfter: true },
  });

  let running = new Decimal(0);
  for (const entry of entries) {
    running = running.plus(entry.amount.toString());
    if (!running.equals(entry.balanceAfter.toString())) {
      await tx.accountLedgerEntry.update({ where: { id: entry.id }, data: { balanceAfter: running.toString() } });
    }
  }
}

/** Posts one ledger entry inside the caller's transaction (so it composes
 *  with advanceAccountStage/createPropFirmAccount/updatePayout/
 *  upsertExecution's own transactions). Idempotent when sourceType+sourceId
 *  are given: an existing row for that (sourceType, sourceId, eventType) is
 *  updated in place rather than duplicated. */
export async function postLedgerEntry(
  tx: TransactionClient,
  input: PostLedgerEntryInput,
): Promise<Prisma.AccountLedgerEntryGetPayload<Record<string, never>>> {
  if (REASON_REQUIRED_EVENT_TYPES.includes(input.eventType) && !input.reason) {
    throw new Error(`A reason is required for a ${input.eventType} ledger entry.`);
  }

  const amount = new Decimal(input.amount).toString();
  const occurredAt = input.occurredAt ?? new Date();

  let entryId: string;
  if (input.sourceType && input.sourceId) {
    const existing = await tx.accountLedgerEntry.findUnique({
      where: {
        sourceType_sourceId_eventType: {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          eventType: input.eventType,
        },
      },
      select: { id: true },
    });
    if (existing) {
      const updated = await tx.accountLedgerEntry.update({
        where: { id: existing.id },
        data: { amount, occurredAt, reason: input.reason ?? null, stageId: input.stageId ?? null },
      });
      entryId = updated.id;
    } else {
      const created = await tx.accountLedgerEntry.create({
        data: {
          accountId: input.accountId,
          stageId: input.stageId ?? null,
          eventType: input.eventType,
          amount,
          balanceAfter: amount, // placeholder — recomputeRunningBalances fixes this below
          occurredAt,
          reason: input.reason ?? null,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      });
      entryId = created.id;
    }
  } else {
    const created = await tx.accountLedgerEntry.create({
      data: {
        accountId: input.accountId,
        stageId: input.stageId ?? null,
        eventType: input.eventType,
        amount,
        balanceAfter: amount, // placeholder — recomputeRunningBalances fixes this below
        occurredAt,
        reason: input.reason ?? null,
        sourceType: null,
        sourceId: null,
      },
    });
    entryId = created.id;
  }

  await recomputeRunningBalances(tx, input.accountId);
  return tx.accountLedgerEntry.findUniqueOrThrow({ where: { id: entryId } });
}

/** Removes the ledger entry(ies) tied to a source (e.g. a deleted execution's
 *  TRADE_PNL entry) and recomputes the running balance — the ledger-side half
 *  of "editing/deleting an allocation safely". */
export async function removeLedgerEntriesForSource(
  tx: TransactionClient,
  accountId: string,
  sourceType: LedgerSourceType,
  sourceId: string,
): Promise<void> {
  await tx.accountLedgerEntry.deleteMany({ where: { accountId, sourceType, sourceId } });
  await recomputeRunningBalances(tx, accountId);
}

export async function getAccountLedger(userId: string, accountId: string) {
  const owned = await prisma.propFirmAccount.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  if (!owned) throw new Error("Account not found.");
  return prisma.accountLedgerEntry.findMany({
    where: { accountId },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
  });
}

/** The account's balance as of its most recent ledger entry — null when the
 *  account has no ledger history yet (never a fabricated 0). */
export async function getLedgerDerivedBalance(userId: string, accountId: string): Promise<Decimal | null> {
  const owned = await prisma.propFirmAccount.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  if (!owned) throw new Error("Account not found.");
  const latest = await prisma.accountLedgerEntry.findFirst({
    where: { accountId },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    select: { balanceAfter: true },
  });
  return latest ? new Decimal(latest.balanceAfter.toString()) : null;
}

/** Bulk variant for list/rollup surfaces (market overview, company
 *  workspace, portfolio) that render many accounts at once — one query
 *  instead of N. Ownership isn't re-checked here (callers already scope
 *  `accountIds` to the caller's own accounts via their existing query). */
export async function getLedgerDerivedBalances(accountIds: string[]): Promise<Map<string, Decimal>> {
  if (accountIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ accountId: string; balanceAfter: unknown }[]>`
    SELECT DISTINCT ON ("accountId") "accountId", "balanceAfter"
    FROM "AccountLedgerEntry"
    WHERE "accountId" = ANY(${accountIds})
    ORDER BY "accountId", "occurredAt" DESC, "createdAt" DESC
  `;
  return new Map(rows.map((r) => [r.accountId, new Decimal(r.balanceAfter as string)]));
}

export interface CreateManualAdjustmentInput {
  amount: number;
  reason: string;
  eventType: Extract<LedgerEventType, "MANUAL_ADJUSTMENT" | "CUSTOM_ADJUSTMENT">;
  stageId?: string | null;
  occurredAt?: Date;
}

/** Manual/custom adjustments are always plain inserts (never deduped against
 *  each other via a source key) — every one is a distinct trader action that
 *  must stay visible in history, per spec §5. */
export async function createManualAdjustment(userId: string, accountId: string, input: CreateManualAdjustmentInput) {
  const owned = await prisma.propFirmAccount.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  if (!owned) throw new Error("Account not found.");
  if (!input.reason.trim()) throw new Error("A reason is required for a manual balance adjustment.");

  return prisma.$transaction((tx) =>
    postLedgerEntry(tx, {
      accountId,
      stageId: input.stageId ?? null,
      eventType: input.eventType,
      amount: input.amount,
      occurredAt: input.occurredAt,
      reason: input.reason,
    }),
  );
}
