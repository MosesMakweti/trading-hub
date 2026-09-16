import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { computeEvidenceFingerprint } from "@/domain/ai-review/evidence-fingerprint";
import {
  completeReplayReviewSession,
  createReplayReviewSession,
  finalizeEdgeReview,
  startReplayReviewSession,
} from "@/server/services/replay-review.service";
import { continueCommitment, createManualCommitment, setCommitmentDailyState } from "@/server/services/edge-review-commitment.service";
import { buildTraderReviewEvidencePackage } from "@/server/services/ai-review-evidence.service";
import { AUTOMATIC_EVIDENCE_RULE_KEYS } from "@/domain/improvements/commitment-adherence";

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `ai-review-evidence-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
  userIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

async function finalizedSession(userId: string, params: { reviewType: "WEEKLY" | "MONTHLY"; startDate: string; endDate: string }) {
  const session = await createReplayReviewSession(userId, params);
  await startReplayReviewSession(userId, session.id);
  await completeReplayReviewSession(userId, session.id);
  await finalizeEdgeReview(userId, session.id);
  return session;
}

function makeTrade(
  userId: string,
  dateKey: string,
  overrides: Partial<{
    validationState: "VALIDATED" | "OVERRIDDEN" | "NOT_VALIDATED";
    actualRR: number;
    executionPercent: number;
    strategyNameSnapshot: string;
    strategyVersionSnapshot: number;
    whatWentWell: string;
  }> = {},
) {
  return prisma.trade.create({
    data: {
      userId,
      tradeDate: new Date(`${dateKey}T00:00:00.000Z`),
      executionMinutes: 5,
      direction: "LONG",
      higherTimeframeBias: "BULLISH",
      biasConfidencePercent: 80,
      assetSymbol: "XAUUSD",
      ...overrides,
    },
  });
}

describe("buildTraderReviewEvidencePackage — finalization guard (§37)", () => {
  it("throws when the review is not finalized", async () => {
    const user = await makeUser("not-finalized");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await expect(buildTraderReviewEvidencePackage(user.id, session.id)).rejects.toThrow("Only a finalized review can be analyzed.");
  });

  it("throws for a session belonging to another user", async () => {
    const owner = await makeUser("evidence-owner");
    const attacker = await makeUser("evidence-attacker");
    const session = await finalizedSession(owner.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await expect(buildTraderReviewEvidencePackage(attacker.id, session.id)).rejects.toThrow("Review session not found.");
  });
});

describe("buildTraderReviewEvidencePackage — period boundaries", () => {
  it("includes only trades within [startDate, endDate], excluding trades just outside the period", async () => {
    const user = await makeUser("period-boundaries");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await makeTrade(user.id, "2026-08-02", { actualRR: 5 }); // just before
    await makeTrade(user.id, "2026-08-04", { actualRR: 1 }); // inside
    await makeTrade(user.id, "2026-08-10", { actualRR: 5 }); // just after

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.performanceSummary.totalTrades).toBe(1);
    expect(evidence.performanceSummary.totalR).toBe(1);
  });
});

describe("buildTraderReviewEvidencePackage — historical snapshots (§9)", () => {
  it("uses Trade.strategyNameSnapshot/strategyVersionSnapshot, never a live Strategy join", async () => {
    const user = await makeUser("historical-snapshot");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await makeTrade(user.id, "2026-08-04", { strategyNameSnapshot: "Old Strategy Name v2", strategyVersionSnapshot: 2 });

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.strategyPerformance.strategyName).toBe("Old Strategy Name v2");
    expect(evidence.strategyPerformance.strategyVersion).toBe(2);
  });
});

describe("buildTraderReviewEvidencePackage — validation/overrides and evidence provenance (§6-7)", () => {
  it("counts validated/overridden/not-validated trades and assigns stable TRADE: evidence ids for overrides", async () => {
    const user = await makeUser("validation-overrides");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await makeTrade(user.id, "2026-08-04", { validationState: "VALIDATED" });
    const overridden = await makeTrade(user.id, "2026-08-05", { validationState: "OVERRIDDEN" });

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.validationOverrides.validatedCount).toBe(1);
    expect(evidence.validationOverrides.overriddenCount).toBe(1);
    expect(evidence.validationOverrides.overrideEvidenceIds).toEqual([`TRADE:${overridden.id}`]);
    expect(evidence.evidenceIndex[`TRADE:${overridden.id}`].strength).toBe("OBJECTIVE");
  });

  it("bounds override evidence and documents the truncation (§13-14)", async () => {
    const user = await makeUser("validation-truncation");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    for (let i = 0; i < 20; i++) {
      await makeTrade(user.id, `2026-08-${String(3 + (i % 7)).padStart(2, "0")}`, { validationState: "OVERRIDDEN" });
    }

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.validationOverrides.overriddenCount).toBe(20);
    expect(evidence.validationOverrides.overrideEvidenceIds.length).toBe(15);
    const note = evidence.truncation.find((t) => t.field === "validationOverrides.overrideEvidenceIds");
    expect(note).toEqual({ field: "validationOverrides.overrideEvidenceIds", totalAvailable: 20, included: 15, selectionRule: "most recent" });
  });
});

describe("buildTraderReviewEvidencePackage — commitment adherence integration (§30)", () => {
  it("includes an active commitment's real lineage adherence, reusing Stage 19's read model", async () => {
    const user = await makeUser("commitment-integration");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "No stop widening", description: null, priority: "HIGH" });
    await setCommitmentDailyState(user.id, commitment.id, new Date("2026-08-04T00:00:00.000Z"), "FOLLOWED");
    await setCommitmentDailyState(user.id, commitment.id, new Date("2026-08-05T00:00:00.000Z"), "BREACHED");

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.activeCommitments).toHaveLength(1);
    expect(evidence.activeCommitments[0].title).toBe("No stop widening");
    expect(evidence.activeCommitments[0].currentAdherencePercent).toBe(50);
    expect(evidence.activeCommitments[0].currentApplicableObservations).toBe(2);
    expect(evidence.evidenceIndex[evidence.activeCommitments[0].evidenceId]).toBeDefined();
  });

  it("flags NO_COMMITMENTS when the session has none", async () => {
    const user = await makeUser("no-commitments");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.missingData).toContain("NO_COMMITMENTS");
  });
});

describe("buildTraderReviewEvidencePackage — Replay comparison present with zero Replay trades", () => {
  it("still returns a valid (non-null) comparison summary rather than treating an empty Replay as an error", async () => {
    const user = await makeUser("replay-empty");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.replayComparison).not.toBeNull();
    expect(evidence.replayComparison?.matchedDecisionCount).toBe(0);
  });
});

describe("buildTraderReviewEvidencePackage — psychology absent/present (§27, §32)", () => {
  it("flags NO_PSYCHOLOGY_DATA when no trade has a questionnaire response", async () => {
    const user = await makeUser("psychology-absent");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await makeTrade(user.id, "2026-08-04");

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.missingData).toContain("NO_PSYCHOLOGY_DATA");
    expect(evidence.psychology.averagePercent).toBeNull();
  });

  it("includes psychology as TRADER_REPORTED evidence when present", async () => {
    const user = await makeUser("psychology-present");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const trade = await makeTrade(user.id, "2026-08-04");
    await prisma.psychologyQuestionnaireResponse.create({
      data: { tradeId: trade.id, answers: {}, rawScore: 8, psychologyPercent: 80, grade: "A" },
    });

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.missingData).not.toContain("NO_PSYCHOLOGY_DATA");
    expect(evidence.psychology.averagePercent).toBe(80);
    expect(evidence.psychology.entries[0]).toMatchObject({ percent: 80, grade: "A" });
    expect(evidence.evidenceIndex[evidence.psychology.entries[0].evidenceId].strength).toBe("TRADER_REPORTED");
  });
});

describe("buildTraderReviewEvidencePackage — no secrets/PII in the package", () => {
  it("never includes the trader's email or user id anywhere in the serialized package", async () => {
    const user = await makeUser("no-pii");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await makeTrade(user.id, "2026-08-04", { whatWentWell: "Stuck to my plan today." });

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain(user.email);
    expect(serialized).not.toContain(user.id);
  });
});

describe("buildTraderReviewEvidencePackage — stable fingerprint (§36, §51)", () => {
  it("produces the same fingerprint on two consecutive builds of unchanged data", async () => {
    const user = await makeUser("stable-fingerprint");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await makeTrade(user.id, "2026-08-04", { actualRR: 1, validationState: "VALIDATED" });

    const first = await buildTraderReviewEvidencePackage(user.id, session.id);
    const second = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(computeEvidenceFingerprint(first)).toBe(computeEvidenceFingerprint(second));
  });

  it("changes the fingerprint once new evidence is added (e.g. a commitment observation logged later)", async () => {
    const user = await makeUser("changing-fingerprint");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "x", description: null, priority: "HIGH" });

    const before = computeEvidenceFingerprint(await buildTraderReviewEvidencePackage(user.id, session.id));
    await setCommitmentDailyState(user.id, commitment.id, new Date("2026-08-04T00:00:00.000Z"), "FOLLOWED");
    const after = computeEvidenceFingerprint(await buildTraderReviewEvidencePackage(user.id, session.id));

    expect(before).not.toBe(after);
  });
});

describe("buildTraderReviewEvidencePackage — behaviorOccurrenceTrends (Stage 20.1 §2-6)", () => {
  it("packages Stage 19.1's own behaviourOccurrence series, tagged DERIVED, without recomputing it", async () => {
    const user = await makeUser("behavior-trend-basic");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, session.id, {
      category: "EXECUTION",
      title: "No stop widening",
      description: null,
      priority: "HIGH",
      automaticRuleKey: "STOP_WIDENING_PATTERN",
    });
    await setCommitmentDailyState(user.id, commitment.id, new Date("2026-08-04T00:00:00.000Z"), "BREACHED");
    await setCommitmentDailyState(user.id, commitment.id, new Date("2026-08-05T00:00:00.000Z"), "BREACHED");

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.behaviorOccurrenceTrends).toHaveLength(1);
    const trend = evidence.behaviorOccurrenceTrends[0];
    expect(trend.ruleKey).toBe("STOP_WIDENING_PATTERN");
    expect(trend.label).toBe("Stop widening");
    expect(trend.reviewType).toBe("WEEKLY");
    expect(trend.points).toEqual([{ periodStart: "2026-08-03", breachCount: 2 }]);
    expect(evidence.evidenceIndex[trend.evidenceId].strength).toBe("DERIVED");
    expect(evidence.coverageSummary.longitudinalBehaviorAvailable).toBe(true);
  });

  it("flags NO_LONGITUDINAL_BEHAVIOR_DATA and reports unavailable coverage when no automatic-evidence rule has any breach", async () => {
    const user = await makeUser("behavior-trend-empty");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.behaviorOccurrenceTrends).toEqual([]);
    expect(evidence.missingData).toContain("NO_LONGITUDINAL_BEHAVIOR_DATA");
    expect(evidence.coverageSummary.longitudinalBehaviorAvailable).toBe(false);
  });

  it("keeps weekly and monthly series separate — a MONTHLY commitment's breaches never appear in a WEEKLY package (§4)", async () => {
    const user = await makeUser("behavior-trend-weekly-monthly");
    const monthlySession = await finalizedSession(user.id, { reviewType: "MONTHLY", startDate: "2026-08-01", endDate: "2026-08-31" });
    const monthlyCommitment = await createManualCommitment(user.id, monthlySession.id, {
      category: "EXECUTION",
      title: "Monthly stop widening objective",
      description: null,
      priority: "HIGH",
      automaticRuleKey: "STOP_WIDENING_PATTERN",
    });
    await setCommitmentDailyState(user.id, monthlyCommitment.id, new Date("2026-08-04T00:00:00.000Z"), "BREACHED");

    const weeklySession = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const evidence = await buildTraderReviewEvidencePackage(user.id, weeklySession.id);

    expect(evidence.behaviorOccurrenceTrends).toEqual([]);
    expect(evidence.missingData).toContain("NO_LONGITUDINAL_BEHAVIOR_DATA");
  });

  it("bounds behaviorOccurrenceTrends to the top 6 rules by total breach count and records truncation (§6)", async () => {
    const user = await makeUser("behavior-trend-bounding");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    expect(AUTOMATIC_EVIDENCE_RULE_KEYS.length).toBe(7); // exercising every rule key at once, one over the cap of 6

    for (const [i, ruleKey] of AUTOMATIC_EVIDENCE_RULE_KEYS.entries()) {
      const commitment = await createManualCommitment(user.id, session.id, {
        category: "EXECUTION",
        title: `Objective for ${ruleKey}`,
        description: null,
        priority: "HIGH",
        automaticRuleKey: ruleKey,
      });
      // Distinct, deterministic breach counts (1..7) so ranking is unambiguous —
      // one breach per calendar day within the session's own 7-day window
      // (2026-08-03..2026-08-09), never repeating a date on the same commitment.
      for (let b = 0; b <= i; b++) {
        await setCommitmentDailyState(user.id, commitment.id, new Date(`2026-08-${String(3 + b).padStart(2, "0")}T00:00:00.000Z`), "BREACHED");
      }
    }

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.behaviorOccurrenceTrends).toHaveLength(6);
    // The lowest-total rule (index 0, RISK_LIMIT_DISCIPLINE with 1 breach... actually AUTOMATIC_EVIDENCE_RULE_KEYS[0]) is the one dropped.
    const droppedRuleKey = AUTOMATIC_EVIDENCE_RULE_KEYS[0];
    expect(evidence.behaviorOccurrenceTrends.some((t) => t.ruleKey === droppedRuleKey)).toBe(false);
    const note = evidence.truncation.find((t) => t.field === "behaviorOccurrenceTrends");
    expect(note).toEqual({ field: "behaviorOccurrenceTrends", totalAvailable: 7, included: 6, selectionRule: "highest total breach count" });
  });
});

describe("buildTraderReviewEvidencePackage — commitmentBehaviorCrossChecks (Stage 20.1 §9)", () => {
  it("flags CONTRADICTORY when a commitment reads perfect adherence but the same rule breached in this exact period (via a different lineage)", async () => {
    const user = await makeUser("cross-check-contradictory");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });

    const perfectCommitment = await createManualCommitment(user.id, session.id, {
      category: "EXECUTION",
      title: "Perfectly-followed stop discipline",
      description: null,
      priority: "HIGH",
      automaticRuleKey: "STOP_WIDENING_PATTERN",
    });
    await setCommitmentDailyState(user.id, perfectCommitment.id, new Date("2026-08-04T00:00:00.000Z"), "FOLLOWED");
    await setCommitmentDailyState(user.id, perfectCommitment.id, new Date("2026-08-05T00:00:00.000Z"), "FOLLOWED");
    await setCommitmentDailyState(user.id, perfectCommitment.id, new Date("2026-08-06T00:00:00.000Z"), "FOLLOWED");

    const otherCommitment = await createManualCommitment(user.id, session.id, {
      category: "EXECUTION",
      title: "A separate stop-widening objective",
      description: null,
      priority: "HIGH",
      automaticRuleKey: "STOP_WIDENING_PATTERN",
    });
    await setCommitmentDailyState(user.id, otherCommitment.id, new Date("2026-08-07T00:00:00.000Z"), "BREACHED");

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    const crossCheck = evidence.commitmentBehaviorCrossChecks.find((c) => c.commitmentTitle === "Perfectly-followed stop discipline");
    expect(crossCheck).toBeDefined();
    expect(crossCheck?.currentAdherencePercent).toBe(100);
    expect(crossCheck?.signal).toBe("CONTRADICTORY");
    expect(evidence.evidenceIndex[crossCheck!.evidenceId].strength).toBe("DERIVED");
  });

  it("flags CONVERGING when adherence is healthy and the rule's breach counts have been declining across periods", async () => {
    const user = await makeUser("cross-check-converging");
    const sessionA = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-07-27", endDate: "2026-08-02" });
    const commitmentV1 = await createManualCommitment(user.id, sessionA.id, {
      category: "EXECUTION",
      title: "No stop widening",
      description: null,
      priority: "HIGH",
      automaticRuleKey: "STOP_WIDENING_PATTERN",
    });
    for (const d of ["2026-07-27", "2026-07-28", "2026-07-29"]) {
      await setCommitmentDailyState(user.id, commitmentV1.id, new Date(`${d}T00:00:00.000Z`), "BREACHED");
    }

    const sessionB = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitmentV2 = await continueCommitment(user.id, commitmentV1.id, sessionB.id);
    await setCommitmentDailyState(user.id, commitmentV2.id, new Date("2026-08-03T00:00:00.000Z"), "BREACHED");
    for (const d of ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"]) {
      await setCommitmentDailyState(user.id, commitmentV2.id, new Date(`${d}T00:00:00.000Z`), "FOLLOWED");
    }

    const evidence = await buildTraderReviewEvidencePackage(user.id, sessionB.id);
    const trend = evidence.behaviorOccurrenceTrends.find((t) => t.ruleKey === "STOP_WIDENING_PATTERN");
    expect(trend?.points.map((p) => p.breachCount)).toEqual([3, 1]);

    const crossCheck = evidence.commitmentBehaviorCrossChecks.find((c) => c.ruleKey === "STOP_WIDENING_PATTERN");
    expect(crossCheck?.currentAdherencePercent).toBe(90);
    expect(crossCheck?.signal).toBe("CONVERGING");
  });
});

describe("buildTraderReviewEvidencePackage — coverage summary (Stage 20.1 §17)", () => {
  it("reports real included counts and availability flags, not derived from the evidence index", async () => {
    const user = await makeUser("coverage-summary");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await makeTrade(user.id, "2026-08-04", { validationState: "VALIDATED" });
    await makeTrade(user.id, "2026-08-05", { validationState: "OVERRIDDEN" });
    await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "x", description: null, priority: "HIGH" });

    const evidence = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(evidence.coverageSummary.tradesIncluded).toBe(2);
    expect(evidence.coverageSummary.commitmentsIncluded).toBe(1);
    expect(evidence.coverageSummary.replayAvailable).toBe(true); // an empty-but-present Replay comparison
    expect(evidence.coverageSummary.psychologyAvailable).toBe(false);
  });
});
