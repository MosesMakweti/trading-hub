"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { requireUser } from "@/server/guards";
import { assetSchema, reorderSchema } from "@/lib/validation/trading-plan";
import * as assetsService from "@/server/services/assets.service";

type ActionResult = { success: true } | { success: false; error: string };

export async function createAsset(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = assetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await assetsService.createAsset(user.id, parsed.data);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, error: "That asset is already on your watchlist." };
    }
    throw error;
  }

  revalidatePath("/settings/plan");
  return { success: true };
}

export async function updateAsset(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = assetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await assetsService.updateAsset(user.id, id, parsed.data);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, error: "That asset is already on your watchlist." };
    }
    throw error;
  }

  revalidatePath("/settings/plan");
  return { success: true };
}

export async function archiveAsset(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await assetsService.archiveAsset(user.id, id);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function reorderAssets(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  await assetsService.reorderAssets(user.id, parsed.data.orderedIds);
  revalidatePath("/settings/plan");
  return { success: true };
}
