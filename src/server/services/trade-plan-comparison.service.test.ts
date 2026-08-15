import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { attachPlanScreenshot, lockPlanIfConfirmedAndUnlocked, savePlan } from "@/server/services/trade-plan.service";
import { getExecutionBaselineVersion, getPlanExecutionComparison } from "@/server/services/trade-plan-comparison.service";

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `plan-comparison-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

async function cleanupUsers(...ids: string[]) {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function makeTrade(userId: string) {
  return prisma.trade.create({
    data: {
      userId,
      tradeDate: new Date("2026-01-05"),
      executionMinutes: 570,
      direction: "LONG",
      higherTimeframeBias: "BULLISH",
      biasConfidencePercent: 80,
      expectedRR: 2,
      assetSymbol: "EURUSD",
    },
  });
}

describe("trade-plan-comparison.service — no baseline yet", () => {
  it("reports unavailable, never a fabricated comparison, before the trade is executed", async () => {
    const user = await makeUser("no-baseline");
    const trade = await makeTrade(user.id);

    const result = await getPlanExecutionComparison(user.id, trade.id);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toMatch(/hasn't been executed/i);

    await cleanupUsers(user.id);
  });
});

describe("trade-plan-comparison.service — baseline stays fixed across later revisions (spec §3)", () => {
  let userId: string;
  let tradeId: string;

  beforeAll(async () => {
    const user = await makeUser("baseline-stable");
    userId = user.id;
    const trade = await makeTrade(userId);
    tradeId = trade.id;

    await savePlan(userId, tradeId, {
      direction: "LONG",
      entry: 1.085,
      stopLoss: 1.083,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.089, plannedClosePercent: 100 }],
    });
    await lockPlanIfConfirmedAndUnlocked(userId, tradeId);

    // Planned risk distance is 0.002 (1.085 - 1.083). Keep the actual risk
    // distance equal to that (1.0852 - 1.0832 = 0.002) so this scenario
    // isolates entry slippage from stop-distance change.
    await prisma.trade.update({ where: { id: tradeId }, data: { actualEntry: "1.0852", actualStopLoss: "1.0832" } });
  });

  afterAll(() => cleanupUsers(userId));

  it("uses the first locked version as the baseline", async () => {
    const baseline = await getExecutionBaselineVersion(userId, tradeId);
    expect(baseline?.versionNumber).toBe(1);
    expect(baseline?.entry?.toNumber()).toBeCloseTo(1.085, 6);
  });

  it("computes a full comparison against that baseline", async () => {
    const result = await getPlanExecutionComparison(userId, tradeId);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.baselineVersionNumber).toBe(1);
    expect(result.hasLaterRevisions).toBe(false);
    expect(result.entry.label).toBe("WORSE_THAN_PLANNED"); // entered 2 pips higher on a long
    expect(result.stop.change).toBe("RESPECTED");
  });

  it("does NOT change the comparison baseline after a post-execution revision — the execution-time plan stays the judge", async () => {
    await savePlan(userId, tradeId, {
      direction: "LONG",
      entry: 1.09, // very different plan
      stopLoss: 1.088,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.1, plannedClosePercent: 100 }],
      editReason: "Re-planned after execution for journaling purposes.",
    });

    const baseline = await getExecutionBaselineVersion(userId, tradeId);
    expect(baseline?.versionNumber).toBe(1); // still v1, not v2
    expect(baseline?.entry?.toNumber()).toBeCloseTo(1.085, 6); // still the original entry

    const result = await getPlanExecutionComparison(userId, tradeId);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.baselineVersionNumber).toBe(1);
    expect(result.hasLaterRevisions).toBe(true); // flagged as having a later revision, but not used as the baseline
    expect(result.entry.plannedEntry?.toNumber()).toBeCloseTo(1.085, 6); // unchanged
  });
});

describe("trade-plan-comparison.service — missing actual data stays honest", () => {
  it("labels entry/stop comparisons NOT_ENOUGH_DATA rather than guessing", async () => {
    const user = await makeUser("missing-actuals");
    const trade = await makeTrade(user.id);

    await savePlan(user.id, trade.id, {
      direction: "LONG",
      entry: 1.085,
      stopLoss: 1.083,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.089, plannedClosePercent: 100 }],
    });
    await lockPlanIfConfirmedAndUnlocked(user.id, trade.id);
    // No actualEntry/actualExit/actualStopLoss ever recorded.

    const result = await getPlanExecutionComparison(user.id, trade.id);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.entry.label).toBe("NOT_ENOUGH_DATA");
    expect(result.stop.change).toBe("NOT_ENOUGH_DATA");
    expect(result.alignmentFlags.some((f) => f.code === "ENTRY_DATA_MISSING")).toBe(true);
    expect(result.alignmentFlags.some((f) => f.code === "STOP_DATA_MISSING")).toBe(true);

    await cleanupUsers(user.id);
  });
});

describe("trade-plan-comparison.service — locked-plan screenshot replacement doesn't affect the comparison", () => {
  it("keeps the same comparison baseline after Screenshot A is replaced with Screenshot B", async () => {
    const user = await makeUser("screenshot-replace-cmp");
    const trade = await makeTrade(user.id);

    const assetA = await prisma.mediaAsset.create({ data: { userId: user.id, storageKey: `${user.id}/a.png`, fileName: "a.png", mimeType: "image/png", fileSize: 10, url: "pending" } });
    await attachPlanScreenshot(user.id, trade.id, assetA.id);

    await savePlan(user.id, trade.id, {
      direction: "LONG",
      entry: 1.085,
      stopLoss: 1.083,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.089, plannedClosePercent: 100 }],
    });
    await lockPlanIfConfirmedAndUnlocked(user.id, trade.id);
    await prisma.trade.update({ where: { id: trade.id }, data: { actualEntry: "1.085" } });

    const before = await getPlanExecutionComparison(user.id, trade.id);

    const assetB = await prisma.mediaAsset.create({ data: { userId: user.id, storageKey: `${user.id}/b.png`, fileName: "b.png", mimeType: "image/png", fileSize: 10, url: "pending" } });
    await attachPlanScreenshot(user.id, trade.id, assetB.id);
    await savePlan(user.id, trade.id, {
      direction: "LONG",
      entry: 1.2,
      stopLoss: 1.1,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.3, plannedClosePercent: 100 }],
      editReason: "Testing screenshot swap doesn't change the baseline.",
    });

    const after = await getPlanExecutionComparison(user.id, trade.id);
    expect(before.available && after.available).toBe(true);
    if (before.available && after.available) {
      expect(after.entry.plannedEntry?.toNumber()).toBe(before.entry.plannedEntry?.toNumber());
    }

    await cleanupUsers(user.id);
  });
});
