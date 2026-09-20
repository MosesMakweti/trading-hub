import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import {
  attachPlanScreenshot,
  attachPlanScreenshotFromExisting,
  getPlanWorkspace,
  lockPlanIfConfirmedAndUnlocked,
  recognizeStandaloneMediaAsset,
  removePlanScreenshot,
  runRecognition,
  savePlan,
  upsertAnnotation,
} from "@/server/services/trade-plan.service";

/** Real integration tests against the dev Postgres DB — same pattern as
 *  trade-executions.service.test.ts. */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `trade-plan-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

async function cleanupUsers(...ids: string[]) {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function makeTrade(userId: string, overrides: Partial<{ assetSymbol: string }> = {}) {
  return prisma.trade.create({
    data: {
      userId,
      tradeDate: new Date("2026-01-05"),
      executionMinutes: 570,
      direction: "LONG",
      higherTimeframeBias: "BULLISH",
      biasConfidencePercent: 80,
      expectedRR: 2,
      assetSymbol: overrides.assetSymbol ?? "EURUSD",
    },
  });
}

async function makeMediaAsset(userId: string, fileName = "chart.png") {
  const asset = await prisma.mediaAsset.create({
    data: { userId, storageKey: `${userId}/test-${Math.random().toString(36).slice(2)}.png`, fileName, mimeType: "image/png", fileSize: 1024, url: "pending" },
  });
  return prisma.mediaAsset.update({ where: { id: asset.id }, data: { url: `/api/media/${asset.id}` } });
}

describe("trade-plan.service — screenshot attach/replace/remove", () => {
  let userId: string;
  let tradeId: string;

  beforeAll(async () => {
    const user = await makeUser("attach");
    userId = user.id;
    const trade = await makeTrade(userId);
    tradeId = trade.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("attaches an uploaded image as the trade's plan screenshot", async () => {
    const asset = await makeMediaAsset(userId);
    const screenshot = await attachPlanScreenshot(userId, tradeId, asset.id);
    expect(screenshot.mediaAssetId).toBe(asset.id);
    expect(screenshot.status).toBe("UPLOADED");
  });

  it("replacing before confirmation swaps the underlying image and resets state", async () => {
    const newAsset = await makeMediaAsset(userId, "chart2.png");
    const replaced = await attachPlanScreenshot(userId, tradeId, newAsset.id);
    expect(replaced.mediaAssetId).toBe(newAsset.id);

    const { screenshot } = await getPlanWorkspace(userId, tradeId);
    expect(screenshot?.mediaAssetId).toBe(newAsset.id);
    // Only one screenshot row ever exists per trade (tradeId is unique).
    const count = await prisma.tradePlanScreenshot.count({ where: { tradeId } });
    expect(count).toBe(1);
  });

  it("removes the screenshot before confirmation without touching the underlying MediaAsset", async () => {
    const { screenshot } = await getPlanWorkspace(userId, tradeId);
    const mediaAssetId = screenshot!.mediaAssetId;
    await removePlanScreenshot(userId, tradeId);
    const after = await getPlanWorkspace(userId, tradeId);
    expect(after.screenshot).toBeNull();
    const assetStillExists = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
    expect(assetStillExists).not.toBeNull();
  });

  it("can attach an existing before-trade image by its attachment id", async () => {
    const asset = await makeMediaAsset(userId, "before-trade.png");
    const attachment = await prisma.mediaAttachment.create({
      data: { mediaId: asset.id, ownerType: "TRADE", ownerId: tradeId, category: "BEFORE", sortOrder: 0 },
    });
    const screenshot = await attachPlanScreenshotFromExisting(userId, tradeId, attachment.id);
    expect(screenshot.mediaAssetId).toBe(asset.id);
  });

  it("refuses to attach an image the user doesn't own", async () => {
    const other = await makeUser("attach-other");
    const otherAsset = await makeMediaAsset(other.id);
    await expect(attachPlanScreenshot(userId, tradeId, otherAsset.id)).rejects.toThrow();
    await cleanupUsers(other.id);
  });
});

describe("trade-plan.service — recognition (no provider configured)", () => {
  let userId: string;
  let tradeId: string;

  beforeAll(async () => {
    const user = await makeUser("recognition");
    userId = user.id;
    const trade = await makeTrade(userId);
    tradeId = trade.id;
    const asset = await makeMediaAsset(userId);
    await attachPlanScreenshot(userId, tradeId, asset.id);
  });

  afterAll(() => cleanupUsers(userId));

  it("resolves to RECOGNITION_FAILED and never blocks the trader (spec §2)", async () => {
    const result = await runRecognition(userId, tradeId);
    expect(result.status).toBe("RECOGNITION_FAILED");
    expect(result.error).toBeTruthy();

    const { screenshot } = await getPlanWorkspace(userId, tradeId);
    expect(screenshot?.status).toBe("RECOGNITION_FAILED");
    expect(screenshot?.recognitionError).toBeTruthy();
  });

  it("manual plan confirmation still works after a recognition failure", async () => {
    const result = await savePlan(userId, tradeId, {
      direction: "LONG",
      timeframe: "15m",
      entry: 1.105,
      stopLoss: 1.103,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.109, plannedClosePercent: 100 }],
    });
    expect(result.issues).toHaveLength(0);

    const { screenshot } = await getPlanWorkspace(userId, tradeId);
    expect(screenshot?.status).toBe("CONFIRMED");
  });
});

describe("trade-plan.service — recognizeStandaloneMediaAsset (Step 9, Part 1)", () => {
  it("resolves to RECOGNITION_FAILED (no provider configured) for a bare MediaAsset with no Trade/TradePlanScreenshot at all", async () => {
    const user = await makeUser("standalone-recognition");
    const asset = await makeMediaAsset(user.id);

    const outcome = await recognizeStandaloneMediaAsset(user.id, asset.id);
    expect(outcome.status).toBe("RECOGNITION_FAILED");
    if (outcome.status === "RECOGNITION_FAILED") expect(outcome.error).toBeTruthy();

    // Confirms this really never required a Trade/TradePlanScreenshot to exist.
    const screenshot = await prisma.tradePlanScreenshot.findFirst({ where: { mediaAssetId: asset.id } });
    expect(screenshot).toBeNull();

    await cleanupUsers(user.id);
  });

  it("throws (never fabricates a result) for a MediaAsset that doesn't exist", async () => {
    const user = await makeUser("standalone-recognition-missing");
    await expect(recognizeStandaloneMediaAsset(user.id, "does-not-exist")).rejects.toThrow(/not found|access denied/i);
    await cleanupUsers(user.id);
  });

  it("throws for a MediaAsset that belongs to a DIFFERENT user — cross-user access is never permitted", async () => {
    const owner = await makeUser("standalone-recognition-owner");
    const other = await makeUser("standalone-recognition-other");
    const asset = await makeMediaAsset(owner.id);

    await expect(recognizeStandaloneMediaAsset(other.id, asset.id)).rejects.toThrow(/not found|access denied/i);

    await cleanupUsers(owner.id, other.id);
  });

  it("never persists a ScreenshotRecognitionField row — there is nothing to scope one to pre-trade", async () => {
    const user = await makeUser("standalone-recognition-no-persist");
    const asset = await makeMediaAsset(user.id);

    await recognizeStandaloneMediaAsset(user.id, asset.id);

    const fields = await prisma.screenshotRecognitionField.findMany({ where: { screenshot: { mediaAssetId: asset.id } } });
    expect(fields).toEqual([]);

    await cleanupUsers(user.id);
  });
});

describe("trade-plan.service — plan confirmation, legacy sync, locking, revision", () => {
  let userId: string;
  let tradeId: string;

  beforeAll(async () => {
    const user = await makeUser("confirm");
    userId = user.id;
    const trade = await makeTrade(userId);
    tradeId = trade.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("confirms a multi-target long plan, computing R-multiples and weighted R", async () => {
    const result = await savePlan(userId, tradeId, {
      direction: "LONG",
      timeframe: "15m",
      entry: 1.085,
      stopLoss: 1.083,
      targets: [
        { targetOrder: 1, label: "TP1", targetPrice: 1.087, plannedClosePercent: 50 },
        { targetOrder: 2, label: "TP2", targetPrice: 1.089, plannedClosePercent: 50 },
      ],
    });
    expect(result.issues).toHaveLength(0);
    expect(result.versionNumber).toBe(1);

    const { targets, versions } = await getPlanWorkspace(userId, tradeId);
    expect(targets).toHaveLength(2);
    expect(targets[0].rMultiple).toBeCloseTo(1, 6);
    expect(targets[1].rMultiple).toBeCloseTo(2, 6);
    expect(versions[0].weightedPlannedR).toBeCloseTo(1.5, 6); // (1*0.5)+(2*0.5)
    expect(versions[0].locked).toBe(false);
  });

  it("keeps the legacy Trade.plannedEntry/plannedStopLoss/plannedTarget columns in sync with target #1", async () => {
    const trade = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
    expect(trade.plannedEntry?.toNumber()).toBeCloseTo(1.085, 6);
    expect(trade.plannedStopLoss?.toNumber()).toBeCloseTo(1.083, 6);
    expect(trade.plannedTarget?.toNumber()).toBeCloseTo(1.087, 6);
    expect(trade.timeframe).toBe("15m");
  });

  it("locks the plan on first actual entry (simulated) and blocks further plain confirms", async () => {
    await lockPlanIfConfirmedAndUnlocked(userId, tradeId);
    const { versions } = await getPlanWorkspace(userId, tradeId);
    expect(versions[0].locked).toBe(true);

    await expect(
      savePlan(userId, tradeId, {
        direction: "LONG",
        timeframe: "15m",
        entry: 1.086,
        stopLoss: 1.083,
        targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.09, plannedClosePercent: 100 }],
      }),
    ).rejects.toThrow(/locked/i);
  });

  it("allows a revision of a locked plan with an edit reason, preserving version history", async () => {
    const result = await savePlan(userId, tradeId, {
      direction: "LONG",
      timeframe: "15m",
      entry: 1.086,
      stopLoss: 1.0835,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.091, plannedClosePercent: 100 }],
      editReason: "Corrected entry after re-checking the chart.",
    });
    expect(result.versionNumber).toBe(2);

    const { versions } = await getPlanWorkspace(userId, tradeId);
    expect(versions).toHaveLength(2);
    expect(versions[0].versionNumber).toBe(2);
    expect(versions[0].editReason).toMatch(/corrected entry/i);
    expect(versions[0].locked).toBe(true); // inherits the locked trade's state
    expect(versions[1].versionNumber).toBe(1);
    expect(versions[1].entry).toBeCloseTo(1.085, 6); // v1 untouched
  });

  it("locking again is a no-op (idempotent)", async () => {
    await lockPlanIfConfirmedAndUnlocked(userId, tradeId);
    const { versions } = await getPlanWorkspace(userId, tradeId);
    expect(versions).toHaveLength(2); // no extra version created
  });
});

describe("trade-plan.service — validation blocks confirmation", () => {
  let userId: string;
  let tradeId: string;

  beforeAll(async () => {
    const user = await makeUser("validation");
    userId = user.id;
    const trade = await makeTrade(userId);
    tradeId = trade.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("rejects a plan where close percentages exceed 100%", async () => {
    await expect(
      savePlan(userId, tradeId, {
        direction: "LONG",
        entry: 1.1,
        stopLoss: 1.09,
        targets: [
          { targetOrder: 1, label: "TP1", targetPrice: 1.11, plannedClosePercent: 70 },
          { targetOrder: 2, label: "TP2", targetPrice: 1.12, plannedClosePercent: 70 },
        ],
      }),
    ).rejects.toThrow(/100%/);
  });

  it("rejects a plan with zero risk distance (stop equals entry)", async () => {
    await expect(
      savePlan(userId, tradeId, {
        direction: "LONG",
        entry: 1.1,
        stopLoss: 1.1,
        targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.11, plannedClosePercent: 100 }],
      }),
    ).rejects.toThrow();
  });
});

describe("trade-plan.service — screenshot status survives a locked-plan revision (regression)", () => {
  let userId: string;
  let tradeId: string;

  beforeAll(async () => {
    const user = await makeUser("screenshot-lock-status");
    userId = user.id;
    const trade = await makeTrade(userId);
    tradeId = trade.id;
    const asset = await makeMediaAsset(userId);
    await attachPlanScreenshot(userId, tradeId, asset.id);
  });

  afterAll(() => cleanupUsers(userId));

  it("keeps the screenshot status LOCKED (not regressed to CONFIRMED) after revising an already-locked plan", async () => {
    await savePlan(userId, tradeId, {
      direction: "LONG",
      entry: 1.1,
      stopLoss: 1.09,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.11, plannedClosePercent: 100 }],
    });
    let { screenshot } = await getPlanWorkspace(userId, tradeId);
    expect(screenshot?.status).toBe("CONFIRMED");

    await lockPlanIfConfirmedAndUnlocked(userId, tradeId);
    ({ screenshot } = await getPlanWorkspace(userId, tradeId));
    expect(screenshot?.status).toBe("LOCKED");

    await savePlan(userId, tradeId, {
      direction: "LONG",
      entry: 1.101,
      stopLoss: 1.09,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.111, plannedClosePercent: 100 }],
      editReason: "Corrected entry.",
    });
    ({ screenshot } = await getPlanWorkspace(userId, tradeId));
    expect(screenshot?.status).toBe("LOCKED"); // must NOT regress to CONFIRMED
  });
});

describe("trade-plan.service — historical screenshot immutability (checkpoint 2 §2)", () => {
  let userId: string;
  let tradeId: string;
  let assetA: Awaited<ReturnType<typeof makeMediaAsset>>;
  let assetB: Awaited<ReturnType<typeof makeMediaAsset>>;

  beforeAll(async () => {
    const user = await makeUser("immutability");
    userId = user.id;
    const trade = await makeTrade(userId);
    tradeId = trade.id;
    assetA = await makeMediaAsset(userId, "screenshot-a.png");
    assetB = await makeMediaAsset(userId, "screenshot-b.png");
  });

  afterAll(() => cleanupUsers(userId));

  it("Version 1 keeps Screenshot A, its annotations, and its planned values after the plan is revised onto Screenshot B", async () => {
    // 1. Upload Screenshot A.
    await attachPlanScreenshot(userId, tradeId, assetA.id);
    await upsertAnnotation(userId, tradeId, { type: "ENTRY", label: "Entry", confirmedPrice: 1.085, y: 0.5, color: "blue" });
    await upsertAnnotation(userId, tradeId, { type: "STOP_LOSS", label: "Stop", confirmedPrice: 1.083, y: 0.7, color: "red" });

    // 2. Confirm Plan Version 1.
    const v1Result = await savePlan(userId, tradeId, {
      direction: "LONG",
      timeframe: "15m",
      entry: 1.085,
      stopLoss: 1.083,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.089, plannedClosePercent: 100 }],
    });
    expect(v1Result.versionNumber).toBe(1);

    // 3. Enter an actual entry, causing the plan to lock (simulated directly).
    await lockPlanIfConfirmedAndUnlocked(userId, tradeId);

    // 4 & 5. Revise the plan with a required reason, replacing Screenshot A with Screenshot B.
    await attachPlanScreenshot(userId, tradeId, assetB.id);
    await upsertAnnotation(userId, tradeId, { type: "ENTRY", label: "Entry", confirmedPrice: 1.09, y: 0.4, color: "blue" });

    // 6. Confirm Plan Version 2.
    const v2Result = await savePlan(userId, tradeId, {
      direction: "LONG",
      timeframe: "5m",
      entry: 1.09,
      stopLoss: 1.088,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.094, plannedClosePercent: 100 }],
      editReason: "Re-planned on a cleaner chart after execution.",
    });
    expect(v2Result.versionNumber).toBe(2);

    // 7. Open Version 1 — it must still reference Screenshot A, not B.
    const { versions } = await getPlanWorkspace(userId, tradeId);
    expect(versions).toHaveLength(2);

    const v1 = versions.find((v) => v.versionNumber === 1)!;
    const v2 = versions.find((v) => v.versionNumber === 2)!;

    expect(v1.screenshotMediaAssetId).toBe(assetA.id);
    expect(v1.screenshotMediaAssetId).not.toBe(assetB.id);
    expect(v1.entry?.toNumber()).toBeCloseTo(1.085, 6);
    expect(v1.stopLoss?.toNumber()).toBeCloseTo(1.083, 6);
    expect(v1.timeframe).toBe("15m");
    expect(v1.locked).toBe(true);

    // Original annotations frozen at v1 time — 2 lines (entry + stop),
    // untouched by the later replacement/re-annotation for v2.
    const v1Annotations = v1.annotationsSnapshot as unknown as { type: string; confirmedPrice: number | null }[];
    expect(v1Annotations).toHaveLength(2);
    expect(v1Annotations.find((a) => a.type === "ENTRY")?.confirmedPrice).toBeCloseTo(1.085, 6);

    // Version 2 reflects Screenshot B and its own values.
    expect(v2.screenshotMediaAssetId).toBe(assetB.id);
    expect(v2.entry?.toNumber()).toBeCloseTo(1.09, 6);
    expect(v2.timeframe).toBe("5m");
    expect(v2.editReason).toMatch(/re-planned/i);

    // The underlying MediaAsset for Screenshot A must still be resolvable
    // (never deleted by the replace) — this is what makes v1's reference
    // durable, not just present as an orphaned id.
    const assetAStillExists = await prisma.mediaAsset.findUnique({ where: { id: assetA.id } });
    expect(assetAStillExists).not.toBeNull();
  });
});

describe("trade-plan.service — ownership isolation", () => {
  it("refuses to load or modify another user's trade plan", async () => {
    const owner = await makeUser("owner");
    const intruder = await makeUser("intruder");
    const trade = await makeTrade(owner.id);

    await expect(getPlanWorkspace(intruder.id, trade.id)).rejects.toThrow();
    await expect(
      savePlan(intruder.id, trade.id, {
        direction: "LONG",
        entry: 1.1,
        stopLoss: 1.09,
        targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1.11, plannedClosePercent: 100 }],
      }),
    ).rejects.toThrow();

    await cleanupUsers(owner.id, intruder.id);
  });
});
