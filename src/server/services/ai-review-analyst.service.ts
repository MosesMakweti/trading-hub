import { prisma } from "@/server/db";
import { computeEvidenceFingerprint } from "@/domain/ai-review/evidence-fingerprint";
import { NullTraderReviewAnalystProvider } from "@/domain/ai-review/providers/null-provider";
import { ClaudeTraderReviewAnalystProvider } from "@/domain/ai-review/providers/claude-analyst-provider";
import { buildTraderReviewEvidencePackage } from "@/server/services/ai-review-evidence.service";
import type { AnalystFailureReason, EvidenceCoverageSummary, EvidenceItem, TraderReviewAnalystProvider, TraderReviewAnalystReport } from "@/domain/ai-review/types";

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
  /** The coverage summary AS IT WAS at generation time (Stage 20.1 §17) —
   *  null only for a report generated before this column existed. */
  coverageSummary: EvidenceCoverageSummary | null;
  /** True when the evidence underlying this report has changed since it
   *  was generated (§36) — e.g. a commitment daily-state was logged after
   *  finalization. Computed by rebuilding the evidence package and
   *  comparing fingerprints; the AI is never consulted to determine this.
   *  Stage 20.1 §12: this is only ever computed for the CURRENT (most
   *  recent) report — a historical report is simply "a previous
   *  generation," never "stale," so this is always `false` for one
   *  fetched via `getReviewAnalysisById` that isn't also the latest row. */
  stale: boolean;
  /** Stage 20.1 §10/§12 — lets the UI distinguish "Current Analyst Report"
   *  from "Previous Generations" without a second round-trip. */
  isCurrent: boolean;
}

/** Stage 20.1 §10 — the compact list the report-history UI renders; never
 *  the full report/evidence payload (that's fetched on demand by id via
 *  `getReviewAnalysisById`). */
export interface AnalystReportHistoryEntryDTO {
  id: string;
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  evidencePackageVersion: string;
  isCurrent: boolean;
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
  coverageSummaryJson: unknown;
}, stale: boolean, isCurrent: boolean): PersistedAnalystReportDTO {
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
    coverageSummary: (row.coverageSummaryJson as EvidenceCoverageSummary | null) ?? null,
    stale,
    isCurrent,
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
  // Stage 20.1 §21/§23 — deterministic, safe-to-log operational sizing:
  // never the evidence content itself, only its shape.
  const evidenceItemCount = Object.keys(evidence.evidenceIndex).length;
  const packageSizeBytes = Buffer.byteLength(JSON.stringify(evidence), "utf8");
  const startedAt = Date.now();

  if (!provider.isAvailable()) {
    return { success: false, reason: "PROVIDER_UNAVAILABLE", error: "AI analysis isn't configured for this workspace yet." };
  }

  const outcome = await provider.analyzeReview(evidence);
  const durationMs = Date.now() - startedAt;

  if (outcome.status === "FAILED") {
    // §23 — provider, duration, failure class, sizing, never prompt/evidence content.
    console.info("[ai-review-analyst] generation failed", { provider: provider.name, durationMs, evidenceItemCount, packageSizeBytes, reason: outcome.reason });
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
      coverageSummaryJson: evidence.coverageSummary as object,
    },
  });

  console.info("[ai-review-analyst] generation succeeded", { provider: outcome.provider, model: outcome.model, durationMs, evidenceItemCount, packageSizeBytes, reportId: row.id });

  return { success: true, report: toDTO(row, false, true) };
}

/**
 * The current report for a session — the most recent generation by
 * `generatedAt` (§35: "latest" is simply the newest row; older generations
 * remain in the table as history, never deleted or overwritten).
 * Staleness (§36) is computed by rebuilding the evidence package fresh and
 * comparing fingerprints — deterministic, no AI involved.
 */
export async function getLatestReviewAnalysis(userId: string, sessionId: string): Promise<PersistedAnalystReportDTO | null> {
  const latest = await prisma.aiReviewAnalystReport.findFirst({
    where: { userId, replayReviewSessionId: sessionId },
    orderBy: { generatedAt: "desc" },
    select: { id: true },
  });
  if (!latest) return null;
  return getReviewAnalysisById(userId, sessionId, latest.id);
}

/**
 * Stage 20.1 §10-16 — fetches ONE persisted report by id, always rendering
 * its own persisted `reportJson`/`evidenceIndexJson`/`coverageSummaryJson`
 * exactly as generated (§16: never resolved against a live rebuilt
 * evidence package). Staleness (§36) is only ever computed for the CURRENT
 * (most recent) row — an older generation is "a previous generation," not
 * "stale" (§12); requesting one by id never mutates or re-derives it.
 */
export async function getReviewAnalysisById(userId: string, sessionId: string, reportId: string): Promise<PersistedAnalystReportDTO | null> {
  const [row, latest] = await Promise.all([
    prisma.aiReviewAnalystReport.findFirst({ where: { id: reportId, userId, replayReviewSessionId: sessionId } }),
    prisma.aiReviewAnalystReport.findFirst({ where: { userId, replayReviewSessionId: sessionId }, orderBy: { generatedAt: "desc" }, select: { id: true } }),
  ]);
  if (!row) return null;

  const isCurrent = latest?.id === row.id;
  if (!isCurrent) return toDTO(row, false, false);

  let stale = false;
  try {
    const currentEvidence = await buildTraderReviewEvidencePackage(userId, sessionId);
    stale = computeEvidenceFingerprint(currentEvidence) !== row.evidenceFingerprint;
  } catch {
    // The session may have been reopened since this report was generated —
    // treat as stale rather than throwing on a read path.
    stale = true;
  }

  return toDTO(row, stale, true);
}

/**
 * Stage 20.1 §10 — the compact history list the Analyst tab renders;
 * ordered newest first, the same ordering "current" is defined by
 * everywhere else in this service.
 */
export async function listReviewAnalysisHistory(userId: string, sessionId: string): Promise<AnalystReportHistoryEntryDTO[]> {
  const rows = await prisma.aiReviewAnalystReport.findMany({
    where: { userId, replayReviewSessionId: sessionId },
    orderBy: { generatedAt: "desc" },
    select: { id: true, generatedAt: true, provider: true, model: true, promptVersion: true, evidencePackageVersion: true },
  });
  return rows.map((row, index) => ({
    id: row.id,
    generatedAt: row.generatedAt.toISOString(),
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    evidencePackageVersion: row.evidencePackageVersion,
    isCurrent: index === 0,
  }));
}

export async function countReviewAnalysisHistory(userId: string, sessionId: string): Promise<number> {
  return prisma.aiReviewAnalystReport.count({ where: { userId, replayReviewSessionId: sessionId } });
}
