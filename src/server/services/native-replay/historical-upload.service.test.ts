import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the R2 import bucket (real R2 is exercised in manual QA).
const objects = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("@/lib/historical-import-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/historical-import-storage")>("@/lib/historical-import-storage");
  return {
    ...actual,
    presignImportUpload: vi.fn(async (key: string, size: number) => `https://r2.test/${key}?size=${size}&signed=1`),
    headImportObject: vi.fn(async (key: string) => objects.get(key)?.byteLength ?? null),
    readImportObject: vi.fn(async (key: string) => objects.get(key)!),
    deleteImportObject: vi.fn(async (key: string) => {
      if (!key.startsWith(actual.IMPORT_OBJECT_PREFIX)) throw new Error("outside prefix");
      objects.delete(key);
    }),
  };
});

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import {
  completeImportUpload,
  createImportUpload,
  ImportUploadError,
  ImportUploadNotFoundError,
  previewImportUpload,
  sweepExpiredImportUploads,
} from "@/server/services/native-replay/historical-upload.service";
import { mt5Text, syntheticMt5Export } from "@/domain/native-replay/testing/m1-fixtures";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
beforeEach(() => objects.clear());

async function user(label: string) {
  const u = await createTestUser(`upload-${label}`);
  userIds.push(u.id);
  return u.id;
}
const WEEK = new TextEncoder().encode(syntheticMt5Export({ startDay: "2024-05-13", days: 5 }).text);
const NAME = "EURUSD_M1_202405130000_202405172359.csv";

/** What the browser does with the presigned URL. */
async function browserPut(uploadId: string, bytes: Uint8Array) {
  const row = await prisma.historicalImportUpload.findUniqueOrThrow({ where: { id: uploadId } });
  objects.set(row.objectKey, bytes);
  return row.objectKey;
}

describe("direct-to-R2 import", () => {
  it("presign → browser PUT → preview → import → READY, and the source object is deleted", async () => {
    const userId = await user("happy");
    const created = await createImportUpload(userId, { fileName: NAME, sizeBytes: WEEK.byteLength });
    expect(created.uploadUrl).toContain(`native-replay-imports/${userId}/`);
    expect(created.uploadHeaders).toEqual({ "Content-Type": "text/csv" });
    await expect(previewImportUpload(userId, created.uploadId)).rejects.toThrow(/hasn't finished uploading/);

    const key = await browserPut(created.uploadId, WEEK);
    const report = await previewImportUpload(userId, created.uploadId);
    expect(report).toMatchObject({ state: "VALID", counts: { bars: 7200 } });
    expect(objects.has(key)).toBe(true); // kept until imported

    const done = await completeImportUpload(userId, created.uploadId);
    expect(done.ok && done.dataset).toMatchObject({ status: "READY", barCount: 7200, symbol: "EURUSD" });
    expect(objects.has(key)).toBe(false);
    expect(await prisma.historicalImportUpload.findUniqueOrThrow({ where: { id: created.uploadId } })).toMatchObject({ status: "COMPLETED", datasetId: done.ok ? done.dataset.id : null });
    // Runs once: a second import (double click, retry) is refused, nothing duplicated.
    await expect(completeImportUpload(userId, created.uploadId)).rejects.toBeInstanceOf(ImportUploadError);
    expect(await prisma.historicalDataset.count({ where: { userId } })).toBe(1);
  });

  it("concurrent completes import exactly once", async () => {
    const userId = await user("race");
    const created = await createImportUpload(userId, { fileName: NAME, sizeBytes: WEEK.byteLength });
    await browserPut(created.uploadId, WEEK);
    const results = await Promise.allSettled([1, 2, 3].map(() => completeImportUpload(userId, created.uploadId)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.historicalDataset.count({ where: { userId } })).toBe(1);
  });

  it("an INVALID file ends the upload and removes its object; a missing symbol can be supplied", async () => {
    const userId = await user("invalid");
    const bad = new TextEncoder().encode(mt5Text([["2024.05.14", "09:00", "1.1", "1.0", "1.2", "1.1"]]));
    const c1 = await createImportUpload(userId, { fileName: NAME, sizeBytes: bad.byteLength });
    const key = await browserPut(c1.uploadId, bad);
    expect((await previewImportUpload(userId, c1.uploadId)).state).toBe("INVALID");
    expect(objects.has(key)).toBe(false);
    expect((await prisma.historicalImportUpload.findUniqueOrThrow({ where: { id: c1.uploadId } })).status).toBe("FAILED");

    const c2 = await createImportUpload(userId, { fileName: "export.csv", sizeBytes: WEEK.byteLength });
    await browserPut(c2.uploadId, WEEK);
    expect((await previewImportUpload(userId, c2.uploadId)).errors.join(" ")).toMatch(/Symbol unknown/);
    expect((await previewImportUpload(userId, c2.uploadId, "EURUSD.a")).state).toBe("VALID");
    const done = await completeImportUpload(userId, c2.uploadId);
    expect(done.ok && done.dataset.sourceSymbol).toBe("EURUSD.a");
  });

  it("the server controls size and type: oversize and non-MT5 names are refused before any URL exists", async () => {
    const userId = await user("limits");
    await expect(createImportUpload(userId, { fileName: NAME, sizeBytes: 151 * 1024 * 1024 })).rejects.toThrow(/larger than 150MB/);
    await expect(createImportUpload(userId, { fileName: "chart.png", sizeBytes: 100 })).rejects.toThrow(/\.csv or \.txt/);
    await expect(createImportUpload(userId, { fileName: NAME, sizeBytes: 0 })).rejects.toThrow(/empty/);
    // A different size than announced (R2 rejects it too — the size is signed).
    const c = await createImportUpload(userId, { fileName: NAME, sizeBytes: 100 });
    await browserPut(c.uploadId, WEEK);
    await expect(previewImportUpload(userId, c.uploadId)).rejects.toThrow(/doesn't match/);
    expect(await prisma.historicalImportUpload.count({ where: { userId, status: "PENDING" } })).toBe(1);
  });

  it("another user's upload doesn't exist for them; keys can't cross users", async () => {
    const a = await user("owner-a");
    const b = await user("owner-b");
    const c = await createImportUpload(a, { fileName: NAME, sizeBytes: WEEK.byteLength });
    await browserPut(c.uploadId, WEEK);
    await expect(previewImportUpload(b, c.uploadId)).rejects.toBeInstanceOf(ImportUploadNotFoundError);
    await expect(completeImportUpload(b, c.uploadId)).rejects.toBeInstanceOf(ImportUploadNotFoundError);
    // DB check: an upload row can only point inside its own user's prefix.
    const row = await prisma.historicalImportUpload.findUniqueOrThrow({ where: { id: c.uploadId } });
    await expect(prisma.historicalImportUpload.create({ data: { userId: b, objectKey: row.objectKey.replace(a, b) + "x", fileName: NAME, declaredBytes: 1, expiresAt: new Date() } })).resolves.toBeTruthy();
    await expect(prisma.historicalImportUpload.create({ data: { userId: b, objectKey: `native-replay-imports/${a}/stolen.csv`, fileName: NAME, declaredBytes: 1, expiresAt: new Date() } })).rejects.toThrow(/object_key_owned/);
  });

  it("abandoned uploads are swept: object deleted, EXPIRED; completed ones untouched", async () => {
    const userId = await user("sweep");
    const c = await createImportUpload(userId, { fileName: NAME, sizeBytes: WEEK.byteLength });
    const key = await browserPut(c.uploadId, WEEK);
    const unrelated = "media/some-user/photo.png";
    objects.set(unrelated, new Uint8Array([1]));
    await prisma.historicalImportUpload.update({ where: { id: c.uploadId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await sweepExpiredImportUploads(userId)).toBe(1);
    expect(objects.has(key)).toBe(false);
    expect(objects.has(unrelated)).toBe(true); // never touches anything else
    expect((await prisma.historicalImportUpload.findUniqueOrThrow({ where: { id: c.uploadId } })).status).toBe("EXPIRED");
    await expect(completeImportUpload(userId, c.uploadId)).rejects.toThrow(/already been processed/);
  });
});
