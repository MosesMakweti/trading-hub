import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/media-storage", async (orig) => ({ ...(await orig<object>()), deleteMediaFile: vi.fn(async () => undefined) }));

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { mt5Text } from "@/domain/native-replay/testing/m1-fixtures";
import type { FirmModelInput } from "@/domain/simulation/firm-model";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun } from "@/server/services/backtest-run.service";
import { saveSimDrawing } from "@/server/services/charting/sim-drawing.service";
import { createLabAccount, deleteSimAccount, startSimClock } from "./sim-account.service";
import { placeOrder } from "./sim-execution.service";
import { createFirmModel, purchaseChallenge } from "./sim-prop.service";
import { addSetup, createStudy, getStudyDetail, recordObservation } from "./sim-study.service";
import { applyLibraryQuery, deleteSession, deletionImpact, duplicateLabAccount, listLibrary, renameSession, setSessionArchived, type LibrarySession } from "./session-library.service";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

const rows = [
  ["09:00", "1.08000", "1.08000", "1.08000", "1.08000"],
  ["09:01", "1.08000", "1.08100", "1.07900", "1.08050"],
].map(([t, o, h, l, c]) => ["2024.05.14", t, o, h, l, c, "10", "0", "0"]);

const MODEL: FirmModelInput = {
  firmName: "Lib Firm",
  modelName: "One-step",
  challengeType: "ONE_STEP",
  sizes: [{ accountSize: 10_000, fee: 99 }],
  phases: [{ name: "Phase 1", profitTargetPercent: 10, minTradingDays: 1, maxLoss: { limitPercent: 10, model: "STATIC" } }],
  funded: { maxLoss: { limitPercent: 10, model: "STATIC" }, payout: { profitSplitPercent: 80, firstPayoutAfterDays: 0, cycleDays: 1, minPayoutAmount: 10 } },
};

async function setup(label: string) {
  const u = await createTestUser(`lib-${label}`);
  userIds.push(u.id);
  const ds = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(mt5Text(rows)), fileName: "EURUSD_M1_202405140900_202405140901.csv" });
  const datasets = [{ assetSymbol: "EURUSD", datasetId: ds.id }];
  const lab = await createLabAccount(u.id, { name: "London breakout", datasets, periodStart: "2024-05-14", periodEnd: "2024-05-14", startingBalance: 10000, currency: "USD" });
  return { userId: u.id, lab, datasets };
}

describe("session library", () => {
  it("lists Lab, Prop and legacy sessions with counts; renames; duplicates a Lab backtest fresh", async () => {
    const { userId, lab, datasets } = await setup("list");
    await startSimClock(userId, lab.id);
    await placeOrder(userId, lab.id, { symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "1" } });
    await saveSimDrawing(userId, lab.id, { id: "lib-draw-1", type: "HLINE", assetSymbol: "EURUSD", anchors: [{ time: 1, price: 1.08 }], style: { color: "#8ab4f8", width: 1, dash: "solid", opacity: 1 }, data: {}, locked: false, hidden: false });
    const model = await createFirmModel(userId, MODEL);
    const { account: prop } = await purchaseChallenge(userId, { modelRef: model.id, accountSize: 10_000, datasets, periodStart: "2024-05-14", periodEnd: "2024-05-14" });
    const run = await createBacktestRun(userId, createBacktestRunSchema.parse({ name: "Old run", assets: ["EURUSD"], startDate: "2024-01-01", endDate: "2024-01-31", tradingWeekdays: [1, 2, 3, 4, 5] }));

    const list = await listLibrary(userId, { scope: "all" });
    const byId = new Map(list.map((s) => [s.id, s]));
    expect(byId.get(lab.id)).toMatchObject({ kind: "LAB", counts: { trades: 1, orders: 1, drawings: 1 }, can: { delete: true, duplicate: true }, clock: "2024-05-14T09:00" });
    expect(byId.get(prop.id)).toMatchObject({ kind: "PROP", can: { delete: false, duplicate: false, archive: true } });
    expect(byId.get(run.id)).toMatchObject({ kind: "LEGACY", href: `/backtesting/${run.id}` });

    await renameSession(userId, "LAB", lab.id, "  London breakout v2 ");
    expect((await listLibrary(userId, { q: "v2" })).map((s) => s.id)).toEqual([lab.id]);
    await expect(renameSession(userId, "LAB", lab.id, "   ")).rejects.toThrow(/1–120/);
    // Kind must match the row: a Lab id can't be addressed as Prop (or the other way round).
    await expect(renameSession(userId, "PROP", lab.id, "x")).rejects.toThrow();

    const copy = await duplicateLabAccount(userId, lab.id);
    expect(copy).toMatchObject({ name: "London breakout v2 (copy)", status: "CREATED", currentMinute: null, assets: ["EURUSD"] });
    expect(await prisma.simPosition.count({ where: { accountId: copy.id } })).toBe(0);
    await expect(duplicateLabAccount(userId, prop.id)).rejects.toThrow(/Only Strategy Lab/);
  });

  it("archive is a reversible flag; Prop accounts can't be deleted; delete cascades and keeps study observations", async () => {
    const { userId, lab } = await setup("archive");
    await startSimClock(userId, lab.id);
    await setSessionArchived(userId, "LAB", lab.id, true);
    expect((await listLibrary(userId)).some((s) => s.id === lab.id)).toBe(false);
    expect((await listLibrary(userId, { scope: "archived" })).map((s) => s.id)).toContain(lab.id);
    await setSessionArchived(userId, "LAB", lab.id, false);
    expect(await prisma.simAccount.findUniqueOrThrow({ where: { id: lab.id } })).toMatchObject({ status: "ACTIVE", archivedAt: null });
    // An old-style archive (status ARCHIVED) restores to a status that fits the account.
    await prisma.simAccount.update({ where: { id: lab.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    await setSessionArchived(userId, "LAB", lab.id, false);
    expect((await prisma.simAccount.findUniqueOrThrow({ where: { id: lab.id } })).status).toBe("ACTIVE");

    const model = await createFirmModel(userId, MODEL);
    const ds = await prisma.simDatasetPin.findFirstOrThrow({ where: { accountId: lab.id } });
    const { account: prop } = await purchaseChallenge(userId, { modelRef: model.id, accountSize: 10_000, datasets: [{ assetSymbol: "EURUSD", datasetId: ds.datasetId }], periodStart: "2024-05-14", periodEnd: "2024-05-14" });
    expect(await deletionImpact(userId, "PROP", prop.id)).toMatchObject({ allowed: false });
    await expect(deleteSession(userId, "PROP", prop.id)).rejects.toThrow(/financial records/);
    await expect(deleteSimAccount(userId, prop.id)).rejects.toThrow(/financial records/);
    await setSessionArchived(userId, "PROP", prop.id, true);
    await setSessionArchived(userId, "PROP", prop.id, false);
    expect(await prisma.simAccount.findUniqueOrThrow({ where: { id: prop.id } })).toMatchObject({ archivedAt: null, status: "CREATED" });

    const study = await createStudy(userId, { name: "S" });
    await addSetup(userId, study.id, "A");
    await recordObservation(userId, { studyId: study.id, accountId: lab.id, kind: "NOT_TRADED", symbol: "EURUSD" });
    expect(await deletionImpact(userId, "LAB", lab.id)).toMatchObject({ allowed: true, observations: 1 });
    await deleteSession(userId, "LAB", lab.id);
    expect(await prisma.simAccount.findUnique({ where: { id: lab.id } })).toBeNull();
    expect((await getStudyDetail(userId, study.id)).observations).toHaveLength(1);
  });

  it("never lets another user see or change a session", async () => {
    const a = await setup("owner-a");
    const b = await setup("owner-b");
    expect((await listLibrary(b.userId, { scope: "all" })).some((s) => s.id === a.lab.id)).toBe(false);
    await expect(renameSession(b.userId, "LAB", a.lab.id, "mine")).rejects.toThrow();
    await expect(setSessionArchived(b.userId, "LAB", a.lab.id, true)).rejects.toThrow();
    await expect(duplicateLabAccount(b.userId, a.lab.id)).rejects.toThrow();
    await expect(deletionImpact(b.userId, "LAB", a.lab.id)).rejects.toThrow();
    await expect(deleteSession(b.userId, "LAB", a.lab.id)).rejects.toThrow();
    expect(await prisma.simAccount.findUnique({ where: { id: a.lab.id } })).not.toBeNull();
  });
});

describe("applyLibraryQuery", () => {
  const s = (id: string, over: Partial<LibrarySession>): LibrarySession => ({
    kind: "LAB", id, name: id, status: "ACTIVE", archived: false, assets: ["EURUSD"], periodStart: "2024-01-01", periodEnd: "2024-01-31", clock: null,
    createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z", counts: { trades: 0, orders: 0, drawings: 0, observations: 0 }, href: "", can: { rename: true, duplicate: true, archive: true, delete: true }, deleteNote: null, ...over,
  });
  const list = [s("beta", { updatedAt: "2024-03-01T00:00:00Z", counts: { trades: 5, orders: 0, drawings: 0, observations: 0 } }), s("Alpha", { kind: "PROP", assets: ["XAUUSD"] }), s("gamma", { archived: true })];
  it("filters by scope, kind and text (name or instrument) and sorts", () => {
    expect(applyLibraryQuery(list, {}).map((x) => x.id)).toEqual(["beta", "Alpha"]);
    expect(applyLibraryQuery(list, { scope: "archived" }).map((x) => x.id)).toEqual(["gamma"]);
    expect(applyLibraryQuery(list, { kind: "PROP" }).map((x) => x.id)).toEqual(["Alpha"]);
    expect(applyLibraryQuery(list, { q: "xau" }).map((x) => x.id)).toEqual(["Alpha"]);
    expect(applyLibraryQuery(list, { sort: "name", scope: "all" }).map((x) => x.id)).toEqual(["Alpha", "beta", "gamma"]);
    expect(applyLibraryQuery(list, { sort: "trades" })[0].id).toBe("beta");
  });
});
