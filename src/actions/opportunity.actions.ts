"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import type { WorkspaceDayRef } from "@/lib/validation/workspace";
import { runInDayScope, runInRecordScope } from "@/server/workspace/action-scope";
import { dayEditableGuard } from "@/actions/day-guard";
import { opportunityCreateSchema, missOutcomeSchema, missedSetupSchema } from "@/lib/validation/opportunity";
import { prisma } from "@/server/db";
import { utcDateToKey } from "@/lib/date";
import * as opportunityService from "@/server/services/opportunity.service";
import { OpportunityError } from "@/server/services/opportunity.service";

type ActionResult = { success: true; opportunityId: string } | { success: false; error: string };
type SimpleResult = { success: true } | { success: false; error: string };

// Every opportunity mutation touches the day's journal, the dashboard, and the
// analytics discrepancy — revalidate all three so the UI reflects the new outcome.
function revalidateOpportunitySurfaces(dateKey: string) {
  revalidatePath(`/journal/${dateKey}`);
  revalidatePath("/journal");
  revalidatePath("/dashboard");
  revalidatePath("/analytics");
}

function toError(e: unknown): { success: false; error: string } {
  if (e instanceof OpportunityError) return { success: false, error: e.message };
  throw e;
}

export async function createOpportunity(day: WorkspaceDayRef, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    const parsed = opportunityCreateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }

    try {
      const op = await opportunityService.createOpportunity(user.id, dateKey, parsed.data);
      revalidateOpportunitySurfaces(dateKey);
      return { success: true, opportunityId: op.id };
    } catch (e) {
      return toError(e);
    }
  });
}

export async function logMissedOutcome(
  dateKey: string,
  opportunityId: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { opportunity: opportunityId }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    const parsed = missOutcomeSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }

    try {
      const op = await opportunityService.logMissedOutcome(user.id, opportunityId, parsed.data);
      revalidateOpportunitySurfaces(dateKey);
      return { success: true, opportunityId: op.id };
    } catch (e) {
      return toError(e);
    }
  });
}

export async function linkExecutedTrade(
  dateKey: string,
  opportunityId: string,
  tradeId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { opportunity: opportunityId }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    try {
      const op = await opportunityService.linkExecutedTrade(user.id, opportunityId, tradeId);
      revalidateOpportunitySurfaces(dateKey);
      return { success: true, opportunityId: op.id };
    } catch (e) {
      return toError(e);
    }
  });
}

export async function unlinkExecutedTrade(
  dateKey: string,
  opportunityId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { opportunity: opportunityId }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    try {
      const op = await opportunityService.unlinkExecutedTrade(user.id, opportunityId);
      revalidateOpportunitySurfaces(dateKey);
      return { success: true, opportunityId: op.id };
    } catch (e) {
      return toError(e);
    }
  });
}

export async function invalidateOpportunity(
  dateKey: string,
  opportunityId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { opportunity: opportunityId }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    try {
      const op = await opportunityService.invalidateOpportunity(user.id, opportunityId);
      revalidateOpportunitySurfaces(dateKey);
      return { success: true, opportunityId: op.id };
    } catch (e) {
      return toError(e);
    }
  });
}

export async function expireOpportunity(
  dateKey: string,
  opportunityId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { opportunity: opportunityId }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    try {
      const op = await opportunityService.expireOpportunity(user.id, opportunityId);
      revalidateOpportunitySurfaces(dateKey);
      return { success: true, opportunityId: op.id };
    } catch (e) {
      return toError(e);
    }
  });
}

export async function deleteOpportunity(
  dateKey: string,
  opportunityId: string,
): Promise<SimpleResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { opportunity: opportunityId }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    try {
      await opportunityService.deleteOpportunity(user.id, opportunityId);
      revalidateOpportunitySurfaces(dateKey);
      return { success: true };
    } catch (e) {
      return toError(e);
    }
  });
}

/** Today V3 (Phase 4) — "+ Setup missed": record a missed setup in one step. */
export async function recordMissedSetup(day: WorkspaceDayRef, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    const parsed = missedSetupSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }

    try {
      const op = await opportunityService.recordMissedSetup(user.id, dateKey, parsed.data.setup, parsed.data.miss);
      revalidateOpportunitySurfaces(dateKey);
      revalidatePath("/today");
      return { success: true, opportunityId: op.id };
    } catch (e) {
      return toError(e);
    }
  });
}

/**
 * Today V3 (Phase 4) — "Record as missed opportunity" on a cancelled idea.
 * Only ever on the trader's explicit request. Guarded by the cancelled
 * trade's OWN day (read server-side, never trusted from the client).
 */
export async function recordCancelledIdeaAsMissed(tradeId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const trade = await prisma.trade.findFirst({ where: { id: tradeId, userId: user.id }, select: { tradeDate: true } });
    if (!trade) return { success: false, error: "Trade not found." };
    const dateKey = utcDateToKey(trade.tradeDate);
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    const parsed = missOutcomeSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }

    try {
      const op = await opportunityService.recordCancelledIdeaAsMissed(user.id, tradeId, parsed.data);
      revalidateOpportunitySurfaces(dateKey);
      revalidatePath("/today");
      revalidatePath(`/journal/${dateKey}/trades/${tradeId}`);
      return { success: true, opportunityId: op.id };
    } catch (e) {
      return toError(e);
    }
  });
}
