import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { createApiToken } from "@/server/services/api-tokens.service";
import { createStandaloneMediaAsset } from "@/server/services/media.service";
import * as mediaStorage from "@/lib/media-storage";
import { DELETE as deleteRoute } from "./route";

/** TradingView Extension — Step 9, Part 9. Real integration tests against
 *  the dev Postgres DB; R2 deletion is mocked. */
vi.mock("@/lib/media-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/media-storage")>("@/lib/media-storage");
  return { ...actual, deleteMediaFile: vi.fn(async () => {}) };
});

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `media-delete-route-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

function fakeStorageKey(userId: string) {
  return `${userId}/test-${Math.random().toString(36).slice(2)}.png`;
}

function req(rawToken?: string) {
  return new Request("http://localhost/api/v1/media/x", { method: "DELETE", headers: rawToken ? { authorization: `Bearer ${rawToken}` } : {} });
}

describe("DELETE /api/v1/media/:mediaAssetId (Step 9)", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  afterEach(() => {
    vi.mocked(mediaStorage.deleteMediaFile).mockClear();
  });

  it("401s with no token", async () => {
    const res = await deleteRoute(req(undefined), { params: Promise.resolve({ mediaAssetId: "x" }) });
    expect(res.status).toBe(401);
  });

  it("204s and actually deletes a standalone asset", async () => {
    const user = await makeUser("ok");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");
    const asset = await createStandaloneMediaAsset({ userId: user.id, storageKey: fakeStorageKey(user.id), fileName: "x.png", mimeType: "image/png", fileSize: 10 });

    const res = await deleteRoute(req(rawToken), { params: Promise.resolve({ mediaAssetId: asset.id }) });
    expect(res.status).toBe(204);
    expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).toBeNull();
  });

  it("404s for a nonexistent id", async () => {
    const user = await makeUser("missing");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");

    const res = await deleteRoute(req(rawToken), { params: Promise.resolve({ mediaAssetId: "does-not-exist" }) });
    expect(res.status).toBe(404);
  });

  it("409s and does NOT delete an asset already attached to a canonical TradePlanScreenshot", async () => {
    const { attachPlanScreenshot } = await import("@/server/services/trade-plan.service");
    const user = await makeUser("attached");
    userIds.push(user.id);
    const trade = await prisma.trade.create({
      data: { userId: user.id, tradeDate: new Date("2026-01-05"), executionMinutes: 570, direction: "LONG", higherTimeframeBias: "BULLISH", biasConfidencePercent: 80, assetSymbol: "XAUUSD" },
    });
    const asset = await createStandaloneMediaAsset({ userId: user.id, storageKey: fakeStorageKey(user.id), fileName: "x.png", mimeType: "image/png", fileSize: 10 });
    await attachPlanScreenshot(user.id, trade.id, asset.id);
    const { rawToken } = await createApiToken(user.id, "test");

    const res = await deleteRoute(req(rawToken), { params: Promise.resolve({ mediaAssetId: asset.id }) });
    expect(res.status).toBe(409);
    expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
  });

  it("cross-user: 404s and does not delete another user's asset", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");
    userIds.push(owner.id, other.id);
    const asset = await createStandaloneMediaAsset({ userId: owner.id, storageKey: fakeStorageKey(owner.id), fileName: "x.png", mimeType: "image/png", fileSize: 10 });
    const { rawToken: otherToken } = await createApiToken(other.id, "test");

    const res = await deleteRoute(req(otherToken), { params: Promise.resolve({ mediaAssetId: asset.id }) });
    expect(res.status).toBe(404);
    expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
  });
});
