import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Release-gate regression. `assertValidKey` (media-storage.ts) previously
 * required the storage key's userId segment to be hex-only
 * (`[0-9a-f-]+`), but `saveMediaFile` actually builds keys as
 * `<userId>/<uuid>.<ext>` where `userId` is a Prisma `cuid()` — lowercase
 * alphanumeric, not restricted to hex. That meant `readMediaFile`/
 * `deleteMediaFile` threw a plain `Error` (never `MediaNotFoundError`) for
 * EVERY real asset, which GET /api/media/[id] mapped to a 502 — live-
 * confirmed against a real trade: the stored object itself was a perfectly
 * valid, uncorrupted PNG when read directly from R2, bypassing this check.
 *
 * Every OTHER test touching this module (media.service.test.ts) mocks
 * `deleteMediaFile`/`readMediaFile` outright, so the real regex was never
 * exercised against a realistic key anywhere — this is why the bug reached
 * a live release-gate test instead of CI. These tests mock only the R2
 * client (`getR2`), so `assertValidKey`'s real logic still runs.
 */

const sendMock = vi.fn();
vi.mock("@/lib/r2", () => ({
  getR2: () => ({ client: { send: sendMock }, bucket: "test-bucket" }),
}));

const REAL_CUID_USER_ID = "cmty4b7m900003zsb6qsyhmj5"; // an actual Prisma cuid() shape — contains non-hex letters (t, y, z, s, j, m)
const REAL_UUID = "aee1e182-6ad7-4a71-a03b-62a2cb984f12"; // an actual crypto.randomUUID() shape

describe("media-storage.ts storage-key validation (release-gate regression)", () => {
  beforeEach(() => {
    sendMock.mockClear();
  });

  it("readMediaFile accepts a real <cuid-userId>/<uuid>.<ext> key (the actual production format)", async () => {
    sendMock.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } });
    const { readMediaFile } = await import("./media-storage");

    const bytes = await readMediaFile(`${REAL_CUID_USER_ID}/${REAL_UUID}.png`);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("deleteMediaFile accepts the same real key format", async () => {
    sendMock.mockResolvedValueOnce({});
    const { deleteMediaFile } = await import("./media-storage");

    await expect(deleteMediaFile(`${REAL_CUID_USER_ID}/${REAL_UUID}.png`)).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("still rejects a key that isn't the expected shape, without ever reaching R2", async () => {
    const { readMediaFile } = await import("./media-storage");

    await expect(readMediaFile("../../etc/passwd")).rejects.toThrow("Invalid storage key.");
    await expect(readMediaFile("no-slash-at-all.png")).rejects.toThrow("Invalid storage key.");
    await expect(readMediaFile(`${REAL_CUID_USER_ID}/not-a-uuid.png`)).rejects.toThrow("Invalid storage key.");
    expect(sendMock).not.toHaveBeenCalled();
  });
});
