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
import { closePosition, placeOrder } from "./sim-execution.service";
import { advanceSimClock } from "./sim-clock.service";
import { deleteDataSection, getDataCounts } from "@/server/services/data-management.service";
import { saveDrawing as saveRunDrawing, listDrawings as listRunDrawings } from "@/server/services/native-replay/chart-drawing.service";
import { SimNotFoundError } from "./sim-account.service";
import { createFirmModel, purchaseChallenge } from "./sim-prop.service";
import { addSetup, createStudy, getStudyDetail, recordObservation } from "./sim-study.service";
import { applyLibraryQuery, bulkDelete, bulkSetArchived, deleteSession, deletionImpact, duplicateLabAccount, listLibrary, renameSession, setSessionArchived, type LibrarySession } from "./session-library.service";

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
    expect(byId.get(prop.id)).toMatchObject({ kind: "PROP", can: { delete: true, duplicate: false, archive: true } });
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
    createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z", counts: { trades: 0, orders: 0, drawings: 0, observations: 0 }, performance: null, href: "", can: { rename: true, duplicate: true, archive: true, delete: true }, deleteNote: null, ...over,
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

const drawingOf = (id: string) => ({ id, type: "HLINE" as const, assetSymbol: "EURUSD", anchors: [{ time: 1, price: 1.08 }], style: { color: "#8ab4f8", width: 1 as const, dash: "solid" as const, opacity: 1 }, data: {}, locked: false, hidden: false });
const childCounts = async (accountId: string) => ({
  orders: await prisma.simOrder.count({ where: { accountId } }),
  fills: await prisma.simFill.count({ where: { accountId } }),
  positions: await prisma.simPosition.count({ where: { accountId } }),
  ledger: await prisma.simLedgerEntry.count({ where: { accountId } }),
  events: await prisma.simEvent.count({ where: { accountId } }),
  pins: await prisma.simDatasetPin.count({ where: { accountId } }),
  drawings: await prisma.simChartDrawing.count({ where: { accountId } }),
});

describe("session deletion — dependent data, integrity and races", () => {
  it("a session with many trades: every dependent row goes; other sessions, datasets and other users are untouched; performance is listed", async () => {
    const { userId, lab, datasets } = await setup("many");
    const other = await createLabAccount(userId, { name: "Keep me", datasets, periodStart: "2024-05-14", periodEnd: "2024-05-14", startingBalance: 5000, currency: "USD" });
    const stranger = await setup("many-other");
    await startSimClock(userId, lab.id);
    for (let i = 0; i < 25; i++) {
      const o = await placeOrder(userId, lab.id, { symbol: "EURUSD", side: i % 2 ? "SELL" : "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "0.1" } });
      await closePosition(userId, lab.id, o.positionId!, {});
    }
    await saveSimDrawing(userId, lab.id, drawingOf("many-draw-1"));
    await saveSimDrawing(userId, other.id, drawingOf("many-draw-2"));

    const row = (await listLibrary(userId, { scope: "all" })).find((s) => s.id === lab.id)!;
    expect(row.counts.trades).toBe(25);
    expect(row.performance).toMatchObject({ currency: "USD", closedTrades: 25, openPositions: 0 });
    expect(typeof row.performance!.netResult).toBe("number");

    const before = await childCounts(lab.id);
    expect(before.orders).toBeGreaterThanOrEqual(25);
    expect(before.fills).toBeGreaterThanOrEqual(50);
    const keep = await childCounts(other.id);
    await deleteSession(userId, "LAB", lab.id);
    expect(await childCounts(lab.id)).toEqual({ orders: 0, fills: 0, positions: 0, ledger: 0, events: 0, pins: 0, drawings: 0 });
    expect(await childCounts(other.id)).toEqual(keep); // the user's other session
    expect(await prisma.simAccount.findUnique({ where: { id: stranger.lab.id } })).not.toBeNull(); // another user's
    expect(await prisma.historicalDataset.count({ where: { id: datasets[0].datasetId } })).toBe(1); // shared dataset kept
  });

  it("a session with no trades deletes cleanly", async () => {
    const { userId, lab } = await setup("empty");
    expect(await deletionImpact(userId, "LAB", lab.id)).toMatchObject({ trades: 0, orders: 0, drawings: 0, allowed: true });
    await deleteSession(userId, "LAB", lab.id);
    expect(await prisma.simAccount.findUnique({ where: { id: lab.id } })).toBeNull();
  });

  it("a database failure deletes nothing", async () => {
    const { userId, lab } = await setup("fail");
    await saveSimDrawing(userId, lab.id, drawingOf("fail-draw-1"));
    const before = await childCounts(lab.id);
    const spy = vi.spyOn(prisma.simAccount, "deleteMany").mockRejectedValueOnce(new Error("connection reset"));
    await expect(deleteSession(userId, "LAB", lab.id)).rejects.toThrow(/connection reset/);
    spy.mockRestore();
    expect(await prisma.simAccount.findUnique({ where: { id: lab.id } })).not.toBeNull();
    expect(await childCounts(lab.id)).toEqual(before);
  });

  it("duplicate delete requests: exactly one succeeds, the other is 'not found' — nothing else happens", async () => {
    const { userId, lab, datasets } = await setup("dup");
    const sibling = await createLabAccount(userId, { name: "Sibling", datasets, periodStart: "2024-05-14", periodEnd: "2024-05-14", startingBalance: 1000, currency: "USD" });
    const results = await Promise.allSettled([deleteSession(userId, "LAB", lab.id), deleteSession(userId, "LAB", lab.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(SimNotFoundError);
    await expect(deleteSession(userId, "LAB", lab.id)).rejects.toBeInstanceOf(SimNotFoundError);
    expect(await prisma.simAccount.findUnique({ where: { id: sibling.id } })).not.toBeNull();
  });

  it("an open session deleted mid-replay: late steps, orders and drawing saves fail and recreate nothing", async () => {
    const { userId, lab } = await setup("open");
    await startSimClock(userId, lab.id);
    await deleteSession(userId, "LAB", lab.id);
    await expect(advanceSimClock(userId, lab.id, { kind: "BARS", count: 1 })).rejects.toThrow();
    await expect(placeOrder(userId, lab.id, { symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "1" } })).rejects.toThrow();
    await expect(saveSimDrawing(userId, lab.id, drawingOf("late-draw-1"))).rejects.toThrow();
    expect(await childCounts(lab.id)).toEqual({ orders: 0, fills: 0, positions: 0, ledger: 0, events: 0, pins: 0, drawings: 0 });
  });

  it("a legacy run with drawings is deleted with them", async () => {
    const { userId } = await setup("legacy");
    const run = await createBacktestRun(userId, createBacktestRunSchema.parse({ name: "Old run", assets: ["EURUSD"], startDate: "2024-01-01", endDate: "2024-01-31", tradingWeekdays: [1, 2, 3, 4, 5] }));
    await saveRunDrawing(userId, run.id, { ...drawingOf("8f0c1d1e-0000-4000-8000-000000000001") });
    expect(await listRunDrawings(userId, run.id, "EURUSD")).toHaveLength(1);
    expect((await deletionImpact(userId, "LEGACY", run.id)).drawings).toBe(1);
    await deleteSession(userId, "LEGACY", run.id);
    expect(await prisma.backtestRun.findUnique({ where: { id: run.id } })).toBeNull();
    expect(await prisma.replayChartDrawing.count({ where: { backtestRunId: run.id } })).toBe(0);
  });
});

describe("bulk archive / restore / delete", () => {
  it("archives and restores several at once; deletes several (Lab + legacy) at once", async () => {
    const { userId, lab, datasets } = await setup("bulk");
    const lab2 = await createLabAccount(userId, { name: "B2", datasets, periodStart: "2024-05-14", periodEnd: "2024-05-14", startingBalance: 1000, currency: "USD" });
    const run = await createBacktestRun(userId, createBacktestRunSchema.parse({ name: "Bulk run", assets: ["EURUSD"], startDate: "2024-01-01", endDate: "2024-01-31", tradingWeekdays: [1, 2, 3, 4, 5] }));
    const refs = [{ kind: "LAB" as const, id: lab.id }, { kind: "LAB" as const, id: lab2.id }, { kind: "LEGACY" as const, id: run.id }];
    expect(await bulkSetArchived(userId, refs, true)).toBe(3);
    expect((await listLibrary(userId, { scope: "archived" })).map((s) => s.id).sort()).toEqual([lab.id, lab2.id, run.id].sort());
    expect(await bulkSetArchived(userId, refs, false)).toBe(3);
    expect((await listLibrary(userId, { scope: "archived" }))).toHaveLength(0);
    expect(await prisma.backtestRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ archivedAt: null });

    expect(await bulkDelete(userId, [...refs, refs[0]])).toBe(3); // duplicates in the selection are ignored
    expect(await prisma.simAccount.count({ where: { id: { in: [lab.id, lab2.id] } } })).toBe(0);
    expect(await prisma.backtestRun.count({ where: { id: run.id } })).toBe(0);
  });

  it("refuses the whole batch if any session isn't the user's — nothing is deleted; Prop Firm challenges can be bulk-deleted", async () => {
    const a = await setup("bulk-a");
    const b = await setup("bulk-b");
    await expect(bulkDelete(a.userId, [{ kind: "LAB", id: a.lab.id }, { kind: "LAB", id: b.lab.id }])).rejects.toThrow();
    await expect(bulkSetArchived(a.userId, [{ kind: "LAB", id: a.lab.id }, { kind: "LAB", id: b.lab.id }], true)).rejects.toThrow();
    expect(await prisma.simAccount.findUniqueOrThrow({ where: { id: a.lab.id } })).toMatchObject({ archivedAt: null });

    const model = await createFirmModel(a.userId, MODEL);
    const { account: prop } = await purchaseChallenge(a.userId, { modelRef: model.id, accountSize: 10_000, datasets: a.datasets, periodStart: "2024-05-14", periodEnd: "2024-05-14" });
    // Another user's session in the batch → nothing deleted, Prop or not.
    await expect(bulkDelete(a.userId, [{ kind: "PROP", id: prop.id }, { kind: "LAB", id: b.lab.id }])).rejects.toThrow();
    expect(await prisma.simAccount.count({ where: { id: { in: [a.lab.id, prop.id, b.lab.id] } } })).toBe(3);
    await expect(bulkDelete(a.userId, [])).rejects.toThrow(/at least one/);
    // Lab + Prop together: one transaction; the challenge goes with its account.
    expect(await bulkDelete(a.userId, [{ kind: "LAB", id: a.lab.id }, { kind: "PROP", id: prop.id }])).toBe(2);
    expect(await prisma.simAccount.count({ where: { id: { in: [a.lab.id, prop.id] } } })).toBe(0);
    expect(await prisma.simChallenge.count({ where: { userId: a.userId } })).toBe(0);
    expect(await prisma.simAccount.count({ where: { id: b.lab.id } })).toBe(1);
  });
});

describe("Prop Firm challenges can be deleted", () => {
  it("deleting a stage deletes the whole challenge — every stage, trades, ledger, breach and payout records; the firm model, other challenges and Lab sessions stay", async () => {
    const { userId, lab, datasets } = await setup("prop-del");
    const model = await createFirmModel(userId, MODEL);
    const { challenge, account: p1 } = await purchaseChallenge(userId, { modelRef: model.id, accountSize: 10_000, datasets, periodStart: "2024-05-14", periodEnd: "2024-05-14" });
    const { challenge: other } = await purchaseChallenge(userId, { modelRef: model.id, accountSize: 10_000, datasets, periodStart: "2024-05-14", periodEnd: "2024-05-14" });
    await startSimClock(userId, p1.id);
    const o = await placeOrder(userId, p1.id, { symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "0.1" } });
    await closePosition(userId, p1.id, o.positionId!, {});
    // A second stage and the append-only records a challenge can carry.
    const p2 = await prisma.simAccount.create({ data: { userId, product: "PROP_FIRM", kind: "FUNDED", name: "Funded", currency: "USD", startingBalance: 10_000, rules: p1.rules as object, assets: ["EURUSD"], periodStart: p1.periodStart, periodEnd: p1.periodEnd, challengeId: challenge.id, phaseIndex: 1, ledgerSequence: 0 } });
    await prisma.simBreach.create({ data: { userId, accountId: p1.id, rule: "MAX_LOSS", minute: 1, balance: 9000, equity: 9000, measured: 9000, floor: 9000, detail: "test", contributors: [], floatingInvolved: false } });
    await prisma.simPayout.create({ data: { userId, accountId: p2.id, sequence: 1, minute: 1, eligibleProfit: 100, grossPayout: 100, traderShare: 80, firmShare: 20, splitPercent: 80, balanceBefore: 10_100, balanceAfter: 10_000 } });

    const listed = (await listLibrary(userId, { scope: "all" })).find((x) => x.id === p1.id)!;
    expect(listed.can.delete).toBe(true);
    expect(listed.deleteNote).toMatch(/whole challenge — all 2/);
    const impact = await deletionImpact(userId, "PROP", p2.id);
    expect(impact).toMatchObject({ allowed: true, trades: 1 });
    expect(impact.note).toMatch(/whole challenge/);

    await deleteSession(userId, "PROP", p2.id); // from any stage
    expect(await prisma.simChallenge.findUnique({ where: { id: challenge.id } })).toBeNull();
    expect(await prisma.simAccount.count({ where: { id: { in: [p1.id, p2.id] } } })).toBe(0);
    expect(await childCounts(p1.id)).toEqual({ orders: 0, fills: 0, positions: 0, ledger: 0, events: 0, pins: 0, drawings: 0 });
    expect(await prisma.simBreach.count({ where: { accountId: p1.id } })).toBe(0);
    expect(await prisma.simPayout.count({ where: { accountId: p2.id } })).toBe(0);
    expect(await prisma.simChallenge.findUnique({ where: { id: other.id } })).not.toBeNull();
    expect(await prisma.simFirmModel.findUnique({ where: { id: model.id } })).not.toBeNull();
    expect(await prisma.simAccount.findUnique({ where: { id: lab.id } })).not.toBeNull();

    // deleteSimAccount follows the same rule; another user can't do either.
    const stranger = await setup("prop-del-x");
    const otherStage = await prisma.simAccount.findFirstOrThrow({ where: { challengeId: other.id } });
    await expect(deleteSession(stranger.userId, "PROP", otherStage.id)).rejects.toThrow();
    await expect(deleteSimAccount(stranger.userId, otherStage.id)).rejects.toThrow();
    await deleteSimAccount(userId, otherStage.id);
    expect(await prisma.simChallenge.findUnique({ where: { id: other.id } })).toBeNull();
  });

  it("Data management → Backtesting removes every simulation session too, and only the user's", async () => {
    const { userId, datasets } = await setup("wipe");
    const stranger = await setup("wipe-x");
    const model = await createFirmModel(userId, MODEL);
    await purchaseChallenge(userId, { modelRef: model.id, accountSize: 10_000, datasets, periodStart: "2024-05-14", periodEnd: "2024-05-14" });
    await createBacktestRun(userId, createBacktestRunSchema.parse({ name: "Run", assets: ["EURUSD"], startDate: "2024-01-01", endDate: "2024-01-31", tradingWeekdays: [1, 2, 3, 4, 5] }));
    const before = await getDataCounts(userId);
    expect(before.simSessions).toBe(2); // the Lab account + the challenge
    expect(before.backtestRuns).toBe(1);
    await deleteDataSection(userId, "backtesting");
    expect(await getDataCounts(userId)).toMatchObject({ simSessions: 0, backtestRuns: 0 });
    expect(await prisma.simAccount.count({ where: { userId } })).toBe(0);
    expect(await prisma.historicalDataset.count({ where: { userId } })).toBe(1); // data imports kept
    expect(await prisma.simAccount.count({ where: { id: stranger.lab.id } })).toBe(1);
  });
});

