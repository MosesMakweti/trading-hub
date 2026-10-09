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
import { createOpportunity, logMissedOutcome } from "@/server/services/opportunity.service";
import { createStrategy } from "@/server/services/strategies.service";
import { runLive } from "@/server/workspace/scope";
import { POST as upload } from "@/app/api/media/upload/route";

/** Images on missed opportunities (MediaOwnerType OPPORTUNITY). */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
beforeEach(() => {
  vi.mocked(mediaStorage.deleteMediaFile).mockClear();
  vi.mocked(mediaStorage.saveMediaFile).mockClear();
  vi.mocked(auth).mockReset();
});

async function user(label: string) {
  const u = await createTestUser(`opp-media-${label}`);
  userIds.push(u.id);
  return u.id;
}

async function missedOpportunity(userId: string, dateKey = "2024-05-14") {
  const strategy = await createStrategy(userId, { name: `S ${Math.random().toString(36).slice(2)}`, description: undefined });
  const input = {
    strategyId: strategy.id, assetSymbol: "EURUSD", direction: "LONG", timeframe: null, selectedConfluences: [], selectedExecution: [],
    plannedEntry: null, plannedStopLoss: null, plannedTarget: null, plannedRR: null,
  } as Parameters<typeof createOpportunity>[2];
  const opp = await createOpportunity(userId, dateKey, input);
  await logMissedOutcome(userId, opp.id, { missReason: "HESITATION", missNote: null, missedOutcome: "MISSED_UNDETERMINED", missedRealizedR: null });
  return opp.id;
}

function uploadRequest(ownerId: string) {
  const form = new FormData();
  form.set("ownerType", "OPPORTUNITY");
  form.set("ownerId", ownerId);
  form.append("files", new File([new Uint8Array([137, 80, 78, 71])], "chart.png", { type: "image/png" }));
  return new Request("http://localhost/api/media/upload", { method: "POST", body: form });
}

const signIn = (userId: string) => vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);

async function attach(userId: string, opportunityId: string) {
  const storageKey = `${userId}/${crypto.randomUUID()}.png`;
  await attachMedia({ userId, ownerType: "OPPORTUNITY", ownerId: opportunityId, category: null, timeframe: null, storageKey, fileName: "a.png", mimeType: "image/png", fileSize: 1 });
  return storageKey;
}
const assetExists = async (storageKey: string) => (await prisma.mediaAsset.count({ where: { storageKey } })) === 1;

describe("ownership", () => {
  it("only the owner of the opportunity can attach images to it", async () => {
    const a = await user("own-a");
    const b = await user("own-b");
    const id = await missedOpportunity(a);
    expect(await assertOwnsMediaTarget(a, "OPPORTUNITY", id)).toBe(true);
    expect(await assertOwnsMediaTarget(b, "OPPORTUNITY", id)).toBe(false);
    expect(await assertOwnsMediaTarget(a, "OPPORTUNITY", "does-not-exist")).toBe(false);
  });
});

describe("POST /api/media/upload with ownerType OPPORTUNITY", () => {
  it("attaches an image to the trader's own missed opportunity", async () => {
    const userId = await user("upload");
    const id = await missedOpportunity(userId);
    signIn(userId);
    const res = await upload(uploadRequest(id));
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ mimeType: "image/png", fileName: "chart.png" });
    expect((await listMedia(userId, "OPPORTUNITY", id)).map((m) => m.id)).toEqual([items[0].id]);
  });

  it("refuses another user's opportunity and writes nothing", async () => {
    const owner = await user("upload-owner");
    const other = await user("upload-other");
    const id = await missedOpportunity(owner);
    signIn(other);
    const res = await upload(uploadRequest(id));
    expect(res.status).toBe(403);
    expect(await prisma.mediaAttachment.count({ where: { ownerType: "OPPORTUNITY", ownerId: id } })).toBe(0);
    expect(vi.mocked(mediaStorage.saveMediaFile)).not.toHaveBeenCalled();
  });

  it("refuses an upload on an archived day, like a trade", async () => {
    const userId = await user("upload-archived");
    const id = await missedOpportunity(userId, "2024-05-14");
    await getOrCreateTradingDay(userId, "2024-05-14");
    await runLive(() => archivePastActiveDays(userId, "2026-09-26"));
    signIn(userId);
    const res = await upload(uploadRequest(id));
    expect(res.status).toBe(403);
    expect(await prisma.mediaAttachment.count({ where: { ownerType: "OPPORTUNITY", ownerId: id } })).toBe(0);
  });

  it("works for a missed setup inside a Backtest Run (the opportunity's own environment)", async () => {
    const userId = await user("upload-bt");
    const run = await createBacktestRun(userId, createBacktestRunSchema.parse({ name: "Run", assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-05-31" }));
    const id = await runInBacktestRun(userId, run.id, () => missedOpportunity(userId));
    signIn(userId);
    expect((await upload(uploadRequest(id))).status).toBe(200);
    expect(await listMedia(userId, "OPPORTUNITY", id)).toHaveLength(1);
  });
});

describe("cleanup", () => {
  it("deleting live Journal & Trades removes live opportunity images and keeps a Backtest Run's", async () => {
    const userId = await user("dm");
    const liveKey = await attach(userId, await missedOpportunity(userId));
    const run = await createBacktestRun(userId, createBacktestRunSchema.parse({ name: "Run", assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-05-31" }));
    const btKey = await runInBacktestRun(userId, run.id, async () => attach(userId, await missedOpportunity(userId)));

    await deleteDataSection(userId, "journal-trades");

    expect(await assetExists(liveKey)).toBe(false);
    expect(await assetExists(btKey)).toBe(true);
    expect(vi.mocked(mediaStorage.deleteMediaFile).mock.calls.map((c) => c[0])).toEqual([liveKey]);
  });

  it("deleting a Backtest Run removes its opportunity images and keeps live ones", async () => {
    const userId = await user("bt-delete");
    const liveKey = await attach(userId, await missedOpportunity(userId));
    const run = await createBacktestRun(userId, createBacktestRunSchema.parse({ name: "Run", assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-05-31" }));
    const btKey = await runInBacktestRun(userId, run.id, async () => attach(userId, await missedOpportunity(userId)));

    await deleteBacktestRun(userId, run.id);

    expect(await assetExists(btKey)).toBe(false);
    expect(await assetExists(liveKey)).toBe(true);
    expect(vi.mocked(mediaStorage.deleteMediaFile).mock.calls.map((c) => c[0])).toEqual([btKey]);
  });
});
