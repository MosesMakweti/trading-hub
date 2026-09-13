import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import {
  completeReplayReviewSession,
  createReplayReviewSession,
  finalizeEdgeReview,
  reopenReplayReviewSession,
  startReplayReviewSession,
} from "@/server/services/replay-review.service";
import {
  acceptSuggestedCommitment,
  createManualCommitment,
  getActiveCommitmentsForToday,
  getCommitmentDailyStates,
  listCommitmentsForSession,
  setCommitmentDailyState,
  setCommitmentStatus,
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
