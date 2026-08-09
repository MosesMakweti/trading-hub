"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { dayEditableGuard } from "@/actions/day-guard";
import { tradeSchema, tradeWorkspaceSectionSchema } from "@/lib/validation/trades";
import * as tradesService from "@/server/services/trades.service";
import { getStrategyReference } from "@/server/services/strategies.service";
import { linkExecutedTrade, OpportunityError } from "@/server/services/opportunity.service";
import type { StrategyReferenceDTO } from "@/types/strategies";

type ActionResult = { success: true; tradeId: string } | { success: false; error: string };
type SimpleResult = { success: true } | { success: false; error: string };

export async function createTrade(
  dateKey: string,
  input: unknown,
  opportunityId?: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const blocked = await dayEditableGuard(user.id, dateKey);
  if (blocked) return blocked;

  const parsed = tradeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const trade = await tradesService.createTrade(user.id, dateKey, parsed.data);

  // If this trade was created from a spotted opportunity, resolve it to EXECUTED.
  // A failed link (e.g. the opportunity was already resolved) must not fail the
  // trade save — the trade is a valid record on its own.
  if (opportunityId) {
    try {
      await linkExecutedTrade(user.id, opportunityId, trade.id);
    } catch (e) {
      if (!(e instanceof OpportunityError)) throw e;
    }
    revalidatePath("/dashboard");
    revalidatePath("/analytics");
  }

  revalidatePath(`/journal/${dateKey}`);
  revalidatePath("/journal");
  return { success: true, tradeId: trade.id };
}

export async function updateTrade(
  dateKey: string,
  tradeId: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const blocked = await dayEditableGuard(user.id, dateKey);
  if (blocked) return blocked;

  const parsed = tradeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const trade = await tradesService.updateTrade(user.id, tradeId, parsed.data);
  revalidatePath(`/journal/${dateKey}`);
  revalidatePath("/journal");
  return { success: true, tradeId: trade.id };
}

// Inline autosave for a single Trade Workspace section field (or a few).
// Kept lightweight and separate from updateTrade so the workspace can save a
// field without re-submitting the entire trade form.
export async function updateTradeSection(
  dateKey: string,
  tradeId: string,
  input: unknown,
): Promise<SimpleResult> {
  const user = await requireUser();
  const blocked = await dayEditableGuard(user.id, dateKey);
  if (blocked) return blocked;

  const parsed = tradeWorkspaceSectionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await tradesService.updateTradeSections(user.id, tradeId, parsed.data);
  revalidatePath(`/journal/${dateKey}/trades/${tradeId}`);
  revalidatePath(`/journal/${dateKey}`);
  return { success: true };
}

// Loads a strategy's reference context for the trade form when a strategy is
// selected. Returns null if the strategy no longer exists / isn't the user's.
export async function loadStrategyReference(
  strategyId: string,
): Promise<StrategyReferenceDTO | null> {
  const user = await requireUser();
  return getStrategyReference(user.id, strategyId);
}

export async function archiveTrade(dateKey: string, tradeId: string): Promise<SimpleResult> {
  const user = await requireUser();
  const blocked = await dayEditableGuard(user.id, dateKey);
  if (blocked) return blocked;

  await tradesService.archiveTrade(user.id, tradeId);
  revalidatePath(`/journal/${dateKey}`);
  revalidatePath("/journal");
  return { success: true };
}
