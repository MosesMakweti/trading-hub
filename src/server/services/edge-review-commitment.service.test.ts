import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createManualCommitmentSchema } from "@/lib/validation/edge";
import {
  completeReplayReviewSession,
  createReplayReviewSession,
  finalizeEdgeReview,
  reopenReplayReviewSession,
  startReplayReviewSession,
} from "@/server/services/replay-review.service";
import {
  acceptSuggestedCommitment,
  buildImprovementAnalytics,
  continueCommitment,
  createManualCommitment,
  getActiveCommitmentsForToday,
  getAdherenceSummaries,
  getCommitmentDailyStates,
  getCommitmentLineage,
  getContextualReminder,
  listCommitmentsForSession,
  refineCommitment,
  setCommitmentDailyState,
  setCommitmentStatus,
  syncSystemEvidenceForSession,
  updateCommitment,
} from "@/server/services/edge-review-commitment.service";

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `commitment-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
  userIds.push(user.id);
  return user;
}

afterAll(async () => {
  // TradeAccountAllocation has no cascade from TradingAccount, so the
  // Stage 19.1 risk-limit tests' allocations must be cleared explicitly
  // before the user (and its trades/accounts) can be deleted.
  await prisma.tradeAccountAllocation.deleteMany({ where: { tradingAccount: { userId: { in: userIds } } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

async function finalizedSession(userId: string, params: { reviewType: "WEEKLY" | "MONTHLY"; startDate: string; endDate: string }) {
  const session = await createReplayReviewSession(userId, params);
  await startReplayReviewSession(userId, session.id);
  await completeReplayReviewSession(userId, session.id);
  await finalizeEdgeReview(userId, session.id);
  return session;
}

describe("commitment CRUD", () => {
  it("creates a manual commitment, denormalizing reviewType/periodStart from the session", async () => {
    const user = await makeUser("create");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, session.id, {
      category: "EXECUTION",
      title: "No SL widening",
      description: null,
      priority: "HIGH",
    });
    expect(commitment.reviewType).toBe("WEEKLY");
    expect(commitment.periodStart).toBe("2026-08-03");
    expect(commitment.status).toBe("ACTIVE");
    expect(commitment.source).toBe("MANUAL");
  });

  it("accepts a suggested commitment, freezing ruleKey/evidence", async () => {
    const user = await makeUser("accept-suggestion");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await acceptSuggestedCommitment(user.id, session.id, {
      category: "EXECUTION",
      title: "Do not widen the stop after entry",
      description: "desc",
      priority: "MEDIUM",
      ruleKey: "STOP_WIDENING_PATTERN",
      evidence: ["3 occurrences this period"],
    });
    expect(commitment.source).toBe("SUGGESTED");
    expect(commitment.sourceFindingType).toBe("STOP_WIDENING_PATTERN");
    expect(commitment.evidenceSnapshot).toEqual(["3 occurrences this period"]);
  });

  it("edits title/description/category/priority", async () => {
    const user = await makeUser("edit");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, session.id, { category: "PROCESS", title: "Original", description: null, priority: "LOW" });

    await updateCommitment(user.id, commitment.id, { title: "Edited", priority: "HIGH" });
    const [reloaded] = await listCommitmentsForSession(user.id, session.id);
    expect(reloaded.title).toBe("Edited");
    expect(reloaded.priority).toBe("HIGH");
    expect(reloaded.category).toBe("PROCESS"); // untouched field preserved
  });

  it("transitions ACTIVE -> COMPLETED -> ACTIVE, stamping/clearing completedAt correctly", async () => {
    const user = await makeUser("lifecycle");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, session.id, { category: "RISK", title: "Stop after cap", description: null, priority: "HIGH" });

    await setCommitmentStatus(user.id, commitment.id, "COMPLETED");
    let [reloaded] = await listCommitmentsForSession(user.id, session.id);
    expect(reloaded.status).toBe("COMPLETED");
    expect(reloaded.completedAt).not.toBeNull();

    await setCommitmentStatus(user.id, commitment.id, "ACTIVE");
    [reloaded] = await listCommitmentsForSession(user.id, session.id);
    expect(reloaded.status).toBe("ACTIVE");
    expect(reloaded.completedAt).toBeNull();
  });

  it("RETIRED is distinct from COMPLETED", async () => {
    const user = await makeUser("retire");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, session.id, { category: "BEHAVIOR", title: "x", description: null, priority: "MEDIUM" });

    await setCommitmentStatus(user.id, commitment.id, "RETIRED");
    const [reloaded] = await listCommitmentsForSession(user.id, session.id);
    expect(reloaded.status).toBe("RETIRED");
    expect(reloaded.retiredAt).not.toBeNull();
    expect(reloaded.completedAt).toBeNull();
  });

  it("rejects editing/status-changing another user's commitment", async () => {
    const owner = await makeUser("commit-owner");
    const attacker = await makeUser("commit-attacker");
    const session = await createReplayReviewSession(owner.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(owner.id, session.id, { category: "EXECUTION", title: "x", description: null, priority: "MEDIUM" });

    await expect(updateCommitment(attacker.id, commitment.id, { title: "hacked" })).rejects.toThrow();
    await expect(setCommitmentStatus(attacker.id, commitment.id, "RETIRED")).rejects.toThrow();
  });

  it("persists across reload (re-fetched from a fresh query)", async () => {
    const user = await makeUser("persist");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const created = await createManualCommitment(user.id, session.id, { category: "STRATEGY", title: "Persisted", description: null, priority: "LOW" });

    const reloaded = await listCommitmentsForSession(user.id, session.id);
    expect(reloaded.find((c) => c.id === created.id)?.title).toBe("Persisted");
  });
});

describe("Today carry-forward (Stage 16 §15-16)", () => {
  it("surfaces ACTIVE commitments from the latest FINALIZED weekly review", async () => {
    const user = await makeUser("carry-forward-weekly");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "Weekly focus", description: null, priority: "HIGH" });

    const today = await getActiveCommitmentsForToday(user.id);
    expect(today.weekly.map((c) => c.title)).toEqual(["Weekly focus"]);
    expect(today.monthly).toEqual([]);
  });

  it("does not surface commitments from a non-finalized (COMPLETED-only) session", async () => {
    const user = await makeUser("not-finalized");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await startReplayReviewSession(user.id, session.id);
    await completeReplayReviewSession(user.id, session.id); // Replay completed, but review NOT finished
    await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "Not yet", description: null, priority: "HIGH" });

    const today = await getActiveCommitmentsForToday(user.id);
    expect(today.weekly).toEqual([]);
  });

  it("a newer finalized weekly review supersedes an older one", async () => {
    const user = await makeUser("supersede");
    const week1 = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await createManualCommitment(user.id, week1.id, { category: "EXECUTION", title: "Old focus", description: null, priority: "HIGH" });

    const week2 = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });
    await createManualCommitment(user.id, week2.id, { category: "PROCESS", title: "New focus", description: null, priority: "HIGH" });

    const today = await getActiveCommitmentsForToday(user.id);
    expect(today.weekly.map((c) => c.title)).toEqual(["New focus"]);

    // The old session's own commitments remain visible from its own Edge Review page.
    const oldReview = await listCommitmentsForSession(user.id, week1.id);
    expect(oldReview.map((c) => c.title)).toEqual(["Old focus"]);
  });

  it("completed commitments do not surface even from the latest finalized review", async () => {
    const user = await makeUser("completed-not-surfaced");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "Done already", description: null, priority: "HIGH" });
    await setCommitmentStatus(user.id, commitment.id, "COMPLETED");

    const today = await getActiveCommitmentsForToday(user.id);
    expect(today.weekly).toEqual([]);
  });

  it("retired commitments do not surface", async () => {
    const user = await makeUser("retired-not-surfaced");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "Retired", description: null, priority: "HIGH" });
    await setCommitmentStatus(user.id, commitment.id, "RETIRED");

    const today = await getActiveCommitmentsForToday(user.id);
    expect(today.weekly).toEqual([]);
  });

  it("weekly and monthly are independent, non-merged groups", async () => {
    const user = await makeUser("weekly-monthly-independent");
    const weekly = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await createManualCommitment(user.id, weekly.id, { category: "EXECUTION", title: "Weekly one", description: null, priority: "HIGH" });
    const monthly = await finalizedSession(user.id, { reviewType: "MONTHLY", startDate: "2026-08-01", endDate: "2026-08-31" });
    await createManualCommitment(user.id, monthly.id, { category: "STRATEGY", title: "Monthly one", description: null, priority: "HIGH" });

    const today = await getActiveCommitmentsForToday(user.id);
    expect(today.weekly.map((c) => c.title)).toEqual(["Weekly one"]);
    expect(today.monthly.map((c) => c.title)).toEqual(["Monthly one"]);
  });

  it("reopening Replay revokes finalization, removing the review's commitments from Today until re-finalized", async () => {
    const user = await makeUser("reopen-revokes");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "x", description: null, priority: "HIGH" });
    expect((await getActiveCommitmentsForToday(user.id)).weekly).toHaveLength(1);

    await reopenReplayReviewSession(user.id, session.id);
    expect((await getActiveCommitmentsForToday(user.id)).weekly).toHaveLength(0);

    await completeReplayReviewSession(user.id, session.id);
    await finalizeEdgeReview(user.id, session.id);
    expect((await getActiveCommitmentsForToday(user.id)).weekly).toHaveLength(1);
  });
});

describe("daily acknowledgement (Stage 16 §18)", () => {
  it("stores a per-day state separately, never touching the commitment record", async () => {
    const user = await makeUser("daily-ack");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "x", description: null, priority: "HIGH" });
    const before = await prisma.edgeReviewCommitment.findUniqueOrThrow({ where: { id: commitment.id } });

    await setCommitmentDailyState(user.id, commitment.id, new Date("2026-08-10T00:00:00.000Z"), "FOLLOWED");

    const after = await prisma.edgeReviewCommitment.findUniqueOrThrow({ where: { id: commitment.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    const states = await getCommitmentDailyStates(user.id, [commitment.id], new Date("2026-08-10T00:00:00.000Z"));
    expect(states.get(commitment.id)).toBe("FOLLOWED");
  });

  it("upserts — changing the state for the same day updates in place", async () => {
    const user = await makeUser("daily-ack-upsert");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "x", description: null, priority: "HIGH" });

    await setCommitmentDailyState(user.id, commitment.id, new Date("2026-08-10T00:00:00.000Z"), "ACKNOWLEDGED");
    await setCommitmentDailyState(user.id, commitment.id, new Date("2026-08-10T00:00:00.000Z"), "BREACHED");

    const rows = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { commitmentId: commitment.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("BREACHED");
  });
});

function makeTrade(userId: string, dateKey: string, validationState: "VALIDATED" | "OVERRIDDEN") {
  return prisma.trade.create({
    data: {
      userId,
      tradeDate: new Date(`${dateKey}T00:00:00.000Z`),
      executionMinutes: 5,
      direction: "LONG",
      higherTimeframeBias: "BULLISH",
      biasConfidencePercent: 80,
      assetSymbol: "XAUUSD",
      validationState,
    },
  });
}

describe("cross-period continuity — lineage, Continue, Refine (Stage 19 §3-14)", () => {
  it("Continue retires the previous commitment and creates a successor inheriting the lineage root", async () => {
    const user = await makeUser("continue-basic");
    const week1 = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const original = await createManualCommitment(user.id, week1.id, { category: "EXECUTION", title: "No SL widening", description: null, priority: "HIGH" });
    expect(original.lineageId).toBeNull();

    const week2 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });
    const continued = await continueCommitment(user.id, original.id, week2.id);

    expect(continued.previousCommitmentId).toBe(original.id);
    expect(continued.lineageId).toBe(original.id); // inherits the ROOT id, not the previous segment's own lineageId
    expect(continued.title).toBe("No SL widening");
    expect(continued.status).toBe("ACTIVE");

    const [reloadedOriginal] = await listCommitmentsForSession(user.id, week1.id);
    expect(reloadedOriginal.status).toBe("RETIRED");
    expect(reloadedOriginal.retiredAt).not.toBeNull();
  });

  it("Refine carries the lineage forward while changing wording, preserving the prior wording on the retired predecessor", async () => {
    const user = await makeUser("refine-basic");
    const week1 = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const original = await createManualCommitment(user.id, week1.id, { category: "PROCESS", title: "Original wording", description: null, priority: "MEDIUM" });

    const week2 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });
    const refined = await refineCommitment(user.id, original.id, week2.id, { category: "PROCESS", title: "Refined wording", description: "tightened scope", priority: "HIGH" });

    expect(refined.title).toBe("Refined wording");
    expect(refined.lineageId).toBe(original.id);

    const [reloadedOriginal] = await listCommitmentsForSession(user.id, week1.id);
    expect(reloadedOriginal.title).toBe("Original wording"); // never rewritten
    expect(reloadedOriginal.status).toBe("RETIRED");
  });

  it("rejects continuing a commitment that is not ACTIVE (e.g. already retired)", async () => {
    const user = await makeUser("continue-inactive");
    const week1 = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const original = await createManualCommitment(user.id, week1.id, { category: "EXECUTION", title: "x", description: null, priority: "HIGH" });
    await setCommitmentStatus(user.id, original.id, "RETIRED");

    const week2 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });
    await expect(continueCommitment(user.id, original.id, week2.id)).rejects.toThrow();
  });

  it("rejects continuing another user's commitment", async () => {
    const owner = await makeUser("lineage-owner");
    const attacker = await makeUser("lineage-attacker");
    const week1 = await finalizedSession(owner.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const original = await createManualCommitment(owner.id, week1.id, { category: "EXECUTION", title: "x", description: null, priority: "HIGH" });
    const week2 = await createReplayReviewSession(attacker.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });

    await expect(continueCommitment(attacker.id, original.id, week2.id)).rejects.toThrow();
  });

  it("getCommitmentLineage aggregates adherence across every segment as one lifetime, and per-segment for current/previous", async () => {
    const user = await makeUser("lineage-adherence");
    const week1 = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const seg1 = await createManualCommitment(user.id, week1.id, { category: "EXECUTION", title: "No SL widening", description: null, priority: "HIGH" });
    await setCommitmentDailyState(user.id, seg1.id, new Date("2026-08-04T00:00:00.000Z"), "FOLLOWED");
    await setCommitmentDailyState(user.id, seg1.id, new Date("2026-08-05T00:00:00.000Z"), "BREACHED");

    const week2 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });
    const seg2 = await continueCommitment(user.id, seg1.id, week2.id);
    await setCommitmentDailyState(user.id, seg2.id, new Date("2026-08-11T00:00:00.000Z"), "FOLLOWED");
    await setCommitmentDailyState(user.id, seg2.id, new Date("2026-08-12T00:00:00.000Z"), "FOLLOWED");

    const lineage = await getCommitmentLineage(user.id, seg2.id);
    expect(lineage.lineageId).toBe(seg1.id);
    expect(lineage.headCommitmentId).toBe(seg2.id);
    expect(lineage.segments).toHaveLength(2);
    expect(lineage.segments[0].adherence.applicableObservations).toBe(2);
    expect(lineage.segments[0].retirementReason).toBe("SUPERSEDED");
    expect(lineage.current.applicableObservations).toBe(2); // seg2 only
    expect(lineage.current.adherencePercent).toBe(100);
    expect(lineage.previous?.applicableObservations).toBe(2); // seg1 only
    expect(lineage.previous?.adherencePercent).toBe(50);
    expect(lineage.lifetime.applicableObservations).toBe(4); // both segments combined
  });

  it("a genuinely dismissed (never continued) commitment reports retirementReason DISMISSED, not SUPERSEDED", async () => {
    const user = await makeUser("lineage-dismissed");
    const week1 = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, week1.id, { category: "EXECUTION", title: "x", description: null, priority: "HIGH" });
    await setCommitmentStatus(user.id, commitment.id, "RETIRED");

    const lineage = await getCommitmentLineage(user.id, commitment.id);
    expect(lineage.segments).toHaveLength(1);
    expect(lineage.segments[0].retirementReason).toBe("DISMISSED");
  });

  it("resolution eligibility is a suggestion only — an insufficient lifetime sample never flips it true, and it never mutates status", async () => {
    const user = await makeUser("lineage-resolution");
    const week1 = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, week1.id, { category: "EXECUTION", title: "x", description: null, priority: "HIGH" });
    await setCommitmentDailyState(user.id, commitment.id, new Date("2026-08-04T00:00:00.000Z"), "FOLLOWED");

    const lineage = await getCommitmentLineage(user.id, commitment.id);
    expect(lineage.resolutionEligible).toBe(false);

    const [reloaded] = await listCommitmentsForSession(user.id, week1.id);
    expect(reloaded.status).toBe("ACTIVE"); // untouched by the read
  });
});

describe("Today dedup across weekly/monthly by lineage (Stage 19 §17/§27/§28)", () => {
  it("drops a monthly commitment sharing the same deterministic ruleKey as an already-surfaced weekly commitment", async () => {
    const user = await makeUser("dedup-rulekey");
    const week1 = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await acceptSuggestedCommitment(user.id, week1.id, {
      category: "EXECUTION",
      title: "No stop widening (weekly)",
      description: null,
      priority: "HIGH",
      ruleKey: "STOP_WIDENING_PATTERN",
      evidence: ["seed"],
    });

    // An overlapping monthly review independently surfaces + the trader
    // accepts the SAME deterministic finding as its own separate commitment.
    const monthlySession = await finalizedSession(user.id, { reviewType: "MONTHLY", startDate: "2026-08-01", endDate: "2026-08-31" });
    await acceptSuggestedCommitment(user.id, monthlySession.id, {
      category: "EXECUTION",
      title: "No stop widening (monthly)",
      description: null,
      priority: "HIGH",
      ruleKey: "STOP_WIDENING_PATTERN",
      evidence: ["seed"],
    });

    const today = await getActiveCommitmentsForToday(user.id);
    expect(today.weekly.map((c) => c.title)).toEqual(["No stop widening (weekly)"]);
    expect(today.monthly).toEqual([]); // deduped — same ruleKey identity already shown under weekly
  });

  it("a continued lineage's single active head only ever appears under its own current reviewType, never duplicated", async () => {
    const user = await makeUser("dedup-lineage-single-head");
    const week1 = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const original = await createManualCommitment(user.id, week1.id, { category: "EXECUTION", title: "Shared objective", description: null, priority: "HIGH" });

    const monthlySession = await finalizedSession(user.id, { reviewType: "MONTHLY", startDate: "2026-08-01", endDate: "2026-08-31" });
    const continued = await continueCommitment(user.id, original.id, monthlySession.id);

    const today = await getActiveCommitmentsForToday(user.id);
    // The original was retired by Continue — only the new MONTHLY head is ACTIVE.
    expect(today.weekly).toEqual([]);
    expect(today.monthly.map((c) => c.id)).toEqual([continued.id]);
  });

  it("an unrelated monthly commitment (different lineage) is unaffected by dedup", async () => {
    const user = await makeUser("dedup-unrelated");
    const week1 = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await createManualCommitment(user.id, week1.id, { category: "EXECUTION", title: "Weekly objective", description: null, priority: "HIGH" });
    const monthlySession = await finalizedSession(user.id, { reviewType: "MONTHLY", startDate: "2026-08-01", endDate: "2026-08-31" });
    await createManualCommitment(user.id, monthlySession.id, { category: "STRATEGY", title: "Monthly objective", description: null, priority: "HIGH" });

    const today = await getActiveCommitmentsForToday(user.id);
    expect(today.weekly.map((c) => c.title)).toEqual(["Weekly objective"]);
    expect(today.monthly.map((c) => c.title)).toEqual(["Monthly objective"]);
  });
});

describe("getAdherenceSummaries — bulk, N+1-safe (Stage 19 §12)", () => {
  it("returns current-period adherence/trend keyed by the id the caller passed in, across multiple lineages in two queries", async () => {
    const user = await makeUser("bulk-adherence");
    const week1 = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const a1 = await createManualCommitment(user.id, week1.id, { category: "EXECUTION", title: "A", description: null, priority: "HIGH" });
    const b1 = await createManualCommitment(user.id, week1.id, { category: "PROCESS", title: "B", description: null, priority: "HIGH" });
    await setCommitmentDailyState(user.id, a1.id, new Date("2026-08-04T00:00:00.000Z"), "FOLLOWED");
    await setCommitmentDailyState(user.id, b1.id, new Date("2026-08-04T00:00:00.000Z"), "BREACHED");

    const week2 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });
    const a2 = await continueCommitment(user.id, a1.id, week2.id);
    await setCommitmentDailyState(user.id, a2.id, new Date("2026-08-11T00:00:00.000Z"), "FOLLOWED");

    const summaries = await getAdherenceSummaries(user.id, [
      { id: a2.id, lineageId: a2.lineageId },
      { id: b1.id, lineageId: b1.lineageId },
    ]);

    expect(summaries.get(a2.id)?.current.applicableObservations).toBe(1); // a2's own segment only
    expect(summaries.get(a2.id)?.current.adherencePercent).toBe(100);
    expect(summaries.get(b1.id)?.current.applicableObservations).toBe(1);
    expect(summaries.get(b1.id)?.current.adherencePercent).toBe(0);
  });

  it("returns an empty map for an empty input without querying", async () => {
    const user = await makeUser("bulk-adherence-empty");
    const summaries = await getAdherenceSummaries(user.id, []);
    expect(summaries.size).toBe(0);
  });
});

describe("automatic system evidence (Stage 19 §10-11, §16, §21, §42)", () => {
  it("derives OVERRIDE_DISCIPLINE daily states from real Trade.validationState at finalization, without any Replay dependency", async () => {
    const user = await makeUser("system-evidence-override");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await acceptSuggestedCommitment(user.id, week1.id, {
      category: "EXECUTION",
      title: "Only take validated setups",
      description: null,
      priority: "HIGH",
      ruleKey: "OVERRIDE_DISCIPLINE",
      evidence: ["seed"],
    });
    await makeTrade(user.id, "2026-08-04", "VALIDATED");
    await makeTrade(user.id, "2026-08-05", "OVERRIDDEN");

    await startReplayReviewSession(user.id, week1.id);
    await completeReplayReviewSession(user.id, week1.id);
    await finalizeEdgeReview(user.id, week1.id); // triggers syncSystemEvidenceForSession internally

    const states = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { userId: user.id }, orderBy: { dateKey: "asc" } });
    expect(states).toHaveLength(2);
    expect(states[0].status).toBe("FOLLOWED");
    expect(states[0].source).toBe("SYSTEM");
    expect(states[1].status).toBe("BREACHED");
    expect(states[1].relatedTradeId).not.toBeNull();
  });

  it("never overwrites an existing MANUAL entry for the same day (skipDuplicates)", async () => {
    const user = await makeUser("system-evidence-no-overwrite");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await acceptSuggestedCommitment(user.id, week1.id, {
      category: "EXECUTION",
      title: "Only take validated setups",
      description: null,
      priority: "HIGH",
      ruleKey: "OVERRIDE_DISCIPLINE",
      evidence: ["seed"],
    });
    // Trader manually logs the day as FOLLOWED before the automatic sync runs.
    await setCommitmentDailyState(user.id, commitment.id, new Date("2026-08-05T00:00:00.000Z"), "FOLLOWED", "I skipped the override, took the plan instead.");
    await makeTrade(user.id, "2026-08-05", "OVERRIDDEN"); // would otherwise derive BREACHED

    await syncSystemEvidenceForSession(user.id, week1.id);

    const row = await prisma.edgeReviewCommitmentDailyState.findFirstOrThrow({ where: { commitmentId: commitment.id } });
    expect(row.status).toBe("FOLLOWED");
    expect(row.source).toBe("MANUAL");
    expect(row.note).toBe("I skipped the override, took the plan instead.");
  });

  it("a manual write after a SYSTEM entry always wins and clears the stale automated evidence", async () => {
    const user = await makeUser("system-evidence-manual-overwrite");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await acceptSuggestedCommitment(user.id, week1.id, {
      category: "EXECUTION",
      title: "Only take validated setups",
      description: null,
      priority: "HIGH",
      ruleKey: "OVERRIDE_DISCIPLINE",
      evidence: ["seed"],
    });
    await makeTrade(user.id, "2026-08-05", "OVERRIDDEN");
    await syncSystemEvidenceForSession(user.id, week1.id);

    let row = await prisma.edgeReviewCommitmentDailyState.findFirstOrThrow({ where: { commitmentId: commitment.id } });
    expect(row.source).toBe("SYSTEM");

    await setCommitmentDailyState(user.id, commitment.id, new Date("2026-08-05T00:00:00.000Z"), "FOLLOWED");
    row = await prisma.edgeReviewCommitmentDailyState.findFirstOrThrow({ where: { commitmentId: commitment.id } });
    expect(row.source).toBe("MANUAL");
    expect(row.status).toBe("FOLLOWED");
    expect(row.evidence).toBeNull();
    expect(row.relatedTradeId).toBeNull();
  });

  it("never derives evidence for a commitment without a recognized automatic rule key (a plain manual commitment)", async () => {
    const user = await makeUser("system-evidence-manual-commitment");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await createManualCommitment(user.id, week1.id, { category: "EXECUTION", title: "No SL widening", description: null, priority: "HIGH" });
    await makeTrade(user.id, "2026-08-05", "OVERRIDDEN");

    await syncSystemEvidenceForSession(user.id, week1.id);

    const states = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { userId: user.id } });
    expect(states).toHaveLength(0);
  });

  it("never backdates evidence to before the commitment's own periodStart", async () => {
    const user = await makeUser("system-evidence-no-backdate");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });
    await acceptSuggestedCommitment(user.id, week1.id, {
      category: "EXECUTION",
      title: "Only take validated setups",
      description: null,
      priority: "HIGH",
      ruleKey: "OVERRIDE_DISCIPLINE",
      evidence: ["seed"],
    });
    // A trade dated before this commitment's own period even started.
    await makeTrade(user.id, "2026-08-05", "OVERRIDDEN");

    await syncSystemEvidenceForSession(user.id, week1.id);

    const states = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { userId: user.id } });
    expect(states).toHaveLength(0);
  });

  it("is idempotent and safe to call twice — running finalization sync again does not error or duplicate rows", async () => {
    const user = await makeUser("system-evidence-idempotent");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await acceptSuggestedCommitment(user.id, week1.id, {
      category: "EXECUTION",
      title: "Only take validated setups",
      description: null,
      priority: "HIGH",
      ruleKey: "OVERRIDE_DISCIPLINE",
      evidence: ["seed"],
    });
    await makeTrade(user.id, "2026-08-05", "OVERRIDDEN");

    await syncSystemEvidenceForSession(user.id, week1.id);
    await syncSystemEvidenceForSession(user.id, week1.id);

    const states = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { userId: user.id } });
    expect(states).toHaveLength(1);
  });

  it("degrades gracefully when the comparison cannot be built (no ACTUAL baseline yet) instead of throwing", async () => {
    const user = await makeUser("system-evidence-degrade");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await acceptSuggestedCommitment(user.id, week1.id, {
      category: "EXECUTION",
      title: "No stop widening",
      description: null,
      priority: "HIGH",
      ruleKey: "STOP_WIDENING_PATTERN",
      evidence: ["seed"],
    });

    await expect(syncSystemEvidenceForSession(user.id, week1.id)).resolves.toBeUndefined();
    const states = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { userId: user.id } });
    expect(states).toHaveLength(0);
  });
});

function makePlainTrade(userId: string, dateKey: string) {
  return prisma.trade.create({
    data: {
      userId,
      tradeDate: new Date(`${dateKey}T00:00:00.000Z`),
      executionMinutes: 5,
      direction: "LONG",
      higherTimeframeBias: "BULLISH",
      biasConfidencePercent: 80,
      assetSymbol: "XAUUSD",
    },
  });
}

async function makeTradingDay(userId: string, dateKey: string, boundaries: { maxTradesPerDay?: number; riskBudgetPercent?: number }) {
  return prisma.tradingDay.upsert({
    where: { userId_date: { userId, date: new Date(`${dateKey}T00:00:00.000Z`) } },
    create: { userId, date: new Date(`${dateKey}T00:00:00.000Z`), ...boundaries },
    update: boundaries,
  });
}

async function makePerformanceAccount(userId: string) {
  return prisma.tradingAccount.create({ data: { userId, kind: "PERFORMANCE", name: "Performance" } });
}

function allocatePercentRisk(tradeId: string, tradingAccountId: string, riskValue: number) {
  return prisma.tradeAccountAllocation.create({
    data: { tradeId, tradingAccountId, riskInputType: "PERCENT", riskValue, closingPnlGross: 0, closingPnlNet: 0 },
  });
}

describe("automatic system evidence — Stage 19.1 additions (§25-29)", () => {
  it("BEHAVIOUR_LABEL_PATTERN is wired but produces no rows without a comparison, without throwing", async () => {
    const user = await makeUser("system-evidence-behaviour-label-degrade");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await acceptSuggestedCommitment(user.id, week1.id, {
      category: "BEHAVIOR",
      title: "Review flagged behaviour pattern",
      description: null,
      priority: "MEDIUM",
      ruleKey: "BEHAVIOUR_LABEL_PATTERN",
      evidence: ["seed"],
    });

    await expect(syncSystemEvidenceForSession(user.id, week1.id)).resolves.toBeUndefined();
    const states = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { userId: user.id } });
    expect(states).toHaveLength(0);
  });

  it("OVERTRADING_DISCIPLINE derives from the Daily Market Plan's own maxTradesPerDay vs. actual trade count", async () => {
    const user = await makeUser("system-evidence-overtrading");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, week1.id, {
      category: "BEHAVIOR",
      title: "Respect the daily trade cap",
      description: null,
      priority: "HIGH",
      automaticRuleKey: "OVERTRADING_DISCIPLINE",
    });

    await makeTradingDay(user.id, "2026-08-04", { maxTradesPerDay: 2 });
    await makePlainTrade(user.id, "2026-08-04");
    await makePlainTrade(user.id, "2026-08-04"); // 2 trades, within cap of 2

    await makeTradingDay(user.id, "2026-08-05", { maxTradesPerDay: 1 });
    await makePlainTrade(user.id, "2026-08-05");
    await makePlainTrade(user.id, "2026-08-05"); // 2 trades, exceeds cap of 1

    await makeTradingDay(user.id, "2026-08-06", { maxTradesPerDay: 5 }); // no trades — not applicable

    await syncSystemEvidenceForSession(user.id, week1.id);

    const states = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { commitmentId: commitment.id }, orderBy: { dateKey: "asc" } });
    expect(states).toHaveLength(2); // the zero-trade day never counts as evidence
    expect(states[0].status).toBe("FOLLOWED");
    expect(states[0].source).toBe("SYSTEM");
    expect(states[1].status).toBe("BREACHED");
  });

  it("RISK_LIMIT_DISCIPLINE derives from the Daily Market Plan's own riskBudgetPercent vs. actual percent-based risk used", async () => {
    const user = await makeUser("system-evidence-risk-limit");
    const account = await makePerformanceAccount(user.id);
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, week1.id, {
      category: "RISK",
      title: "Stay within the daily risk budget",
      description: null,
      priority: "HIGH",
      automaticRuleKey: "RISK_LIMIT_DISCIPLINE",
    });

    await makeTradingDay(user.id, "2026-08-04", { riskBudgetPercent: 2 });
    const withinBudgetTrade = await makePlainTrade(user.id, "2026-08-04");
    await allocatePercentRisk(withinBudgetTrade.id, account.id, 1.5);

    await makeTradingDay(user.id, "2026-08-05", { riskBudgetPercent: 2 });
    const overBudgetTrade = await makePlainTrade(user.id, "2026-08-05");
    await allocatePercentRisk(overBudgetTrade.id, account.id, 3);

    await syncSystemEvidenceForSession(user.id, week1.id);

    const states = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { commitmentId: commitment.id }, orderBy: { dateKey: "asc" } });
    expect(states).toHaveLength(2);
    expect(states[0].status).toBe("FOLLOWED");
    expect(states[1].status).toBe("BREACHED");
  });

  it("RISK_LIMIT_DISCIPLINE excludes a day whose risk cannot be reliably measured (a non-percent allocation) rather than guessing", async () => {
    const user = await makeUser("system-evidence-risk-unmeasurable");
    const account = await makePerformanceAccount(user.id);
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, week1.id, {
      category: "RISK",
      title: "Stay within the daily risk budget",
      description: null,
      priority: "HIGH",
      automaticRuleKey: "RISK_LIMIT_DISCIPLINE",
    });

    await makeTradingDay(user.id, "2026-08-04", { riskBudgetPercent: 2 });
    const trade = await makePlainTrade(user.id, "2026-08-04");
    await prisma.tradeAccountAllocation.create({
      data: { tradeId: trade.id, tradingAccountId: account.id, riskInputType: "AMOUNT", riskValue: 500, closingPnlGross: 0, closingPnlNet: 0 },
    });

    await syncSystemEvidenceForSession(user.id, week1.id);

    const states = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { commitmentId: commitment.id } });
    expect(states).toHaveLength(0);
  });

  it("a manually-created commitment can opt into automatic tracking, and source stays MANUAL", async () => {
    const user = await makeUser("system-evidence-manual-opt-in");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const commitment = await createManualCommitment(user.id, week1.id, {
      category: "BEHAVIOR",
      title: "My own wording for overtrading",
      description: null,
      priority: "HIGH",
      automaticRuleKey: "OVERTRADING_DISCIPLINE",
    });
    expect(commitment.source).toBe("MANUAL");
    expect(commitment.sourceFindingType).toBe("OVERTRADING_DISCIPLINE");
  });

  it("rejects an automaticRuleKey outside the known deterministic set at the validation layer", () => {
    const result = createManualCommitmentSchema.safeParse({
      category: "BEHAVIOR",
      title: "x",
      automaticRuleKey: "SOME_ARBITRARY_TEXT_A_TRADER_TYPED",
    });
    expect(result.success).toBe(false);
  });

  it("is idempotent — re-running overtrading/risk-limit sync twice never duplicates rows", async () => {
    const user = await makeUser("system-evidence-idempotent-new-rules");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await createManualCommitment(user.id, week1.id, {
      category: "BEHAVIOR",
      title: "Respect the daily trade cap",
      description: null,
      priority: "HIGH",
      automaticRuleKey: "OVERTRADING_DISCIPLINE",
    });
    await makeTradingDay(user.id, "2026-08-04", { maxTradesPerDay: 1 });
    await makePlainTrade(user.id, "2026-08-04");
    await makePlainTrade(user.id, "2026-08-04");

    await syncSystemEvidenceForSession(user.id, week1.id);
    await syncSystemEvidenceForSession(user.id, week1.id);

    const states = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { userId: user.id } });
    expect(states).toHaveLength(1);
  });
});

describe("getContextualReminder — Stage 19.1 §3-7", () => {
  it("returns the active commitment matching one of the given rule keys", async () => {
    const user = await makeUser("reminder-match");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await acceptSuggestedCommitment(user.id, session.id, {
      category: "BEHAVIOR",
      title: "Avoid discretionary invalid-setup overrides",
      description: null,
      priority: "HIGH",
      ruleKey: "OVERRIDE_DISCIPLINE",
      evidence: ["seed"],
    });

    const reminder = await getContextualReminder(user.id, ["OVERRIDE_DISCIPLINE"]);
    expect(reminder?.title).toBe("Avoid discretionary invalid-setup overrides");
  });

  it("returns null when no active commitment matches any of the given rule keys", async () => {
    const user = await makeUser("reminder-no-match");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await createManualCommitment(user.id, session.id, { category: "PROCESS", title: "Unrelated commitment", description: null, priority: "MEDIUM" });

    expect(await getContextualReminder(user.id, ["OVERRIDE_DISCIPLINE"])).toBeNull();
  });

  it("suppresses a duplicate reminder for the same lineage/ruleKey surfaced via both weekly and monthly (reuses Today's own dedup)", async () => {
    const user = await makeUser("reminder-dedup");
    const weekly = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await acceptSuggestedCommitment(user.id, weekly.id, {
      category: "BEHAVIOR",
      title: "Weekly override commitment",
      description: null,
      priority: "HIGH",
      ruleKey: "OVERRIDE_DISCIPLINE",
      evidence: ["seed"],
    });
    const monthly = await finalizedSession(user.id, { reviewType: "MONTHLY", startDate: "2026-08-01", endDate: "2026-08-31" });
    await acceptSuggestedCommitment(user.id, monthly.id, {
      category: "BEHAVIOR",
      title: "Monthly override commitment",
      description: null,
      priority: "HIGH",
      ruleKey: "OVERRIDE_DISCIPLINE",
      evidence: ["seed"],
    });

    const reminder = await getContextualReminder(user.id, ["OVERRIDE_DISCIPLINE"]);
    // Exactly one reminder is returned (weekly wins) — never two for the same rule.
    expect(reminder?.title).toBe("Weekly override commitment");
  });

  it("displaying a reminder creates no daily state / observation", async () => {
    const user = await makeUser("reminder-no-observation");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await acceptSuggestedCommitment(user.id, session.id, {
      category: "BEHAVIOR",
      title: "Avoid discretionary invalid-setup overrides",
      description: null,
      priority: "HIGH",
      ruleKey: "OVERRIDE_DISCIPLINE",
      evidence: ["seed"],
    });

    await getContextualReminder(user.id, ["OVERRIDE_DISCIPLINE"]);
    await getContextualReminder(user.id, ["OVERRIDE_DISCIPLINE"]);
    const states = await prisma.edgeReviewCommitmentDailyState.findMany({ where: { userId: user.id } });
    expect(states).toHaveLength(0);
  });
});

describe("buildImprovementAnalytics — Stage 19.1 §14-21", () => {
  it("returns an empty, non-misleading dataset when the user has no commitments of that reviewType", async () => {
    const user = await makeUser("analytics-empty");
    const result = await buildImprovementAnalytics(user.id, "WEEKLY");
    expect(result.overview).toEqual({ activeCount: 0, completedCount: 0, improvingCount: 0, decliningCount: 0, averageAdherencePercent: null, averageAdherenceSampleSize: 0 });
    expect(result.mostBreached).toBeNull();
    expect(result.longestRunning).toBeNull();
    expect(result.rankings).toEqual([]);
  });

  it("counts active/completed and averages adherence only across lineages with applicable observations", async () => {
    const user = await makeUser("analytics-overview");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const withObservations = await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "Has data", description: null, priority: "HIGH" });
    await setCommitmentDailyState(user.id, withObservations.id, new Date("2026-08-04T00:00:00.000Z"), "FOLLOWED");
    await setCommitmentDailyState(user.id, withObservations.id, new Date("2026-08-05T00:00:00.000Z"), "BREACHED");
    const noObservations = await createManualCommitment(user.id, session.id, { category: "PROCESS", title: "No data yet", description: null, priority: "MEDIUM" });
    const completed = await createManualCommitment(user.id, session.id, { category: "RISK", title: "Done", description: null, priority: "LOW" });
    await setCommitmentStatus(user.id, completed.id, "COMPLETED");
    void noObservations;

    const result = await buildImprovementAnalytics(user.id, "WEEKLY");
    expect(result.overview.activeCount).toBe(2); // withObservations + noObservations
    expect(result.overview.completedCount).toBe(1);
    // Only the ONE lineage with applicable observations enters the average.
    expect(result.overview.averageAdherenceSampleSize).toBe(1);
    expect(result.overview.averageAdherencePercent).toBe(50);
  });

  it("most-breached objective ranks by actual BREACHED count, never by PnL, and is null when nothing has ever breached", async () => {
    const user = await makeUser("analytics-most-breached");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const cleanCommitment = await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "Always followed", description: null, priority: "HIGH" });
    await setCommitmentDailyState(user.id, cleanCommitment.id, new Date("2026-08-04T00:00:00.000Z"), "FOLLOWED");

    let result = await buildImprovementAnalytics(user.id, "WEEKLY");
    expect(result.mostBreached).toBeNull(); // nothing has ever breached yet

    const breachyCommitment = await createManualCommitment(user.id, session.id, { category: "BEHAVIOR", title: "Frequently breached", description: null, priority: "HIGH" });
    await setCommitmentDailyState(user.id, breachyCommitment.id, new Date("2026-08-04T00:00:00.000Z"), "BREACHED");
    await setCommitmentDailyState(user.id, breachyCommitment.id, new Date("2026-08-05T00:00:00.000Z"), "BREACHED");

    result = await buildImprovementAnalytics(user.id, "WEEKLY");
    expect(result.mostBreached?.title).toBe("Frequently breached");
    expect(result.mostBreached?.breachCount).toBe(2);
  });

  it("longest-running active commitment is measured by lineage period count, not calendar age", async () => {
    const user = await makeUser("analytics-longest-running");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const short = await createManualCommitment(user.id, week1.id, { category: "EXECUTION", title: "Short-lived", description: null, priority: "HIGH" });
    void short;
    const root = await createManualCommitment(user.id, week1.id, { category: "PROCESS", title: "Long-running v1", description: null, priority: "HIGH" });
    const week2 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });
    const continued = await continueCommitment(user.id, root.id, week2.id);
    await refineCommitment(user.id, continued.id, await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-17", endDate: "2026-08-23" }).then((s) => s.id), {
      category: "PROCESS",
      title: "Long-running v2",
      description: null,
      priority: "HIGH",
    });

    const result = await buildImprovementAnalytics(user.id, "WEEKLY");
    expect(result.longestRunning?.title).toBe("Long-running v2");
    expect(result.longestRunning?.periodsActive).toBe(3);
  });

  it("classifies improving/declining using the SAME classifyTrend thresholds as Stage 19, never a separate calculation", async () => {
    const user = await makeUser("analytics-trend");
    const week1 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const root = await createManualCommitment(user.id, week1.id, { category: "EXECUTION", title: "Improving objective", description: null, priority: "HIGH" });
    // previous segment: 2 breached out of 4 (50%)
    await setCommitmentDailyState(user.id, root.id, new Date("2026-08-03T00:00:00.000Z"), "FOLLOWED");
    await setCommitmentDailyState(user.id, root.id, new Date("2026-08-04T00:00:00.000Z"), "FOLLOWED");
    await setCommitmentDailyState(user.id, root.id, new Date("2026-08-05T00:00:00.000Z"), "BREACHED");
    await setCommitmentDailyState(user.id, root.id, new Date("2026-08-06T00:00:00.000Z"), "BREACHED");

    const week2 = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });
    const continued = await continueCommitment(user.id, root.id, week2.id);
    // current segment: 4 followed out of 4 (100%) — a +50pp improvement
    await setCommitmentDailyState(user.id, continued.id, new Date("2026-08-10T00:00:00.000Z"), "FOLLOWED");
    await setCommitmentDailyState(user.id, continued.id, new Date("2026-08-11T00:00:00.000Z"), "FOLLOWED");
    await setCommitmentDailyState(user.id, continued.id, new Date("2026-08-12T00:00:00.000Z"), "FOLLOWED");
    await setCommitmentDailyState(user.id, continued.id, new Date("2026-08-13T00:00:00.000Z"), "FOLLOWED");

    const result = await buildImprovementAnalytics(user.id, "WEEKLY");
    expect(result.overview.improvingCount).toBe(1);
    expect(result.rankings.find((r) => r.lineageId === root.id)?.trend).toBe("IMPROVING");
  });

  it("keeps weekly and monthly as separate series — a weekly-only commitment never appears in the monthly dataset", async () => {
    const user = await makeUser("analytics-weekly-monthly-separate");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "Weekly only", description: null, priority: "HIGH" });

    const weekly = await buildImprovementAnalytics(user.id, "WEEKLY");
    const monthly = await buildImprovementAnalytics(user.id, "MONTHLY");
    expect(weekly.overview.activeCount).toBe(1);
    expect(monthly.overview.activeCount).toBe(0);
  });

  it("behaviour occurrence series counts BREACHED observations per period for automatic-rule-backed lineages only", async () => {
    const user = await makeUser("analytics-behaviour-occurrence");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    const ruleBacked = await acceptSuggestedCommitment(user.id, session.id, {
      category: "EXECUTION",
      title: "No stop widening",
      description: null,
      priority: "HIGH",
      ruleKey: "STOP_WIDENING_PATTERN",
      evidence: ["seed"],
    });
    await setCommitmentDailyState(user.id, ruleBacked.id, new Date("2026-08-04T00:00:00.000Z"), "BREACHED");
    await setCommitmentDailyState(user.id, ruleBacked.id, new Date("2026-08-05T00:00:00.000Z"), "BREACHED");
    const manualOnly = await createManualCommitment(user.id, session.id, { category: "PROCESS", title: "No automatic rule", description: null, priority: "MEDIUM" });
    await setCommitmentDailyState(user.id, manualOnly.id, new Date("2026-08-04T00:00:00.000Z"), "BREACHED");

    const result = await buildImprovementAnalytics(user.id, "WEEKLY");
    expect(result.behaviourOccurrence).toHaveLength(1);
    expect(result.behaviourOccurrence[0].ruleKey).toBe("STOP_WIDENING_PATTERN");
    expect(result.behaviourOccurrence[0].points[0].breachCount).toBe(2);
  });
});

describe("isolation", () => {
  it("commitment/finalization actions never mutate Trade, Analytics inputs, or WeeklyReview", async () => {
    const user = await makeUser("commitment-isolation");
    const session = await finalizedSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });

    const tradeCountBefore = await prisma.trade.count({ where: { userId: user.id } });
    const weeklyReviewCountBefore = await prisma.weeklyReview.count({ where: { userId: user.id } });

    await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "x", description: null, priority: "HIGH" });
    await getActiveCommitmentsForToday(user.id);

    expect(await prisma.trade.count({ where: { userId: user.id } })).toBe(tradeCountBefore);
    expect(await prisma.weeklyReview.count({ where: { userId: user.id } })).toBe(weeklyReviewCountBefore);
  });
});
