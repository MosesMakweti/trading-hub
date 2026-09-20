import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createApiToken } from "@/server/services/api-tokens.service";
import { POST as recognizeRoute } from "./route";

/**
 * TradingView Extension — Step 9, Part 1. Real integration tests against
 * the dev Postgres DB (same pattern as strategies/route.test.ts,
 * v1/media/route.test.ts) — no `ANTHROPIC_API_KEY` is configured in this
 * environment, so every recognition call here genuinely exercises the
 * NullRecognitionProvider fallback, not a mock standing in for it.
 */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `recognize-route-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

async function makeMediaAsset(userId: string) {
  const asset = await prisma.mediaAsset.create({
    data: { userId, storageKey: `${userId}/test-${Math.random().toString(36).slice(2)}.png`, fileName: "chart.png", mimeType: "image/png", fileSize: 1024, url: "pending" },
  });
  return prisma.mediaAsset.update({ where: { id: asset.id }, data: { url: `/api/media/${asset.id}` } });
}

function req(rawToken?: string) {
  return new Request("http://localhost/api/v1/media/x/recognize-trade-plan", {
    method: "POST",
    headers: rawToken ? { authorization: `Bearer ${rawToken}` } : {},
  });
}

describe("POST /api/v1/media/:mediaAssetId/recognize-trade-plan (Step 9)", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("401s with no token", async () => {
    const res = await recognizeRoute(req(undefined), { params: Promise.resolve({ mediaAssetId: "x" }) });
    expect(res.status).toBe(401);
  });

  it("401s with an invalid/unknown token", async () => {
    const res = await recognizeRoute(req("td_live_not_real"), { params: Promise.resolve({ mediaAssetId: "x" }) });
    expect(res.status).toBe(401);
  });

  it("200s with a RECOGNITION_FAILED body (never an HTTP error) when no provider is configured", async () => {
    const user = await makeUser("valid");
    userIds.push(user.id);
    const asset = await makeMediaAsset(user.id);
    const { rawToken } = await createApiToken(user.id, "test");

    const res = await recognizeRoute(req(rawToken), { params: Promise.resolve({ mediaAssetId: asset.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("RECOGNITION_FAILED");
    expect(body.error).toBeTruthy();
  });

  it("404s for a MediaAsset id that doesn't exist", async () => {
    const user = await makeUser("missing");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");

    const res = await recognizeRoute(req(rawToken), { params: Promise.resolve({ mediaAssetId: "does-not-exist" }) });
    expect(res.status).toBe(404);
  });

  it("cross-user isolation: 404s for another user's MediaAsset — never leaks whether it exists", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");
    userIds.push(owner.id, other.id);
    const asset = await makeMediaAsset(owner.id);
    const { rawToken: otherToken } = await createApiToken(other.id, "test");

    const res = await recognizeRoute(req(otherToken), { params: Promise.resolve({ mediaAssetId: asset.id }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(owner.id);
  });

  it("never returns provider credentials or a raw error object — only the sanitized message", async () => {
    const user = await makeUser("sanitized");
    userIds.push(user.id);
    const asset = await makeMediaAsset(user.id);
    const { rawToken } = await createApiToken(user.id, "test");

    const res = await recognizeRoute(req(rawToken), { params: Promise.resolve({ mediaAssetId: asset.id }) });
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/ANTHROPIC_API_KEY|sk-ant|stack/i);
  });
});
