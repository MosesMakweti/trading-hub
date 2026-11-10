import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/media-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/media-storage")>("@/lib/media-storage");
  return {
    ...actual,
    saveMediaFile: vi.fn(async (userId: string) => `${userId}/${crypto.randomUUID()}.png`),
    deleteMediaFile: vi.fn(async () => {}),
  };
});

import * as mediaStorage from "@/lib/media-storage";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, deleteBacktestRun, runInBacktestRun } from "@/server/services/backtest-run.service";
import { archivePastActiveDays, getOrCreateTradingDay } from "@/server/services/trading-day.service";
import { assertOwnsMediaTarget, attachMedia, listMedia } from "@/server/services/media.service";
import { deleteDataSection } from "@/server/services/data-management.service";
import { runLive } from "@/server/workspace/scope";
import { POST as upload } from "@/app/api/media/upload/route";

/** Images on the Today plan's notes (MediaOwnerType TRADING_DAY, one category per section). */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
beforeEach(() => {
  vi.mocked(mediaStorage.deleteMediaFile).mockClear();
  vi.mocked(mediaStorage.saveMediaFile).mockClear();
  vi.mocked(auth).mockReset();
});

async function user(label: string) {
  const u = await createTestUser(`plan-media-${label}`);
  userIds.push(u.id);
  return u.id;
}

const day = async (userId: string, dateKey = "2024-05-14") => (await getOrCreateTradingDay(userId, dateKey)).id;

function uploadRequest(ownerId: string, category = "LOOKING_FOR") {
  const form = new FormData();
  form.set("ownerType", "TRADING_DAY");
  form.set("ownerId", ownerId);
  form.set("category", category);
  // A real 2×2 PNG: the route checks content, then stores screenshots as optimized WebP.
  form.append("files", new File([new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=", "base64"))], "pasted.png", { type: "image/png" }));
  return new Request("http://localhost/api/media/upload", { method: "POST", body: form });
}

const signIn = (userId: string) => vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);

async function attach(userId: string, dayId: string) {
  const storageKey = `${userId}/${crypto.randomUUID()}.png`;
  await attachMedia({ userId, ownerType: "TRADING_DAY", ownerId: dayId, category: "STAY_OUT", timeframe: null, storageKey, fileName: "a.png", mimeType: "image/png", fileSize: 1 });
  return storageKey;
}
const assetExists = async (storageKey: string) => (await prisma.mediaAsset.count({ where: { storageKey } })) === 1;

describe("ownership", () => {
  it("only the owner of the day can attach plan images to it", async () => {
    const a = await user("own-a");
    const b = await user("own-b");
    const id = await day(a);
    expect(await assertOwnsMediaTarget(a, "TRADING_DAY", id)).toBe(true);
    expect(await assertOwnsMediaTarget(b, "TRADING_DAY", id)).toBe(false);
    expect(await assertOwnsMediaTarget(a, "TRADING_DAY", "does-not-exist")).toBe(false);
  });
});

describe("POST /api/media/upload with ownerType TRADING_DAY", () => {
  it("attaches an image to a plan section of the trader's own day", async () => {
    const userId = await user("upload");
    const id = await day(userId);
    signIn(userId);
    const res = await upload(uploadRequest(id, "NEWS"));
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ mimeType: "image/webp", category: "NEWS" });
    expect((await listMedia(userId, "TRADING_DAY", id)).map((m) => m.id)).toEqual([items[0].id]);
  });

  it("refuses another user's day and writes nothing", async () => {
    const owner = await user("upload-owner");
    const other = await user("upload-other");
    const id = await day(owner);
    signIn(other);
    const res = await upload(uploadRequest(id));
    expect(res.status).toBe(403);
    expect(await prisma.mediaAttachment.count({ where: { ownerType: "TRADING_DAY", ownerId: id } })).toBe(0);
    expect(vi.mocked(mediaStorage.saveMediaFile)).not.toHaveBeenCalled();
  });

  it("refuses an upload on an archived day", async () => {
    const userId = await user("upload-archived");
    const id = await day(userId, "2024-05-14");
    await runLive(() => archivePastActiveDays(userId, "2026-09-26"));
    signIn(userId);
    const res = await upload(uploadRequest(id));
    expect(res.status).toBe(403);
    expect(await prisma.mediaAttachment.count({ where: { ownerType: "TRADING_DAY", ownerId: id } })).toBe(0);
  });

  it("works for a day inside a Backtest Run (the day's own environment)", async () => {
    const userId = await user("upload-bt");
    const run = await createBacktestRun(userId, createBacktestRunSchema.parse({ name: "Run", assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-05-31" }));
    const id = await runInBacktestRun(userId, run.id, () => day(userId));
    signIn(userId);
    expect((await upload(uploadRequest(id))).status).toBe(200);
    expect(await listMedia(userId, "TRADING_DAY", id)).toHaveLength(1);
  });
});

describe("cleanup", () => {
  it("deleting live Today plans removes live plan images and keeps a Backtest Run's", async () => {
    const userId = await user("dm");
    const liveKey = await attach(userId, await day(userId));
    const run = await createBacktestRun(userId, createBacktestRunSchema.parse({ name: "Run", assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-05-31" }));
    const btKey = await runInBacktestRun(userId, run.id, async () => attach(userId, await day(userId)));

    await deleteDataSection(userId, "today-plans");

    expect(await assetExists(liveKey)).toBe(false);
    expect(await assetExists(btKey)).toBe(true);
    expect(vi.mocked(mediaStorage.deleteMediaFile).mock.calls.map((c) => c[0])).toEqual([liveKey]);
  });

  it("deleting a Backtest Run removes its plan images and keeps live ones", async () => {
    const userId = await user("bt-delete");
    const liveKey = await attach(userId, await day(userId));
    const run = await createBacktestRun(userId, createBacktestRunSchema.parse({ name: "Run", assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-05-31" }));
    const btKey = await runInBacktestRun(userId, run.id, async () => attach(userId, await day(userId)));

    await deleteBacktestRun(userId, run.id);

    expect(await assetExists(btKey)).toBe(false);
    expect(await assetExists(liveKey)).toBe(true);
    expect(vi.mocked(mediaStorage.deleteMediaFile).mock.calls.map((c) => c[0])).toEqual([btKey]);
  });
});
