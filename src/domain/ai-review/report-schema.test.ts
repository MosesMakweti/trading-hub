import { describe, expect, it } from "vitest";

import { analystReportSchema, computeEvidenceCoverage, toValidatedReport, validateCitations } from "@/domain/ai-review/report-schema";
import type { EvidenceItem } from "@/domain/ai-review/types";

const evidenceIndex: Record<string, EvidenceItem> = {
  "TRADE:1": { id: "TRADE:1", strength: "OBJECTIVE", category: "OVERRIDE_DISCIPLINE", statement: "x" },
  "COMMITMENT:1": { id: "COMMITMENT:1", strength: "DERIVED", category: "COMMITMENT", statement: "y" },
};

interface RawFinding {
  title: string;
  explanation: string;
  evidenceIds: string[];
  confidence: string;
  category: string;
}

interface RawReportInput {
  periodSummary: string;
  strengths: RawFinding[];
  concerns: RawFinding[];
  recurringPatterns: RawFinding[];
  improvementProgress: RawFinding[];
  priorityFocus: RawFinding[];
  questionsForReflection: { question: string; relatedEvidenceIds: string[] }[];
}

function validInput(): RawReportInput {
  return {
    periodSummary: "Summary.",
    strengths: [{ title: "t", explanation: "e", evidenceIds: ["TRADE:1"], confidence: "HIGH", category: "PROCESS" }],
    concerns: [],
    recurringPatterns: [],
    improvementProgress: [],
    priorityFocus: [{ title: "p", explanation: "e", evidenceIds: ["COMMITMENT:1"], confidence: "MEDIUM", category: "PROCESS" }],
    questionsForReflection: [{ question: "q?", relatedEvidenceIds: [] }],
  };
}

describe("analystReportSchema — every finding has evidence, confidence is a valid enum", () => {
  it("accepts a well-formed report", () => {
    const result = analystReportSchema.safeParse(validInput());
    expect(result.success).toBe(true);
  });

  it("rejects a finding with zero evidence ids", () => {
    const input = validInput();
    input.strengths[0].evidenceIds = [];
    expect(analystReportSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an invalid confidence value", () => {
    const input = validInput();
    input.strengths[0].confidence = "VERY_HIGH";
    expect(analystReportSchema.safeParse(input).success).toBe(false);
  });

  it("bounds priorityFocus to at most 3 items", () => {
    const input = validInput();
    input.priorityFocus = Array.from({ length: 4 }, () => ({ title: "p", explanation: "e", evidenceIds: ["TRADE:1"], confidence: "LOW", category: "X" }));
    expect(analystReportSchema.safeParse(input).success).toBe(false);
  });

  it("requires at least one priorityFocus item", () => {
    const input = validInput();
    input.priorityFocus = [];
    expect(analystReportSchema.safeParse(input).success).toBe(false);
  });

  it("bounds each finding array to at most 6 items", () => {
    const input = validInput();
    input.strengths = Array.from({ length: 7 }, () => ({ title: "t", explanation: "e", evidenceIds: ["TRADE:1"], confidence: "LOW", category: "X" }));
    expect(analystReportSchema.safeParse(input).success).toBe(false);
  });

  it("has no market-prediction fields in the schema shape", () => {
    const shape = Object.keys(analystReportSchema.shape);
    for (const forbidden of ["priceTarget", "signal", "direction", "entry", "buy", "sell", "forecast"]) {
      expect(shape.map((s) => s.toLowerCase())).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe("validateCitations — §20 unknown ids rejected", () => {
  it("passes when every cited id exists in the evidenceIndex", () => {
    const parsed = analystReportSchema.parse(validInput());
    expect(validateCitations(parsed, evidenceIndex).valid).toBe(true);
  });

  it("fails and reports the unknown id when a finding cites one that doesn't exist", () => {
    const input = validInput();
    input.strengths[0].evidenceIds = ["TRADE:does-not-exist"];
    const parsed = analystReportSchema.parse(input);
    const result = validateCitations(parsed, evidenceIndex);
    expect(result.valid).toBe(false);
    expect(result.unknownIds).toEqual(["TRADE:does-not-exist"]);
  });

  it("also validates ids cited only in questionsForReflection", () => {
    const input = validInput();
    input.questionsForReflection = [{ question: "q?", relatedEvidenceIds: ["NOPE"] }];
    const parsed = analystReportSchema.parse(input);
    expect(validateCitations(parsed, evidenceIndex).valid).toBe(false);
  });
});

describe("computeEvidenceCoverage / toValidatedReport — never trusts a model-reported figure", () => {
  it("computes coverage from actual citations, not any field the model could set", () => {
    const parsed = analystReportSchema.parse(validInput());
    const coverage = computeEvidenceCoverage(parsed, evidenceIndex);
    expect(coverage.totalEvidenceItems).toBe(2);
    expect(coverage.citedEvidenceItems).toBe(2); // TRADE:1 and COMMITMENT:1, deduplicated
  });

  it("toValidatedReport attaches the computed coverage to the report", () => {
    const parsed = analystReportSchema.parse(validInput());
    const report = toValidatedReport(parsed, evidenceIndex);
    expect(report.evidenceCoverage).toEqual({ totalEvidenceItems: 2, citedEvidenceItems: 2 });
    expect((report as unknown as { evidenceCoverage?: unknown }).evidenceCoverage).toBeDefined();
  });

  it("does not double-count the same id cited by multiple findings", () => {
    const input = validInput();
    input.concerns = [{ title: "c", explanation: "e", evidenceIds: ["TRADE:1"], confidence: "LOW", category: "X" }];
    const parsed = analystReportSchema.parse(input);
    expect(computeEvidenceCoverage(parsed, evidenceIndex).citedEvidenceItems).toBe(2);
  });
});
