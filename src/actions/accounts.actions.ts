"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { brokerageAccountSchema, propFirmAccountSchema } from "@/lib/validation/accounts";
import * as accountsService from "@/server/services/accounts.service";

type ActionResult = { success: true } | { success: false; error: string };

export async function createPropFirmAccount(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = propFirmAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await accountsService.createPropFirmAccount(user.id, parsed.data);
  revalidatePath("/accounts");
  return { success: true };
}

export async function updatePropFirmAccount(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = propFirmAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await accountsService.updatePropFirmAccount(user.id, id, parsed.data);
  revalidatePath("/accounts");
  return { success: true };
}

export async function createBrokerageAccount(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = brokerageAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await accountsService.createBrokerageAccount(user.id, parsed.data);
  revalidatePath("/accounts");
  return { success: true };
}

export async function updateBrokerageAccount(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = brokerageAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await accountsService.updateBrokerageAccount(user.id, id, parsed.data);
  revalidatePath("/accounts");
  return { success: true };
}

export async function archiveTradingAccount(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await accountsService.archiveTradingAccount(user.id, id);
  revalidatePath("/accounts");
  return { success: true };
}
