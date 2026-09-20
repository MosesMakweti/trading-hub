import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { createApiToken } from "@/server/services/api-tokens.service";
import * as mediaStorage from "@/lib/media-storage";
import * as mediaService from "@/server/services/media.service";
import { POST as uploadMedia } from "./route";

/**
 * TradingView Extension — Step 8. Real integration tests against the dev
 * Postgres DB (same pattern as strategies/route.test.ts) — R2 itself is
 * mocked (`saveMediaFile`/`deleteMediaFile`) so these never require
 * production R2 credentials, per the Step 8 brief's explicit instruction.
 */
vi.mock("@/lib/media-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/media-storage")>("@/lib/media-storage");
  return { ...actual, saveMediaFile: vi.fn(), deleteMediaFile: vi.fn() };
});
vi.mock("@/server/services/media.service", async () => {
  const actual = await vi.importActual<typeof import("@/server/services/media.service")>("@/server/services/media.service");
  return { ...actual, createStandaloneMediaAsset: vi.fn(actual.createStandaloneMediaAsset) };
});

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `media-route-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

function multipartRequest(rawToken: string | undefined, file: File | null | "malformed") {
  const headers: Record<string, string> = rawToken ? { authorization: `Bearer ${rawToken}` } : {};

  if (file === "malformed") {
    // Claims to be multipart but the body isn't — .formData() must throw.
    return new Request("http://localhost/api/v1/media", {
      method: "POST",
      headers: { ...headers, "content-type": "multipart/form-data; boundary=not-a-real-boundary" },
      body: "this is not a valid multipart body",
    });
  }

  const form = new FormData();
  if (file) form.set("file", file);
  return new Request("http://localhost/api/v1/media", { method: "POST", headers, body: form });
}

function pngFile(bytes = "fake-png-bytes", name = "chart.png", type = "image/png") {
  return new File([bytes], name, { type });
}

describe("POST /api/v1/media (Step 8)", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  afterEach(() => {
    vi.mocked(mediaStorage.saveMediaFile).mockReset();
    vi.mocked(mediaStorage.deleteMediaFile).mockReset();
  });

  it("401s with no token", async () => {
    const res = await uploadMedia(multipartRequest(undefined, pngFile()));
    expect(res.status).toBe(401);
  });

  it("401s with an invalid/unknown token", async () => {
    const res = await uploadMedia(multipartRequest("td_live_not_real", pngFile()));
    expect(res.status).toBe(401);
  });

  it("a valid image upload succeeds and the resulting MediaAsset belongs to the authenticated user", async () => {
    const user = await makeUser("valid");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");
    vi.mocked(mediaStorage.saveMediaFile).mockResolvedValue(`${user.id}/fake-key.png`);

    const res = await uploadMedia(multipartRequest(rawToken, pngFile()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.mimeType).toBe("image/png");
    expect(body.fileSize).toBeGreaterThan(0);
    expect(body.url).toBe(`/api/media/${body.id}`);

    const asset = await prisma.mediaAsset.findUnique({ where: { id: body.id } });
    expect(asset?.userId).toBe(user.id);
  });

  it("never accepts a userId from the request body — ownership is exclusively requireApiUser's resolved user", async () => {
    const userA = await makeUser("no-spoof-a");
    const userB = await makeUser("no-spoof-b");
    userIds.push(userA.id, userB.id);
    const { rawToken } = await createApiToken(userA.id, "test");
    vi.mocked(mediaStorage.saveMediaFile).mockResolvedValue(`${userA.id}/fake-key.png`);

    const form = new FormData();
    form.set("file", pngFile());
    form.set("userId", userB.id); // an attempted spoof — must be ignored entirely
    const res = await uploadMedia(new Request("http://localhost/api/v1/media", { method: "POST", headers: { authorization: `Bearer ${rawToken}` }, body: form }));

    const body = await res.json();
    const asset = await prisma.mediaAsset.findUnique({ where: { id: body.id } });
    expect(asset?.userId).toBe(userA.id); // NOT userB
  });

  it("400s with no file field", async () => {
    const user = await makeUser("missing-file");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");

    const res = await uploadMedia(multipartRequest(rawToken, null));
    expect(res.status).toBe(400);
    expect(mediaStorage.saveMediaFile).not.toHaveBeenCalled();
  });

  it("400s with an empty file", async () => {
    const user = await makeUser("empty-file");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");

    const res = await uploadMedia(multipartRequest(rawToken, pngFile("")));
    expect(res.status).toBe(400);
    expect(mediaStorage.saveMediaFile).not.toHaveBeenCalled();
  });

  it("415s an unsupported MIME type, never trusting the filename extension alone", async () => {
    const user = await makeUser("bad-mime");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");

    // A .png filename with a non-image MIME — the MIME type governs, not the extension.
    const res = await uploadMedia(multipartRequest(rawToken, pngFile("x", "chart.png", "application/x-msdownload")));
    expect(res.status).toBe(415);
    expect(mediaStorage.saveMediaFile).not.toHaveBeenCalled();
  });

  it("413s an oversized file", async () => {
    const user = await makeUser("oversized");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");

    const bigBytes = new Uint8Array(8 * 1024 * 1024 + 1); // one byte over the 8MB cap
    const res = await uploadMedia(multipartRequest(rawToken, new File([bigBytes], "chart.png", { type: "image/png" })));
    expect(res.status).toBe(413);
    expect(mediaStorage.saveMediaFile).not.toHaveBeenCalled();
  });

  it("400s a malformed multipart body without crashing", async () => {
    const user = await makeUser("malformed");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");

    const res = await uploadMedia(multipartRequest(rawToken, "malformed"));
    expect(res.status).toBe(400);
  });

  it("cleans up the R2 object if the database write fails after upload", async () => {
    const user = await makeUser("db-fail");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");
    vi.mocked(mediaStorage.saveMediaFile).mockResolvedValue("some/key.png");
    vi.mocked(mediaService.createStandaloneMediaAsset).mockRejectedValueOnce(new Error("db exploded"));

    await expect(uploadMedia(multipartRequest(rawToken, pngFile()))).rejects.toThrow("db exploded");
    expect(mediaStorage.deleteMediaFile).toHaveBeenCalledWith("some/key.png");
  });
});
