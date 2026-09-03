import { Decimal } from "decimal.js";

export interface PayoutSplit {
  /** What the trader actually receives after the profit split. */
  traderPayout: string;
  /** The prop firm's cut. `traderPayout + propFirmShare === grossPayout` exactly. */
  propFirmShare: string;
}

/**
 * The single source of truth for splitting a payout. Applied **per payout**,
 * never to a combined total — an account's profit split can change between
 * withdrawals, and each `Payout` row carries its own immutable
 * `profitSplitPercent` snapshot.
 *
 *   traderPayout  = grossPayout × (profitSplitPercent / 100)
 *   propFirmShare = grossPayout − traderPayout
 *
 * `grossWithdrawal` is the gross amount from the statement, treated as
 * pre-split (absolute value — sign-insensitive). Currency-safe decimal
 * arithmetic; final amounts rounded to 2dp (HALF_UP), with the rounding
 * remainder folded into `propFirmShare` so the two always sum exactly to the
 * gross.
 *
 *   $220.58 × 80% = $176.464 → $176.46   (trader)
 *   $220.58 − $176.46        = $44.12    (prop firm)
 */
export function computePayoutSplit(grossWithdrawal: Decimal.Value, profitSplitPercent: Decimal.Value): PayoutSplit {
  const gross = new Decimal(grossWithdrawal).abs();
  const percent = new Decimal(profitSplitPercent);
  const traderPayout = gross.times(percent).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const propFirmShare = gross.minus(traderPayout);
  return { traderPayout: traderPayout.toString(), propFirmShare: propFirmShare.toString() };
}

/** Round a currency value to 2dp (HALF_UP) as a plain number — for display
 *  totals derived from already-persisted, already-rounded snapshots. */
export function roundCurrency(value: Decimal.Value): number {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * The amount a persisted payout represents for the trader, derived only from
 * that row's own immutable snapshot — `netReceived` when it was recorded,
 * else `gross × pct` from the snapshotted percent, else (no percent snapshot)
 * the gross itself. Never consults the account's current profit-split rule, so
 * changing the rule later can't retro-alter an old payout.
 */
export function traderReceivedFromSnapshot(input: {
  grossPayout: Decimal.Value;
  profitSplitPercent: Decimal.Value | null;
  netReceived: Decimal.Value | null;
}): number {
  if (input.netReceived != null) return roundCurrency(input.netReceived);
  if (input.profitSplitPercent != null) {
    return roundCurrency(computePayoutSplit(input.grossPayout, input.profitSplitPercent).traderPayout);
  }
  return roundCurrency(input.grossPayout);
}

/** The prop firm's share of a persisted payout, from its own snapshot. Null
 *  when no percent was ever snapshotted (an unsplit payout — the trader got
 *  the gross, there is no firm share to report). */
export function propFirmShareFromSnapshot(input: {
  grossPayout: Decimal.Value;
  profitSplitPercent: Decimal.Value | null;
  netReceived: Decimal.Value | null;
}): number | null {
  if (input.profitSplitPercent == null) return null;
  const trader = traderReceivedFromSnapshot(input);
  return roundCurrency(new Decimal(input.grossPayout).abs().minus(trader));
}
