import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { computeEvidenceFingerprint } from "@/domain/ai-review/evidence-fingerprint";
import {
  completeReplayReviewSession,
  createReplayReviewSession,
  finalizeEdgeReview,
  startReplayReviewSession,
} from "@/server/services/replay-review.service";
import { createManualCommitment, setCommitmentDailyState } from "@/server/services/edge-review-commitment.service";
import { buildTraderReviewEvidencePackage } from "@/server/services/ai-review-evidence.service";

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
