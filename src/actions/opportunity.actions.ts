"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { dayEditableGuard } from "@/actions/day-guard";
import { opportunityCreateSchema, missOutcomeSchema } from "@/lib/validation/opportunity";
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

export async function createOpportunity(dateKey: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
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
}

export async function logMissedOutcome(
  dateKey: string,
  opportunityId: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
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
}

export async function linkExecutedTrade(
  dateKey: string,
  opportunityId: string,
  tradeId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const blocked = await dayEditableGuard(user.id, dateKey);
  if (blocked) return blocked;

  try {
    const op = await opportunityService.linkExecutedTrade(user.id, opportunityId, tradeId);
    revalidateOpportunitySurfaces(dateKey);
    return { success: true, opportunityId: op.id };
  } catch (e) {
    return toError(e);
  }
}

export async function unlinkExecutedTrade(
  dateKey: string,
  opportunityId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const blocked = await dayEditableGuard(user.id, dateKey);
  if (blocked) return blocked;

  try {
    const op = await opportunityService.unlinkExecutedTrade(user.id, opportunityId);
    revalidateOpportunitySurfaces(dateKey);
    return { success: true, opportunityId: op.id };
  } catch (e) {
    return toError(e);
  }
}

export async function invalidateOpportunity(
  dateKey: string,
  opportunityId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const blocked = await dayEditableGuard(user.id, dateKey);
  if (blocked) return blocked;

  try {
    const op = await opportunityService.invalidateOpportunity(user.id, opportunityId);
    revalidateOpportunitySurfaces(dateKey);
    return { success: true, opportunityId: op.id };
  } catch (e) {
    return toError(e);
  }
}

export async function expireOpportunity(
  dateKey: string,
  opportunityId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const blocked = await dayEditableGuard(user.id, dateKey);
  if (blocked) return blocked;

  try {
    const op = await opportunityService.expireOpportunity(user.id, opportunityId);
    revalidateOpportunitySurfaces(dateKey);
    return { success: true, opportunityId: op.id };
  } catch (e) {
    return toError(e);
  }
}

export async function deleteOpportunity(
  dateKey: string,
  opportunityId: string,
): Promise<SimpleResult> {
  const user = await requireUser();
  const blocked = await dayEditableGuard(user.id, dateKey);
  if (blocked) return blocked;

  try {
    await opportunityService.deleteOpportunity(user.id, opportunityId);
    revalidateOpportunitySurfaces(dateKey);
    return { success: true };
  } catch (e) {
    return toError(e);
  }
}
