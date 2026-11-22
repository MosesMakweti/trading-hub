"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import type { ReplayTimeframe } from "@/domain/native-replay/timeframes";
import {
  advanceSchema,
  accountRefSchema,
  cancelOrderSchema,
  candlesSchema,
  closePositionSchema,
  createLabAccountSchema,
  labStatusSchema,
  modifyPositionSchema,
  orderSchema,
} from "@/lib/validation/simulation";
import { CandleRangeTooLargeError } from "@/server/services/native-replay/historical-candles.service";
import * as accounts from "@/server/services/simulation/sim-account.service";
import { advanceSimClock, type AdvanceOutcome } from "@/server/services/simulation/sim-clock.service";
import * as execution from "@/server/services/simulation/sim-execution.service";
import { getSimAccountState, getSimCandles } from "@/server/services/simulation/sim-state.service";
import type { ClockCommand } from "@/server/services/simulation/sim-market";
import type { SimAccountStateDTO } from "@/types/simulation";

type Fail = { success: false; error: string };
type Ok<T> = { success: true } & T;

/** Errors written for the trader pass through verbatim; anything else is logged and hidden. */
function fail(error: unknown, fallback: string): Fail {
  if (error instanceof accounts.SimError || error instanceof accounts.SimNotFoundError || error instanceof CandleRangeTooLargeError) {
    return { success: false, error: error.message };
  }
  console.error("[simulation.actions]", error);
  return { success: false, error: fallback };
}

const invalid = (e: { issues: { message: string }[] }): Fail => ({ success: false, error: e.issues[0]?.message ?? "Invalid input." });

function revalidateAccount(accountId: string) {
  revalidatePath("/backtesting");
  revalidatePath(`/backtesting/accounts/${accountId}`, "layout");
}

export async function createLabAccountAction(input: unknown): Promise<Ok<{ id: string }> | Fail> {
  const user = await requireUser();
  const parsed = createLabAccountSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  try {
    const account = await accounts.createLabAccount(user.id, {
      name: v.name,
      description: v.description,
      strategyId: v.strategyId,
      datasets: v.datasets,
      periodStart: v.periodStart,
      periodEnd: v.periodEnd,
      startingBalance: v.startingBalance,
      currency: v.currency,
      costs: { commissionPerUnitPerSide: v.commissionPerUnitPerSide, defaultSpreadPoints: v.defaultSpreadPoints },
      dailyResetHour: v.dailyResetHour,
    });
    revalidatePath("/backtesting");
    return { success: true, id: account.id };
  } catch (e) {
    return fail(e, "Couldn't create the account.");
  }
}

export async function startSimClockAction(input: unknown): Promise<Ok<{ state: SimAccountStateDTO }> | Fail> {
  const user = await requireUser();
  const parsed = accountRefSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await accounts.startSimClock(user.id, parsed.data.accountId);
    revalidateAccount(parsed.data.accountId);
    return { success: true, state: await getSimAccountState(user.id, parsed.data.accountId) };
  } catch (e) {
    return fail(e, "Couldn't start the replay.");
  }
}

export async function getSimAccountStateAction(input: unknown): Promise<Ok<{ state: SimAccountStateDTO }> | Fail> {
  const user = await requireUser();
  const parsed = accountRefSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return { success: true, state: await getSimAccountState(user.id, parsed.data.accountId) };
  } catch (e) {
    return fail(e, "Couldn't load the account.");
  }
}

export async function advanceSimClockAction(input: unknown): Promise<Ok<{ outcome: AdvanceOutcome; state: SimAccountStateDTO }> | Fail> {
  const user = await requireUser();
  const parsed = advanceSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const outcome = await advanceSimClock(user.id, parsed.data.accountId, parsed.data.command as ClockCommand, parsed.data.commandId);
    return { success: true, outcome, state: await getSimAccountState(user.id, parsed.data.accountId) };
  } catch (e) {
    return fail(e, "Couldn't move the replay.");
  }
}

export async function getSimCandlesAction(input: unknown) {
  const user = await requireUser();
  const parsed = candlesSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const { accountId, ...query } = parsed.data;
    const candles = await getSimCandles(user.id, accountId, { ...query, timeframe: query.timeframe as ReplayTimeframe });
    return { success: true as const, candles };
  } catch (e) {
    return fail(e, "Couldn't load candles.");
  }
}

export async function placeSimOrderAction(input: unknown): Promise<Ok<{ outcome: execution.OrderOutcome; state: SimAccountStateDTO }> | Fail> {
  const user = await requireUser();
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { accountId, ...order } = parsed.data;
  try {
    const outcome = await execution.placeOrder(user.id, accountId, order);
    return { success: true, outcome, state: await getSimAccountState(user.id, accountId) };
  } catch (e) {
    return fail(e, "Couldn't place the order.");
  }
}

export async function closeSimPositionAction(input: unknown): Promise<Ok<{ state: SimAccountStateDTO }> | Fail> {
  const user = await requireUser();
  const parsed = closePositionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { accountId, positionId, ...rest } = parsed.data;
  try {
    await execution.closePosition(user.id, accountId, positionId, rest);
    return { success: true, state: await getSimAccountState(user.id, accountId) };
  } catch (e) {
    return fail(e, "Couldn't close the position.");
  }
}

export async function modifySimPositionAction(input: unknown): Promise<Ok<{ state: SimAccountStateDTO }> | Fail> {
  const user = await requireUser();
  const parsed = modifyPositionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { accountId, positionId, ...rest } = parsed.data;
  try {
    await execution.modifyPosition(user.id, accountId, positionId, rest);
    return { success: true, state: await getSimAccountState(user.id, accountId) };
  } catch (e) {
    return fail(e, "Couldn't update the position.");
  }
}

export async function cancelSimOrderAction(input: unknown): Promise<Ok<{ state: SimAccountStateDTO }> | Fail> {
  const user = await requireUser();
  const parsed = cancelOrderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await execution.cancelOrder(user.id, parsed.data.accountId, parsed.data.orderId);
    return { success: true, state: await getSimAccountState(user.id, parsed.data.accountId) };
  } catch (e) {
    return fail(e, "Couldn't cancel the order.");
  }
}

export async function setLabAccountStatusAction(input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const parsed = labStatusSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await accounts.setLabAccountStatus(user.id, parsed.data.accountId, parsed.data.status);
    revalidateAccount(parsed.data.accountId);
    return { success: true };
  } catch (e) {
    return fail(e, "Couldn't update the account.");
  }
}

export async function deleteSimAccountAction(input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const parsed = accountRefSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await accounts.deleteSimAccount(user.id, parsed.data.accountId);
    revalidatePath("/backtesting");
    return { success: true };
  } catch (e) {
    return fail(e, "Couldn't delete the account.");
  }
}
