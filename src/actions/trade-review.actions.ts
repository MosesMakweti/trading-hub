"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { setReviewLifecycleStatusSchema } from "@/lib/validation/trade-review";
import { partialExitUpsertSchema } from "@/lib/validation/trade-plan";
import * as reviewService from "@/server/services/trade-review.service";
import * as partialExitService from "@/server/services/trade-partial-exit.service";
import type { TradeReviewDataDTO } from "@/server/services/trade-review.service";

type Result = { success: true } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function revalidateTrade(dateKey: string, tradeId: string) {
  revalidatePath(`/journal/${dateKey}/trades/${tradeId}`);
  revalidatePath(`/journal/${dateKey}`);
}

// Partial-exit upsert/delete both re-settle the Performance Account
// (trade-partial-exit.service.ts calls settlePerformanceTrade) — its display
// surfaces need to refresh too, not just the journal.
function revalidatePerformanceSurfaces() {
  revalidatePath("/dashboard");
  revalidatePath("/accounts");
}

export async function loadTradeReviewDataAction(
  tradeId: string,
): Promise<{ success: true; data: TradeReviewDataDTO } | { success: false; error: string }> {
  const user = await requireUser();
  try {
    const data = await reviewService.getTradeReviewData(user.id, tradeId);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not load the trade review.") };
  }
}

export async function setReviewLifecycleStatusAction(
  dateKey: string,
  tradeId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = setReviewLifecycleStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await reviewService.setReviewLifecycleStatus(user.id, tradeId, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  revalidateTrade(dateKey, tradeId);
  return { success: true };
}

// ── Actual Partial Exits (Stage 7 §2) — the first UI surface for the
// pre-existing trade-partial-exit.service.ts / TradeActualPartialExit model. ──

export interface PartialExitRowDTO {
  id: string;
  exitOrder: number;
  exitPrice: number;
  percentClosed: number | null;
  quantityClosed: number | null;
  exitedAt: string; // ISO
  grossPnl: number | null;
  fees: number | null;
  netPnl: number | null;
  realizedR: number | null;
  notes: string | null;
  plannedTargetId: string | null;
}

// Prisma Decimal/Date fields don't cross the server-action boundary as-is —
// map to a plain DTO before returning to client code (unlike the mutation
// actions below, which never hand the row back to the client).
export async function listPartialExitsAction(tradeId: string): Promise<PartialExitRowDTO[]> {
  const user = await requireUser();
  const rows = await partialExitService.listPartialExits(user.id, tradeId);
  return rows.map((r) => ({
    id: r.id,
    exitOrder: r.exitOrder,
    exitPrice: r.exitPrice.toNumber(),
    percentClosed: r.percentClosed?.toNumber() ?? null,
    quantityClosed: r.quantityClosed?.toNumber() ?? null,
    exitedAt: r.exitedAt.toISOString(),
    grossPnl: r.grossPnl?.toNumber() ?? null,
    fees: r.fees?.toNumber() ?? null,
    netPnl: r.netPnl?.toNumber() ?? null,
    realizedR: r.realizedR?.toNumber() ?? null,
    notes: r.notes,
    plannedTargetId: r.plannedTargetId,
  }));
}

export async function upsertPartialExitAction(dateKey: string, tradeId: string, input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = partialExitUpsertSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await partialExitService.upsertPartialExit(user.id, tradeId, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save the partial exit.") };
  }
  revalidateTrade(dateKey, tradeId);
  revalidatePerformanceSurfaces();
  return { success: true };
}

export async function deletePartialExitAction(dateKey: string, tradeId: string, partialExitId: string): Promise<Result> {
  const user = await requireUser();
  try {
    await partialExitService.deletePartialExit(user.id, tradeId, partialExitId);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to remove the partial exit.") };
  }
  revalidateTrade(dateKey, tradeId);
  revalidatePerformanceSurfaces();
  return { success: true };
}
