/**
 * The one write path for simulation money. Called inside a transaction that
 * already holds the account's row lock (lockAccount): entries are planned
 * from the account's last sequence and running balance, inserted in order
 * (the DB trigger re-checks each running balance), and the account's
 * sequence pointer moves with them. Idempotency keys are unique per account,
 * so a replayed settlement fails loudly instead of booking twice.
 */
import type { Decimal } from "decimal.js";

import type { TransactionClient } from "@/server/db";
import { dec } from "@/domain/execution/precision";
import { planLedgerEntries, replaySimLedger, type SimLedgerType } from "@/domain/simulation/ledger";

export interface LedgerAppend {
  type: SimLedgerType;
  amount: Decimal;
  idempotencyKey: string;
  positionId?: string | null;
  minute?: number | null;
  note?: string | null;
}

export async function currentBalance(tx: TransactionClient, accountId: string, sequence: number): Promise<Decimal> {
  const last = await tx.simLedgerEntry.findUnique({ where: { accountId_sequence: { accountId, sequence } }, select: { balanceAfter: true } });
  if (!last) throw new Error(`LEDGER_CORRUPT: account ${accountId} has no ledger entry ${sequence}`);
  return dec(last.balanceAfter.toString());
}

/** Appends entries; returns the new balance and sequence. Zero amounts are skipped. */
export async function appendLedger(
  tx: TransactionClient,
  account: { id: string; userId: string; ledgerSequence: number },
  entries: LedgerAppend[],
): Promise<{ balance: Decimal; sequence: number }> {
  const balance = await currentBalance(tx, account.id, account.ledgerSequence);
  const byKey = new Map(entries.map((e) => [e.idempotencyKey, e]));
  const planned = planLedgerEntries({ balance, sequence: account.ledgerSequence }, entries);
  if (planned.length === 0) return { balance, sequence: account.ledgerSequence };
  await tx.simLedgerEntry.createMany({
    data: planned.map((p) => {
      const src = byKey.get(p.idempotencyKey)!;
      return {
        userId: account.userId,
        accountId: account.id,
        sequence: p.sequence,
        type: p.type,
        amount: p.amount.toFixed(2),
        balanceAfter: p.balanceAfter.toFixed(2),
        idempotencyKey: p.idempotencyKey,
        positionId: src.positionId ?? null,
        minute: src.minute ?? null,
        note: src.note ?? null,
      };
    }),
  });
  const last = planned[planned.length - 1];
  await tx.simAccount.update({ where: { id: account.id }, data: { ledgerSequence: last.sequence } });
  account.ledgerSequence = last.sequence;
  return { balance: last.balanceAfter, sequence: last.sequence };
}

/** Full verification of an account's ledger (read path / tests). */
export async function verifyLedger(tx: TransactionClient, accountId: string) {
  const rows = await tx.simLedgerEntry.findMany({ where: { accountId }, orderBy: { sequence: "asc" }, select: { sequence: true, type: true, amount: true, balanceAfter: true } });
  return replaySimLedger(rows.map((r) => ({ sequence: r.sequence, type: r.type, amount: r.amount.toString(), balanceAfter: r.balanceAfter.toString() })));
}
