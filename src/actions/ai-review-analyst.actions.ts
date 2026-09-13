"use server";

import { z } from "zod";

import { requireUser } from "@/server/guards";
import { generateReviewAnalysis, getLatestReviewAnalysis, type PersistedAnalystReportDTO } from "@/server/services/ai-review-analyst.service";
import type { AnalystFailureReason } from "@/domain/ai-review/types";

const sessionIdSchema = z.string().trim().min(1);

type GenerateResult = { success: true; report: PersistedAnalystReportDTO } | { success: false; reason: AnalystFailureReason | "INVALID_INPUT"; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * §47 — the only way tokens are ever spent: an explicit trader action.
 * Requires the review to be finalized (enforced inside the evidence
 * builder — §37); any other failure (provider unavailable, timeout,
 * invalid citations, etc.) comes back as a typed, trader-facing reason
 * rather than a thrown exception, so Edge Review never crashes on an AI
 * failure (§38).
 */
export async function generateReviewAnalysisAction(sessionId: string): Promise<GenerateResult> {
  const user = await requireUser();
  const parsed = sessionIdSchema.safeParse(sessionId);
  if (!parsed.success) return { success: false, reason: "INVALID_INPUT", error: "Invalid review session." };

  try {
    return await generateReviewAnalysis(user.id, parsed.data);
  } catch (error) {
    return { success: false, reason: "UNKNOWN_ERROR", error: errorMessage(error, "Failed to generate the review analysis.") };
  }
}

/** Read-only — shows the existing report by default; never triggers generation. */
export async function getLatestReviewAnalysisAction(sessionId: string): Promise<PersistedAnalystReportDTO | null> {
  const user = await requireUser();
  const parsed = sessionIdSchema.safeParse(sessionId);
  if (!parsed.success) return null;
  return getLatestReviewAnalysis(user.id, parsed.data);
}
