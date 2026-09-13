import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { completeReplayReviewSession, createReplayReviewSession, finalizeEdgeReview, startReplayReviewSession } from "@/server/services/replay-review.service";
import { generateReviewAnalysis, getLatestReviewAnalysis } from "@/server/services/ai-review-analyst.service";
import type { AnalystOutcome, TraderReviewAnalystProvider, TraderReviewAnalystReport } from "@/domain/ai-review/types";

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `ai-review-analyst-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
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

function stubReport(periodSummary = "Stub summary."): TraderReviewAnalystReport {
  return {
    periodSummary,
    strengths: [],
    concerns: [],
    recurringPatterns: [],
    improvementProgress: [],
    priorityFocus: [{ title: "p", explanation: "e", evidenceIds: [], confidence: "LOW", category: "PROCESS" }],
    questionsForReflection: [],
    evidenceCoverage: { totalEvidenceItems: 0, citedEvidenceItems: 0 },
  };
}

class FakeSuccessProvider implements TraderReviewAnalystProvider {
  readonly name = "fake-success";
  readonly version = "1.0.0";
  constructor(private readonly report: TraderReviewAnalystReport = stubReport()) {}
  isAvailable() {
    return true;
  }
  async analyzeReview(): Promise<AnalystOutcome> {
    return { status: "COMPLETE", report: this.report, provider: this.name, model: "fake-model" };
  }
}

class FakeUnavailableProvider implements TraderReviewAnalystProvider {
  readonly name = "fake-unavailable";
  readonly version = "1.0.0";
  isAvailable() {
    return false;
  }
  async analyzeReview(): Promise<AnalystOutcome> {
    return { status: "FAILED", reason: "PROVIDER_UNAVAILABLE", error: "not configured" };
  }
}

describe("generateReviewAnalysis — persistence (§34-35, §53)", () => {
  it("persists a report scoped to the correct user and session", async () => {
    const user = await makeUser("persist-basic");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });

    const result = await generateReviewAnalysis(user.id, session.id, new FakeSuccessProvider());
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.report.sessionId).toBe(session.id);

    const row = await prisma.aiReviewAnalystReport.findUniqueOrThrow({ where: { id: result.report.id } });
    expect(row.userId).toBe(user.id);
    expect(row.replayReviewSessionId).toBe(session.id);
  });

  it("stores the evidence fingerprint and evidence index alongside the report", async () => {
    const user = await makeUser("persist-fingerprint");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });

    const result = await generateReviewAnalysis(user.id, session.id, new FakeSuccessProvider());
    if (!result.success) throw new Error("unreachable");
    expect(result.report.evidenceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.report.evidenceIndex).toBeDefined();
  });

  it("regeneration creates a NEW row rather than overwriting the previous one", async () => {
    const user = await makeUser("regenerate");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });

    const first = await generateReviewAnalysis(user.id, session.id, new FakeSuccessProvider(stubReport("First.")));
    const second = await generateReviewAnalysis(user.id, session.id, new FakeSuccessProvider(stubReport("Second.")));
    if (!first.success || !second.success) throw new Error("unreachable");

    expect(first.report.id).not.toBe(second.report.id);
    const allRows = await prisma.aiReviewAnalystReport.findMany({ where: { replayReviewSessionId: session.id } });
    expect(allRows).toHaveLength(2);

    // The first row is untouched — historical stability (§34).
    const firstRow = await prisma.aiReviewAnalystReport.findUniqueOrThrow({ where: { id: first.report.id } });
    expect((firstRow.reportJson as unknown as TraderReviewAnalystReport).periodSummary).toBe("First.");
  });

  it("fails without persisting anything when the provider is unavailable", async () => {
    const user = await makeUser("provider-unavailable");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });

    const result = await generateReviewAnalysis(user.id, session.id, new FakeUnavailableProvider());
    expect(result.success).toBe(false);
    const rows = await prisma.aiReviewAnalystReport.findMany({ where: { replayReviewSessionId: session.id } });
    expect(rows).toHaveLength(0);
  });

  it("requires a finalized review — the completed-review relationship is respected (§37)", async () => {
    const user = await makeUser("not-finalized-generate");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await expect(generateReviewAnalysis(user.id, session.id, new FakeSuccessProvider())).rejects.toThrow("Only a finalized review can be analyzed.");
  });
});

describe("getLatestReviewAnalysis — access control and staleness (§36, §53)", () => {
  it("returns null when no report has been generated yet", async () => {
    const user = await makeUser("no-report-yet");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    expect(await getLatestReviewAnalysis(user.id, session.id)).toBeNull();
  });

  it("another user cannot access a report that isn't theirs", async () => {
    const owner = await makeUser("report-owner");
    const other = await makeUser("report-other");
    const session = await finalizedSession(owner.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await generateReviewAnalysis(owner.id, session.id, new FakeSuccessProvider());

    expect(await getLatestReviewAnalysis(other.id, session.id)).toBeNull();
  });

  it("returns the most recent generation, not an older one", async () => {
    const user = await makeUser("latest-wins");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await generateReviewAnalysis(user.id, session.id, new FakeSuccessProvider(stubReport("Older.")));
    await new Promise((r) => setTimeout(r, 5));
    await generateReviewAnalysis(user.id, session.id, new FakeSuccessProvider(stubReport("Newer.")));

    const latest = await getLatestReviewAnalysis(user.id, session.id);
    expect(latest?.report.periodSummary).toBe("Newer.");
  });

  it("is not stale immediately after generation, but becomes stale once the underlying evidence changes", async () => {
    const user = await makeUser("staleness");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await generateReviewAnalysis(user.id, session.id, new FakeSuccessProvider());

    const fresh = await getLatestReviewAnalysis(user.id, session.id);
    expect(fresh?.stale).toBe(false);

    await prisma.trade.create({
      data: {
        userId: user.id,
        tradeDate: new Date("2026-08-04T00:00:00.000Z"),
        executionMinutes: 5,
        direction: "LONG",
        higherTimeframeBias: "BULLISH",
        biasConfidencePercent: 80,
        assetSymbol: "XAUUSD",
        actualRR: 1,
      },
    });

    const staleNow = await getLatestReviewAnalysis(user.id, session.id);
    expect(staleNow?.stale).toBe(true);
  });
});
