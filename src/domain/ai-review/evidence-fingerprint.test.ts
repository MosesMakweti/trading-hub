import { describe, expect, it } from "vitest";

import { computeEvidenceFingerprint } from "@/domain/ai-review/evidence-fingerprint";
import type { TraderReviewEvidencePackage } from "@/domain/ai-review/types";

function samplePackage(overrides?: Partial<TraderReviewEvidencePackage>): TraderReviewEvidencePackage {
  return {
    packageVersion: "1.0.0",
    period: { sessionId: "s1", reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09", finalized: true, strategyScopeName: null, assetScopeSymbols: [] },
    performanceSummary: { totalTrades: 1, winCount: 1, lossCount: 0, totalR: 1, averageR: 1 },
    strategyPerformance: { strategyName: null, strategyVersion: null, setupBreakdown: [] },
    planningAdherence: { averageExecutionPercent: null, tradesWithSetupType: 0, tradesTotal: 1 },
    validationOverrides: { validatedCount: 0, overriddenCount: 0, notValidatedCount: 1, overrideEvidenceIds: [] },
    behavioralEvidence: { negativeCount: 0, positiveCount: 0, entries: [] },
    psychology: { averagePercent: null, entries: [] },
    replayComparison: null,
    activeCommitments: [],
    commitmentResults: [],
    longitudinalImprovement: { reviewType: "WEEKLY", activeCount: 0, completedCount: 0, improvingCount: 0, decliningCount: 0, averageAdherencePercent: null },
    reflections: { periodReflection: null, dailyReflections: [], tradeReflections: [] },
    historicalContext: { previousPeriodPerformance: null, previousPeriodAdherencePercent: null },
    missingData: [],
    truncation: [],
    evidenceIndex: {},
    ...overrides,
  };
}

describe("computeEvidenceFingerprint — §36 deterministic staleness detection", () => {
  it("produces the same fingerprint for identical content", () => {
    const a = computeEvidenceFingerprint(samplePackage());
    const b = computeEvidenceFingerprint(samplePackage());
    expect(a).toBe(b);
  });

  it("is independent of object key insertion order", () => {
    const p1 = samplePackage();
    const p2 = { ...samplePackage() };
    // Rebuild period with reversed key order — same content, different insertion order.
    p2.period = { assetScopeSymbols: [], strategyScopeName: null, finalized: true, endDate: "2026-08-09", startDate: "2026-08-03", reviewType: "WEEKLY", sessionId: "s1" };
    expect(computeEvidenceFingerprint(p1)).toBe(computeEvidenceFingerprint(p2));
  });

  it("changes when a meaningful field changes (e.g. a new trade is reflected in performanceSummary)", () => {
    const before = computeEvidenceFingerprint(samplePackage());
    const after = computeEvidenceFingerprint(samplePackage({ performanceSummary: { totalTrades: 2, winCount: 1, lossCount: 1, totalR: 0, averageR: 0 } }));
    expect(before).not.toBe(after);
  });

  it("changes when a commitment's adherence changes", () => {
    const before = computeEvidenceFingerprint(samplePackage());
    const after = computeEvidenceFingerprint(
      samplePackage({
        activeCommitments: [
          {
            evidenceId: "COMMITMENT:c1",
            title: "x",
            category: "EXECUTION",
            status: "ACTIVE",
            currentAdherencePercent: 100,
            currentApplicableObservations: 1,
            previousAdherencePercent: null,
            trend: "INSUFFICIENT_DATA",
            periodsActive: 1,
            resolutionEligible: false,
          },
        ],
      }),
    );
    expect(before).not.toBe(after);
  });

  it("is a fixed-length hex string (sha256)", () => {
    const fp = computeEvidenceFingerprint(samplePackage());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
