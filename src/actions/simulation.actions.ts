"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

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
  reviewTargetSchema,
} from "@/lib/validation/simulation";
import { CandleRangeTooLargeError } from "@/server/services/native-replay/historical-candles.service";
import * as accounts from "@/server/services/simulation/sim-account.service";
import { advanceSimClock, type AdvanceOutcome } from "@/server/services/simulation/sim-clock.service";
import * as execution from "@/server/services/simulation/sim-execution.service";
import * as drawingsSvc from "@/server/services/charting/sim-drawing.service";
import type { ChartDrawing } from "@/domain/native-replay/drawings/model";
import { getRevealedBars, getSimAccountState, getSimCandles, getSimStepPatch } from "@/server/services/simulation/sim-state.service";
import { accountFeedsCached, periodMinutes, reviewTarget } from "@/server/services/simulation/sim-market";
import { prefetchAfter } from "@/server/services/market-data/bar-cache";
import { prisma } from "@/server/db";
import type { ClockCommand } from "@/server/services/simulation/sim-market";
import type { SimAccountStateDTO, SimRevealedDTO, SimStepPatchDTO } from "@/types/simulation";

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

export type StepOutcome = Omit<AdvanceOutcome, "snapshot">;

/**
 * One replay step, one round trip. Returns either a small patch (the step
 * changed no trading state — the common case) or the full account state,
 * plus the M1 bars the step revealed for the instruments on screen so the
 * charts update incrementally instead of re-reading their history.
 */
export async function advanceSimClockAction(
  input: unknown,
): Promise<Ok<{ outcome: StepOutcome; state?: SimAccountStateDTO; patch?: SimStepPatchDTO; revealed: SimRevealedDTO[]; serverMs: number }> | Fail> {
  const t0 = performance.now();
  const user = await requireUser();
  const parsed = advanceSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { accountId, command, commandId, views } = parsed.data;
  try {
    const { snapshot, ...outcome } = await advanceSimClock(user.id, accountId, command as ClockCommand, commandId);
    const [stateOrPatch, revealed] = await Promise.all([
      snapshot ? getSimStepPatch(snapshot).then((patch) => ({ patch })) : getSimAccountState(user.id, accountId).then((state) => ({ state })),
      outcome.moved && views?.length && snapshot
        ? getRevealedBars(snapshot.feeds, views, outcome.fromMinute, outcome.toMinute)
        : outcome.moved && views?.length
          ? accountFeedsCached(prisma, accountId).then((feeds) => getRevealedBars(feeds, views, outcome.fromMinute, outcome.toMinute))
          : Promise.resolve([] as SimRevealedDTO[]),
    ]);
    if (outcome.moved) {
      // Preload the next days into the server's private buffer after replying.
      after(async () => prefetchAfter((await accountFeedsCached(prisma, accountId)).map((f) => f.seq), outcome.toMinute + 1));
    }
    return { success: true, outcome, ...stateOrPatch, revealed, serverMs: Math.round(performance.now() - t0) };
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

export async function placeSimOrderAction(input: unknown): Promise<Ok<{ outcome: execution.OrderOutcome; state: SimAccountStateDTO; drawing: ChartDrawing | null; warning: string | null }> | Fail> {
  const user = await requireUser();
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { accountId, drawingId, ...order } = parsed.data;
  try {
    // A drafted order is still just an order: every level and the size are
    // validated by placeOrder exactly as if typed. The drawing is checked
    // first so a wrong link never produces an order.
    if (drawingId) await drawingsSvc.requireOrderDrawing(user.id, accountId, order.symbol.trim().toUpperCase(), drawingId, order.side);
    const outcome = await execution.placeOrder(user.id, accountId, order);
    let drawing: ChartDrawing | null = null;
    let warning: string | null = null;
    if (drawingId && !outcome.duplicate) {
      const st0 = await getSimAccountState(user.id, accountId);
      try {
        drawing = await drawingsSvc.linkDrawingToOrder(user.id, accountId, drawingId, { orderId: outcome.orderId, positionId: outcome.positionId, side: order.side, status: outcome.status, minute: st0.clock?.minute ?? 0 });
      } catch {
        warning = "The order was placed, but the drawing couldn't be marked as executed.";
      }
      return { success: true, outcome, state: st0, drawing, warning };
    }
    return { success: true, outcome, state: await getSimAccountState(user.id, accountId), drawing, warning };
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

/**
 * Review navigation: where one step back/forward (or a seek) lands within
 * what the account has already revealed. Read-only — never moves the clock,
 * never returns a minute after it.
 */
export async function reviewTargetAction(input: unknown): Promise<Ok<{ minute: number | null; clock: number }> | Fail> {
  const user = await requireUser();
  const parsed = reviewTargetSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const account = await accounts.requireSimAccount(user.id, parsed.data.accountId);
    if (account.currentMinute == null) return { success: false, error: "Start the replay first." };
    const feeds = await accountFeedsCached(prisma, account.id);
    const period = periodMinutes(account);
    const move = parsed.data.move as Parameters<typeof reviewTarget>[4];
    const minute = await reviewTarget(feeds, parsed.data.from, account.currentMinute, period.from, move);
    return { success: true, minute, clock: account.currentMinute };
  } catch (e) {
    return fail(e, "Couldn't move the review position.");
  }
}
