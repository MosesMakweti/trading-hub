/**
 * Simulation account ledger — the only source of an account's balance.
 *
 * Append-only: every money event is one entry with a signed amount and the
 * running `balanceAfter` written at insert time. The balance is ALWAYS the
 * sum of amounts; `balanceAfter` is an assertion that `replaySimLedger`
 * re-checks, so a drift (a lost or duplicated write) is detected, never
 * silently displayed. Nothing ever overwrites a balance — a payout, for
 * example, is a negative PAYOUT_WITHDRAWAL entry, not a reset.
 */
import type { Decimal } from "decimal.js";

import { dec, ZERO, type DecimalInput } from "@/domain/execution/precision";

export const SIM_LEDGER_TYPES = [
  "INITIAL_BALANCE",
  "REALIZED_PNL",
  "COMMISSION",
  "SWAP",
  "PAYOUT_WITHDRAWAL",
  "ADJUSTMENT",
] as const;
export type SimLedgerType = (typeof SIM_LEDGER_TYPES)[number];

export interface SimLedgerRow {
  sequence: number;
  type: SimLedgerType;
  amount: DecimalInput;
  balanceAfter: DecimalInput;
}

export class SimLedgerCorruptError extends Error {
  constructor(message: string) {
    super(`LEDGER_CORRUPT: ${message}`);
    this.name = "SimLedgerCorruptError";
  }
}

export interface SimLedgerSummary {
  balance: Decimal;
  initialBalance: Decimal;
  realizedPnl: Decimal;
  commissions: Decimal;
  swaps: Decimal;
  withdrawals: Decimal;
  adjustments: Decimal;
  entries: number;
}

/** Replays entries in sequence order, verifying every stored running balance. */
export function replaySimLedger(rows: SimLedgerRow[]): SimLedgerSummary {
  const sorted = [...rows].sort((a, b) => a.sequence - b.sequence);
  const s = { balance: ZERO, initialBalance: ZERO, realizedPnl: ZERO, commissions: ZERO, swaps: ZERO, withdrawals: ZERO, adjustments: ZERO };
  sorted.forEach((row, i) => {
    if (row.sequence !== i + 1) throw new SimLedgerCorruptError(`expected sequence ${i + 1}, found ${row.sequence}`);
    const amount = dec(row.amount);
    s.balance = s.balance.plus(amount);
    if (!s.balance.equals(dec(row.balanceAfter))) {
      throw new SimLedgerCorruptError(`entry ${row.sequence}: running balance ${s.balance.toFixed()} ≠ stored ${dec(row.balanceAfter).toFixed()}`);
    }
    switch (row.type) {
      case "INITIAL_BALANCE":
        s.initialBalance = s.initialBalance.plus(amount);
        break;
      case "REALIZED_PNL":
        s.realizedPnl = s.realizedPnl.plus(amount);
        break;
      case "COMMISSION":
        s.commissions = s.commissions.plus(amount);
        break;
      case "SWAP":
        s.swaps = s.swaps.plus(amount);
        break;
      case "PAYOUT_WITHDRAWAL":
        s.withdrawals = s.withdrawals.plus(amount);
        break;
      case "ADJUSTMENT":
        s.adjustments = s.adjustments.plus(amount);
        break;
    }
  });
  if (sorted.length > 0 && sorted[0].type !== "INITIAL_BALANCE") throw new SimLedgerCorruptError("the first entry must be INITIAL_BALANCE");
  return { ...s, entries: sorted.length };
}

/** Plans the next entries to append after `current` (the latest stored balance and sequence). */
export function planLedgerEntries(
  current: { balance: DecimalInput; sequence: number },
  entries: { type: SimLedgerType; amount: DecimalInput; idempotencyKey: string }[],
): { sequence: number; type: SimLedgerType; amount: Decimal; balanceAfter: Decimal; idempotencyKey: string }[] {
  let balance = dec(current.balance);
  let sequence = current.sequence;
  return entries
    .filter((e) => !dec(e.amount).isZero() || e.type === "INITIAL_BALANCE")
    .map((e) => {
      const amount = dec(e.amount);
      balance = balance.plus(amount);
      sequence += 1;
      return { sequence, type: e.type, amount, balanceAfter: balance, idempotencyKey: e.idempotencyKey };
    });
}
