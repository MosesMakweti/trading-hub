import { z } from "zod";

import type { EvidenceCoverage, EvidenceItem, TraderReviewAnalystReport } from "@/domain/ai-review/types";

/**
 * Validated structured contract for the AI's response (§18, §20) — the
 * model is forced (via tool call, in the Claude provider) to produce this
 * exact shape. `evidenceCoverage` is deliberately NOT part of what the
 * model returns — see `computeEvidenceCoverage` below, computed by the
 * application after citation validation so the model can never
 * self-report a fabricated coverage statistic.
 */
const confidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

const findingSchema = z.object({
  title: z.string().trim().min(1).max(160),
  explanation: z.string().trim().min(1).max(1200),
  evidenceIds: z.array(z.string().trim().min(1)).min(1).max(10),
  confidence: confidenceSchema,
  category: z.string().trim().min(1).max(60),
});

const questionSchema = z.object({
  question: z.string().trim().min(1).max(300),
  relatedEvidenceIds: z.array(z.string().trim().min(1)).max(10),
});

export const analystReportSchema = z.object({
  periodSummary: z.string().trim().min(1).max(1500),
  strengths: z.array(findingSchema).max(6),
  concerns: z.array(findingSchema).max(6),
  recurringPatterns: z.array(findingSchema).max(6),
  improvementProgress: z.array(findingSchema).max(6),
  priorityFocus: z.array(findingSchema).min(1).max(3),
  questionsForReflection: z.array(questionSchema).max(5),
});

export type RawAnalystReport = z.infer<typeof analystReportSchema>;

function allFindings(report: RawAnalystReport) {
  return [...report.strengths, ...report.concerns, ...report.recurringPatterns, ...report.improvementProgress, ...report.priorityFocus];
}

export interface CitationValidationResult {
  valid: boolean;
  unknownIds: string[];
}

/**
 * §20 — every evidence id the model cited (in a finding OR a reflection
 * question) must exist in the package's own `evidenceIndex`. An unknown id
 * means the model fabricated a citation — the caller must retry or fail,
 * never render it as if it were real evidence.
 */
export function validateCitations(report: RawAnalystReport, evidenceIndex: Record<string, EvidenceItem>): CitationValidationResult {
  const unknown = new Set<string>();
  for (const f of allFindings(report)) {
    for (const id of f.evidenceIds) if (!(id in evidenceIndex)) unknown.add(id);
  }
  for (const q of report.questionsForReflection) {
    for (const id of q.relatedEvidenceIds) if (!(id in evidenceIndex)) unknown.add(id);
  }
  return { valid: unknown.size === 0, unknownIds: [...unknown] };
}

/** Computed post-validation — never trusts a model-reported coverage figure. */
export function computeEvidenceCoverage(report: RawAnalystReport, evidenceIndex: Record<string, EvidenceItem>): EvidenceCoverage {
  const cited = new Set<string>();
  for (const f of allFindings(report)) for (const id of f.evidenceIds) cited.add(id);
  for (const q of report.questionsForReflection) for (const id of q.relatedEvidenceIds) cited.add(id);
  return { totalEvidenceItems: Object.keys(evidenceIndex).length, citedEvidenceItems: cited.size };
}

export function toValidatedReport(report: RawAnalystReport, evidenceIndex: Record<string, EvidenceItem>): TraderReviewAnalystReport {
  return { ...report, evidenceCoverage: computeEvidenceCoverage(report, evidenceIndex) };
}
