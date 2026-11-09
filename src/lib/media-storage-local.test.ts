import { mkdtemp, readdir, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { deleteMediaFile, isMediaStorageConfigured, mediaStorageDriver, readMediaFile, saveMediaFile } from "@/lib/media-storage";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "media-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const USER = "cmuser1abc";

describe("local media storage driver", () => {
  it("saves, reads back and deletes under <userId>/<uuid>.<ext>", async () => {
    vi.stubEnv("MEDIA_STORAGE_DRIVER", "local");
    vi.stubEnv("MEDIA_LOCAL_DIR", dir);
    expect(mediaStorageDriver()).toBe("local");
    expect(isMediaStorageConfigured()).toBe(true);
    const key = await saveMediaFile(USER, Buffer.from("hello"), "image/webp");
    expect(key).toMatch(new RegExp(`^${USER}/[0-9a-f-]{36}\\.webp$`));
    expect((await readMediaFile(key)).toString()).toBe("hello");
    expect(await readdir(path.join(dir, USER))).toHaveLength(1);
    await deleteMediaFile(key);
    await expect(readMediaFile(key)).rejects.toMatchObject({ name: "MediaNotFoundError" });
    await deleteMediaFile(key); // deleting twice is harmless
  });

  it("refuses path tricks in a storage key", async () => {
    vi.stubEnv("MEDIA_STORAGE_DRIVER", "local");
    vi.stubEnv("MEDIA_LOCAL_DIR", dir);
    await expect(readMediaFile("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
    await expect(deleteMediaFile(`${USER}/../../x.png`)).rejects.toThrow(/Invalid storage key/);
  });

  it("is never used in production", () => {
    vi.stubEnv("MEDIA_STORAGE_DRIVER", "local");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => mediaStorageDriver()).toThrow(/development and tests only/);
  });

  it("without R2 or the local driver, uploads are reported as unavailable", () => {
    vi.stubEnv("MEDIA_STORAGE_DRIVER", "");
    vi.stubEnv("R2_ACCOUNT_ID", "");
    expect(isMediaStorageConfigured()).toBe(false);
  });
});
