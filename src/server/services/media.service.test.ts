import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import * as mediaStorage from "@/lib/media-storage";
import { attachMedia, assertOwnsMediaTarget, createStandaloneMediaAsset, deleteStandaloneMediaAsset } from "@/server/services/media.service";

vi.mock("@/lib/media-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/media-storage")>("@/lib/media-storage");
  return { ...actual, deleteMediaFile: vi.fn(async () => {}) };
});

/** Real integration tests against the dev Postgres DB — same pattern as
 *  trade-plan.service.test.ts / strategies route.test.ts. Covers the
 *  existing `attachMedia` path (regression, since Step 8 refactored its
 *  asset-creation into a shared helper), the Step 8 `createStandaloneMediaAsset`,
 *  and the Step 9 `deleteStandaloneMediaAsset`. `deleteMediaFile` (R2) is
 *  mocked so these never require production R2 credentials. */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `media-service-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
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
      assetSymbol: "XAUUSD",
    },
  });
}

function fakeStorageKey(userId: string) {
  return `${userId}/test-${Math.random().toString(36).slice(2)}.png`;
}

describe("media.service", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  describe("attachMedia (regression — unchanged behavior after the Step 8 refactor)", () => {
    it("creates a MediaAsset AND a MediaAttachment for a real owner", async () => {
      const user = await makeUser("attach-a");
      userIds.push(user.id);
      const trade = await makeTrade(user.id);

      const item = await attachMedia({
        userId: user.id,
        ownerType: "TRADE",
        ownerId: trade.id,
        category: "BEFORE",
        storageKey: fakeStorageKey(user.id),
        fileName: "chart.png",
        mimeType: "image/png",
        fileSize: 1024,
      });

      expect(item.url).toMatch(/^\/api\/media\/.+$/);
      const attachment = await prisma.mediaAttachment.findUnique({ where: { id: item.id }, include: { media: true } });
      expect(attachment).not.toBeNull();
      expect(attachment!.ownerType).toBe("TRADE");
      expect(attachment!.ownerId).toBe(trade.id);
      expect(attachment!.media.userId).toBe(user.id);
      expect(attachment!.media.url).toBe(item.url);
    });

    it("still throws (and never creates an asset) for an owner that isn't the caller's", async () => {
      const userA = await makeUser("attach-b-a");
      const userB = await makeUser("attach-b-b");
      userIds.push(userA.id, userB.id);
      const tradeB = await makeTrade(userB.id);

      await expect(
        attachMedia({
          userId: userA.id,
          ownerType: "TRADE",
          ownerId: tradeB.id,
          category: "BEFORE",
          storageKey: fakeStorageKey(userA.id),
          fileName: "chart.png",
          mimeType: "image/png",
          fileSize: 1024,
        }),
      ).rejects.toThrow(/not found|access denied/i);
    });
  });

  describe("createStandaloneMediaAsset (Step 8)", () => {
    it("creates a MediaAsset with NO MediaAttachment", async () => {
      const user = await makeUser("standalone-a");
      userIds.push(user.id);

      const asset = await createStandaloneMediaAsset({
        userId: user.id,
        storageKey: fakeStorageKey(user.id),
        fileName: "capture.png",
        mimeType: "image/png",
        fileSize: 2048,
      });

      expect(asset.url).toBe(`/api/media/${asset.id}`);
      expect(asset.mimeType).toBe("image/png");
      expect(asset.fileSize).toBe(2048);

      const attachments = await prisma.mediaAttachment.findMany({ where: { mediaId: asset.id } });
      expect(attachments).toEqual([]);
    });

    it("is immediately usable as attachPlanScreenshot's mediaAssetId, despite having no attachment", async () => {
      const { attachPlanScreenshot } = await import("@/server/services/trade-plan.service");
      const user = await makeUser("standalone-b");
      userIds.push(user.id);
      const trade = await makeTrade(user.id);

      const asset = await createStandaloneMediaAsset({
        userId: user.id,
        storageKey: fakeStorageKey(user.id),
        fileName: "capture.png",
        mimeType: "image/png",
        fileSize: 2048,
      });

      const screenshot = await attachPlanScreenshot(user.id, trade.id, asset.id);
      expect(screenshot.mediaAssetId).toBe(asset.id);
    });

    it("belongs only to the uploading user — a different user's id can never resolve it via assertOwnsMediaTarget-style ownership", async () => {
      const userA = await makeUser("standalone-c-a");
      const userB = await makeUser("standalone-c-b");
      userIds.push(userA.id, userB.id);

      const asset = await createStandaloneMediaAsset({
        userId: userA.id,
        storageKey: fakeStorageKey(userA.id),
        fileName: "capture.png",
        mimeType: "image/png",
        fileSize: 2048,
      });

      const foundByOwner = await prisma.mediaAsset.findFirst({ where: { id: asset.id, userId: userA.id } });
      const foundByOther = await prisma.mediaAsset.findFirst({ where: { id: asset.id, userId: userB.id } });
      expect(foundByOwner).not.toBeNull();
      expect(foundByOther).toBeNull();
    });
  });

  describe("deleteStandaloneMediaAsset (Step 9, Part 9)", () => {
    it("deletes a genuinely unattached asset — removes the R2 object and the row", async () => {
      const user = await makeUser("delete-ok");
      userIds.push(user.id);
      const asset = await createStandaloneMediaAsset({ userId: user.id, storageKey: fakeStorageKey(user.id), fileName: "x.png", mimeType: "image/png", fileSize: 10 });

      const result = await deleteStandaloneMediaAsset(user.id, asset.id);
      expect(result).toEqual({ ok: true });
      expect(mediaStorage.deleteMediaFile).toHaveBeenCalled();
      expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).toBeNull();
    });

    it("refuses to delete an asset that has a MediaAttachment (gallery-linked)", async () => {
      const user = await makeUser("delete-attached");
      userIds.push(user.id);
      const trade = await makeTrade(user.id);
      const item = await attachMedia({ userId: user.id, ownerType: "TRADE", ownerId: trade.id, category: "BEFORE", storageKey: fakeStorageKey(user.id), fileName: "x.png", mimeType: "image/png", fileSize: 10 });
      const attachment = await prisma.mediaAttachment.findUnique({ where: { id: item.id } });

      const result = await deleteStandaloneMediaAsset(user.id, attachment!.mediaId);
      expect(result).toEqual({ ok: false, reason: "attached" });
      expect(await prisma.mediaAsset.findUnique({ where: { id: attachment!.mediaId } })).not.toBeNull();
    });

    it("refuses to delete an asset already wrapped into a canonical TradePlanScreenshot", async () => {
      const { attachPlanScreenshot } = await import("@/server/services/trade-plan.service");
      const user = await makeUser("delete-screenshot");
      userIds.push(user.id);
      const trade = await makeTrade(user.id);
      const asset = await createStandaloneMediaAsset({ userId: user.id, storageKey: fakeStorageKey(user.id), fileName: "x.png", mimeType: "image/png", fileSize: 10 });
      await attachPlanScreenshot(user.id, trade.id, asset.id);

      const result = await deleteStandaloneMediaAsset(user.id, asset.id);
      expect(result).toEqual({ ok: false, reason: "attached" });
      expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
    });

    it("never allows deleting another user's media — returns not_found, never touches it", async () => {
      const owner = await makeUser("delete-owner");
      const other = await makeUser("delete-other");
      userIds.push(owner.id, other.id);
      const asset = await createStandaloneMediaAsset({ userId: owner.id, storageKey: fakeStorageKey(owner.id), fileName: "x.png", mimeType: "image/png", fileSize: 10 });

      const result = await deleteStandaloneMediaAsset(other.id, asset.id);
      expect(result).toEqual({ ok: false, reason: "not_found" });
      expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
    });

    it("returns not_found (never throws) for a nonexistent id", async () => {
      const user = await makeUser("delete-missing");
      userIds.push(user.id);
      expect(await deleteStandaloneMediaAsset(user.id, "does-not-exist")).toEqual({ ok: false, reason: "not_found" });
    });
  });

  describe("assertOwnsMediaTarget (sanity check, no dedicated test file existed before)", () => {
    it("TRADE: true for the owning user, false for another user, false for a non-existent trade", async () => {
      const userA = await makeUser("assert-a");
      const userB = await makeUser("assert-b");
      userIds.push(userA.id, userB.id);
      const trade = await makeTrade(userA.id);

      expect(await assertOwnsMediaTarget(userA.id, "TRADE", trade.id)).toBe(true);
      expect(await assertOwnsMediaTarget(userB.id, "TRADE", trade.id)).toBe(false);
      expect(await assertOwnsMediaTarget(userA.id, "TRADE", "does-not-exist")).toBe(false);
    });
  });
});
