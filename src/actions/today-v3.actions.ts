"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import type { WorkspaceDayRef } from "@/lib/validation/workspace";
import { runInDayScope, runInRecordScope } from "@/server/workspace/action-scope";
import { dayEditableGuard, tradeExecutionEditableGuard } from "@/actions/day-guard";
import {
  entryTimeSchema,
  executionConfirmationsSchema,
  ideaUpdateSchema,
  quickIdeaSchema,
  recordEntrySchema,
} from "@/lib/validation/today-v3";
import * as todayTrade from "@/server/services/today-trade.service";
import { attachPlanScreenshotFromAssetChart } from "@/server/services/trade-plan.service";
import { getPlanningReference } from "@/server/services/today-rules.service";
import { getTrade } from "@/server/services/trades.service";
import { tradeToFormValues } from "@/server/services/trade-input.mapper";
import type { LimitOverrideKind } from "@/domain/today/limit-state";
import { QuantityLedgerEntryError, type LedgerEntryErrorCode } from "@/server/services/position-ledger.service";

type Failure = {
  success: false;
  error: string;
  override?: { kinds: LimitOverrideKind[]; messages: string[] };
  /** Quantity ledger (Phase 2): why the quantity engine could not size the entry. */
  ledger?: { code: LedgerEntryErrorCode; details: Record<string, unknown> };
};
type SimpleResult = { success: true } | Failure;
type CreateResult = { success: true; tradeId: string } | Failure;

function fail(error: unknown, fallback: string): Failure {
  if (error instanceof todayTrade.LimitOverrideRequiredError) {
    return {
      success: false,
      error: error.message,
      override: { kinds: error.override.kinds, messages: error.override.messages },
    };
  }
  if (error instanceof QuantityLedgerEntryError) {
    return { success: false, error: error.message, ledger: { code: error.code, details: error.details } };
  }
  return { success: false, error: error instanceof Error ? error.message : fallback };
}

function revalidateToday(dateKey: string, tradeId?: string) {
  revalidatePath("/today");
  revalidatePath(`/journal/${dateKey}`);
  if (tradeId) revalidatePath(`/journal/${dateKey}/trades/${tradeId}`);
  revalidatePath("/dashboard");
}

/** Today V3 — Quick Trade Idea ("Create idea" / "Create & plan →"). */
export async function createQuickIdeaAction(day: WorkspaceDayRef, input: unknown): Promise<CreateResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;
    const parsed = quickIdeaSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    try {
      const { tradeId } = await todayTrade.createQuickIdea(user.id, dateKey, parsed.data);
      revalidateToday(dateKey, tradeId);
      return { success: true, tradeId };
    } catch (error) {
      return fail(error, "Failed to create the idea.");
    }
  });
}

/** Before-entry edits to an idea's strategy-scoped selections. */
export async function updateIdeaAction(dateKey: string, tradeId: string, input: unknown): Promise<SimpleResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;
    const parsed = ideaUpdateSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    try {
      await todayTrade.updateIdea(user.id, tradeId, parsed.data);
      revalidateToday(dateKey, tradeId);
      return { success: true };
    } catch (error) {
      return fail(error, "Failed to update the idea.");
    }
  });
}

/** The first actual entry (+ real Entry Time) — taking the trade. */
export async function recordEntryAction(dateKey: string, tradeId: string, input: unknown): Promise<SimpleResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;
    const parsed = recordEntrySchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    try {
      await todayTrade.recordFirstEntry(user.id, dateKey, tradeId, parsed.data);
      revalidateToday(dateKey, tradeId);
      revalidatePath("/accounts");
      return { success: true };
    } catch (error) {
      return fail(error, "Failed to record the entry.");
    }
  });
}

/** Correcting the real Entry Time after entry (never re-derives risk). */
export async function updateEntryTimeAction(dateKey: string, tradeId: string, input: unknown): Promise<SimpleResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const blocked = await tradeExecutionEditableGuard(user.id, dateKey, tradeId);
    if (blocked) return blocked;
    const parsed = entryTimeSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    try {
      await todayTrade.updateEntryTime(user.id, tradeId, parsed.data.entryMinutes);
      revalidateToday(dateKey, tradeId);
      return { success: true };
    } catch (error) {
      return fail(error, "Failed to update the entry time.");
    }
  });
}

/** Execution confirmations (re-scored against the frozen strategy snapshot). */
export async function updateExecutionConfirmationsAction(dateKey: string, tradeId: string, input: unknown): Promise<SimpleResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const blocked = await tradeExecutionEditableGuard(user.id, dateKey, tradeId);
    if (blocked) return blocked;
    const parsed = executionConfirmationsSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    try {
      await todayTrade.updateExecutionConfirmations(user.id, tradeId, parsed.data.selected);
      revalidateToday(dateKey, tradeId);
      return { success: true };
    } catch (error) {
      return fail(error, "Failed to save execution confirmations.");
    }
  });
}

/** "Use asset chart" as the plan screenshot (same MediaAsset, no copy). */
export async function attachAssetChartToPlanAction(dateKey: string, tradeId: string, mediaAttachmentId: string): Promise<SimpleResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;
    try {
      await attachPlanScreenshotFromAssetChart(user.id, tradeId, mediaAttachmentId);
      revalidateToday(dateKey, tradeId);
      return { success: true };
    } catch (error) {
      return fail(error, "Failed to use the chart.");
    }
  });
}

/** Read-only planning reference for the Plan stage (no writes). */
export async function loadPlanningReferenceAction(strategyId: string, entryModelName: string | null) {
  const user = await requireUser();
  if (typeof strategyId !== "string" || strategyId === "") return null;
  return getPlanningReference(user.id, strategyId, entryModelName);
}

/** Full current Idea values for the before-entry editor (read-only). */
export async function loadIdeaForEditAction(tradeId: string) {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "read", async () => {
    const trade = await getTrade(user.id, tradeId);
    if (!trade) return { success: false as const, error: "Trade not found." };
    const v = tradeToFormValues(trade);
    return {
      success: true as const,
      data: {
        strategyId: trade.strategyId,
        direction: trade.direction,
        selectedSession: trade.selectedSession,
        selectedEntryModel: trade.selectedEntryModel,
        selectedConfluences: (v.selectedConfluences ?? []) as string[],
        setupTypeId: v.setupTypeId ?? null,
        selectedSetupConditions: (v.selectedSetupConditions ?? []) as string[],
        setupOverrideReason: v.setupOverrideReason ?? null,
        setupOverrideNote: v.setupOverrideNote ?? null,
        reasonForTrade: trade.reasonForTrade,
        preTradeMoodTags: trade.preTradeMoodTags,
        preTradeMoodIntensity: trade.preTradeMoodIntensity,
        preTradeMoodNote: trade.preTradeMoodNote,
      },
    };
  });
}
