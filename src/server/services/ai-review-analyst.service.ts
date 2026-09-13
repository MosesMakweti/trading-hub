import { prisma } from "@/server/db";
import { computeEvidenceFingerprint } from "@/domain/ai-review/evidence-fingerprint";
import { NullTraderReviewAnalystProvider } from "@/domain/ai-review/providers/null-provider";
import { ClaudeTraderReviewAnalystProvider } from "@/domain/ai-review/providers/claude-analyst-provider";
import { buildTraderReviewEvidencePackage } from "@/server/services/ai-review-evidence.service";
import type { AnalystFailureReason, EvidenceItem, TraderReviewAnalystProvider, TraderReviewAnalystReport } from "@/domain/ai-review/types";

/** Bumped when the tool schema / system prompt contract changes in a way
 *  that would make an old persisted report structurally incompatible with
 *  a fresh one — kept separate from the evidence fingerprint (§34). */
const PROMPT_VERSION = "1.0.0";

/** Mirrors `resolveRecognitionProvider` in trade-plan.service.ts (§16 —
 *  reuse the existing provider-selection precedent rather than inventing a
 *  new one). Exactly one real provider in Stage 20; the Null provider is
 *  the safe, always-available fallback. */
function resolveAnalystProvider(): TraderReviewAnalystProvider {
  const claude = new ClaudeTraderReviewAnalystProvider();
  return claude.isAvailable() ? claude : new NullTraderReviewAnalystProvider();
}

export interface PersistedAnalystReportDTO {
  id: string;
  sessionId: string;
  provider: string;
  model: string;
  promptVersion: string;
  evidencePackageVersion: string;
  evidenceFingerprint: string;
  generatedAt: string;
  report: TraderReviewAnalystReport;
  /** The evidence citation index AS IT WAS at generation time (§34, §46) —
   *  never re-derived from live data, so a historical report's citations
   *  stay inspectable even after the underlying data changes. */
  evidenceIndex: Record<string, EvidenceItem>;
  /** True when the evidence underlying this report has changed since it
   *  was generated (§36) — e.g. a commitment daily-state was logged after
   *  finalization. Computed by rebuilding the evidence package and
   *  comparing fingerprints; the AI is never consulted to determine this. */
  stale: boolean;
}

export interface GenerateAnalysisSuccess {
  success: true;
  report: PersistedAnalystReportDTO;
}
export interface GenerateAnalysisFailure {
  success: false;
  reason: AnalystFailureReason;
  error: string;
}
export type GenerateAnalysisResult = GenerateAnalysisSuccess | GenerateAnalysisFailure;

function toDTO(row: {
  id: string;
  replayReviewSessionId: string;
  provider: string;
  model: string;
  promptVersion: string;
  evidencePackageVersion: string;
  evidenceFingerprint: string;
  generatedAt: Date;
  reportJson: unknown;
  evidenceIndexJson: unknown;
}, stale: boolean): PersistedAnalystReportDTO {
  return {
    id: row.id,
    sessionId: row.replayReviewSessionId,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    evidencePackageVersion: row.evidencePackageVersion,
    evidenceFingerprint: row.evidenceFingerprint,
    generatedAt: row.generatedAt.toISOString(),
    report: row.reportJson as TraderReviewAnalystReport,
    evidenceIndex: row.evidenceIndexJson as Record<string, EvidenceItem>,
    stale,
  };
}

/**
 * Explicit "Generate Review Analysis" action (§47) — never runs
 * automatically on page load. Builds the evidence package, calls the
 * resolved provider, and on success persists a NEW row (§35 — regeneration
 * never overwrites a previous report). Requires a finalized review
 * (enforced inside `buildTraderReviewEvidencePackage` itself — §37).
 * `providerOverride` exists only for tests (§50 — mock the provider,
 * never require a real API call in the deterministic suite); production
 * callers never pass it.
 */
export async function generateReviewAnalysis(userId: string, sessionId: string, providerOverride?: TraderReviewAnalystProvider): Promise<GenerateAnalysisResult> {
  const evidence = await buildTraderReviewEvidencePackage(userId, sessionId);
  const provider = providerOverride ?? resolveAnalystProvider();

  if (!provider.isAvailable()) {
    return { success: false, reason: "PROVIDER_UNAVAILABLE", error: "AI analysis isn't configured for this workspace yet." };
  }

  const outcome = await provider.analyzeReview(evidence);
  if (outcome.status === "FAILED") {
    return { success: false, reason: outcome.reason, error: outcome.error };
  }

  const evidenceFingerprint = computeEvidenceFingerprint(evidence);
  const row = await prisma.aiReviewAnalystReport.create({
    data: {
      userId,
      replayReviewSessionId: sessionId,
      evidenceFingerprint,
      evidencePackageVersion: evidence.packageVersion,
      promptVersion: PROMPT_VERSION,
      provider: outcome.provider,
      model: outcome.model,
      reportJson: outcome.report as object,
      evidenceIndexJson: evidence.evidenceIndex as object,
    },
  });

  return { success: true, report: toDTO(row, false) };
}

/**
 * The current report for a session — the most recent generation by
 * `generatedAt` (§35: "latest" is simply the newest row; older generations
 * remain in the table as history, never deleted or overwritten).
 * Staleness (§36) is computed by rebuilding the evidence package fresh and
 * comparing fingerprints — deterministic, no AI involved.
 */
export async function getLatestReviewAnalysis(userId: string, sessionId: string): Promise<PersistedAnalystReportDTO | null> {
  const row = await prisma.aiReviewAnalystReport.findFirst({
    where: { userId, replayReviewSessionId: sessionId },
    orderBy: { generatedAt: "desc" },
  });
  if (!row) return null;

  let stale = false;
  try {
    const currentEvidence = await buildTraderReviewEvidencePackage(userId, sessionId);
    stale = computeEvidenceFingerprint(currentEvidence) !== row.evidenceFingerprint;
  } catch {
    // The session may have been reopened since this report was generated —
    // treat as stale rather than throwing on a read path.
    stale = true;
  }

  return toDTO(row, stale);
}

export async function countReviewAnalysisHistory(userId: string, sessionId: string): Promise<number> {
  return prisma.aiReviewAnalystReport.count({ where: { userId, replayReviewSessionId: sessionId } });
}
