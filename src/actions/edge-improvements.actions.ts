"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  acceptSuggestedCommitmentSchema,
  continueCommitmentSchema,
  createManualCommitmentSchema,
  refineCommitmentSchema,
  setCommitmentDailyStateSchema,
  setCommitmentStatusSchema,
  updateCommitmentSchema,
} from "@/lib/validation/edge";
import { dateKeyToUtcDate } from "@/lib/date";
import { AUTOMATIC_EVIDENCE_RULE_KEYS, type AutomaticEvidenceRuleKey } from "@/domain/improvements/commitment-adherence";
import * as commitmentService from "@/server/services/edge-review-commitment.service";
import { finalizeEdgeReview } from "@/server/services/replay-review.service";
import type { CommitmentLineageDTO, ContextualReminderDTO, EdgeReviewCommitmentDTO, TodayCommitmentsDTO } from "@/types/edge-improvements";

type ActionResult = { success: true } | { success: false; error: string };
type CommitmentResult = { success: true; commitment: EdgeReviewCommitmentDTO } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function createManualCommitment(sessionId: string, input: unknown): Promise<CommitmentResult> {
  const user = await requireUser();
  const parsed = createManualCommitmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const commitment = await commitmentService.createManualCommitment(user.id, sessionId, parsed.data);
    revalidatePath("/edge");
    revalidatePath("/today");
    return { success: true, commitment };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to create commitment.") };
  }
}

/** §9 — the trader must explicitly Add a suggestion; nothing is auto-created. */
export async function acceptSuggestedCommitment(sessionId: string, input: unknown): Promise<CommitmentResult> {
  const user = await requireUser();
  const parsed = acceptSuggestedCommitmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const commitment = await commitmentService.acceptSuggestedCommitment(user.id, sessionId, parsed.data);
    revalidatePath("/edge");
    revalidatePath("/today");
    return { success: true, commitment };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to accept the suggestion.") };
  }
}

export async function updateCommitment(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = updateCommitmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await commitmentService.updateCommitment(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to update commitment.") };
  }
  revalidatePath("/edge");
  revalidatePath("/today");
  return { success: true };
}

export async function setCommitmentStatus(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = setCommitmentStatusSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await commitmentService.setCommitmentStatus(user.id, id, parsed.data.status);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to update commitment status.") };
  }
  revalidatePath("/edge");
  revalidatePath("/today");
  return { success: true };
}

/** §26-27 — "Finish Review." Requires Replay to already be COMPLETED. */
export async function finishEdgeReview(sessionId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await finalizeEdgeReview(user.id, sessionId);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to finish the review.") };
  }
  revalidatePath("/edge");
  revalidatePath("/today");
  return { success: true };
}

/** §18 — optional daily acknowledgement, stored separately per TradingDay;
 *  never mutates the commitment record itself (§17). */
export async function setCommitmentDailyState(commitmentId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = setCommitmentDailyStateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await commitmentService.setCommitmentDailyState(
      user.id,
      commitmentId,
      dateKeyToUtcDate(parsed.data.dateKey),
      parsed.data.status,
      parsed.data.note ?? null,
    );
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  revalidatePath("/today");
  return { success: true };
}

export async function getTodayCommitments(): Promise<TodayCommitmentsDTO> {
  const user = await requireUser();
  return commitmentService.getActiveCommitmentsForToday(user.id);
}

/**
 * Stage 19.1 §3-7 — Trade Idea contextual reminder. `ruleKeys` is restricted
 * server-side to the fixed deterministic rule set (never arbitrary text
 * from the caller), so a component can only ever ask for a reminder tied
 * to a known, stable rule identity.
 */
export async function getContextualReminder(ruleKeys: AutomaticEvidenceRuleKey[]): Promise<ContextualReminderDTO | null> {
  const user = await requireUser();
  const validKeys = ruleKeys.filter((k) => (AUTOMATIC_EVIDENCE_RULE_KEYS as readonly string[]).includes(k));
  if (validKeys.length === 0) return null;
  return commitmentService.getContextualReminder(user.id, validKeys);
}

/** Stage 19 §29-30 — full cross-period history/adherence for one commitment's
 *  lineage, used by the Improvements tab's result cards and history view. */
export async function getCommitmentLineage(commitmentId: string): Promise<{ success: true; lineage: CommitmentLineageDTO } | { success: false; error: string }> {
  const user = await requireUser();
  try {
    const lineage = await commitmentService.getCommitmentLineage(user.id, commitmentId);
    return { success: true, lineage };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to load commitment history.") };
  }
}

/** §4 "Continue" — same objective, unchanged, carried into a new period. */
export async function continueCommitment(input: unknown): Promise<CommitmentResult> {
  const user = await requireUser();
  const parsed = continueCommitmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const commitment = await commitmentService.continueCommitment(user.id, parsed.data.previousCommitmentId, parsed.data.sessionId);
    revalidatePath("/edge");
    revalidatePath("/today");
    return { success: true, commitment };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to continue the commitment.") };
  }
}

/** §4 "Refine" — same lineage, trader-edited wording/scope. */
export async function refineCommitment(input: unknown): Promise<CommitmentResult> {
  const user = await requireUser();
  const parsed = refineCommitmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const commitment = await commitmentService.refineCommitment(user.id, parsed.data.previousCommitmentId, parsed.data.sessionId, {
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority,
    });
    revalidatePath("/edge");
    revalidatePath("/today");
    return { success: true, commitment };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to refine the commitment.") };
  }
}
