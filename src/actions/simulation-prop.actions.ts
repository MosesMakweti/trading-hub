"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { requireUser } from "@/server/guards";
import { accountRefSchema, purchaseChallengeSchema } from "@/lib/validation/simulation";
import { SimError, SimNotFoundError } from "@/server/services/simulation/sim-account.service";
import * as prop from "@/server/services/simulation/sim-prop.service";

type Fail = { success: false; error: string };
type Ok<T> = { success: true } & T;

function fail(error: unknown, fallback: string): Fail {
  if (error instanceof SimError || error instanceof SimNotFoundError) return { success: false, error: error.message };
  if (error instanceof ZodError) return { success: false, error: error.issues[0]?.message ?? "Invalid model." };
  console.error("[simulation-prop.actions]", error);
  return { success: false, error: fallback };
}
const invalid = (e: { issues: { message: string }[] }): Fail => ({ success: false, error: e.issues[0]?.message ?? "Invalid input." });

export async function purchaseChallengeAction(input: unknown): Promise<Ok<{ accountId: string; challengeId: string }> | Fail> {
  const user = await requireUser();
  const parsed = purchaseChallengeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const { challenge, account } = await prop.purchaseChallenge(user.id, parsed.data);
    revalidatePath("/backtesting/prop");
    return { success: true, accountId: account.id, challengeId: challenge.id };
  } catch (e) {
    return fail(e, "Couldn't start the challenge.");
  }
}

/** Custom firm model; the definition is validated by the domain schema (firmModelSchema). */
export async function createFirmModelAction(input: unknown): Promise<Ok<{ id: string }> | Fail> {
  const user = await requireUser();
  try {
    const model = await prop.createFirmModel(user.id, input as Parameters<typeof prop.createFirmModel>[1]);
    revalidatePath("/backtesting/prop/new");
    return { success: true, id: model.id };
  } catch (e) {
    return fail(e, "Couldn't save the model.");
  }
}

export async function getPropAccountStatusAction(input: unknown): Promise<Ok<{ status: prop.PropAccountStatusDTO }> | Fail> {
  const user = await requireUser();
  const parsed = accountRefSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return { success: true, status: await prop.getPropAccountStatus(user.id, parsed.data.accountId) };
  } catch (e) {
    return fail(e, "Couldn't load the account rules.");
  }
}

export async function requestPayoutAction(input: unknown): Promise<Ok<{ traderShare: string }> | Fail> {
  const user = await requireUser();
  const parsed = accountRefSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const payout = await prop.requestPayout(user.id, parsed.data.accountId);
    revalidatePath("/backtesting/prop");
    return { success: true, traderShare: payout.traderShare.toFixed(2) };
  } catch (e) {
    return fail(e, "Couldn't process the payout.");
  }
}
