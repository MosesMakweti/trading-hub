import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { mt5Text } from "@/domain/native-replay/testing/m1-fixtures";
import { createLabAccount } from "@/server/services/simulation/sim-account.service";
import type { ChartDrawing } from "@/domain/native-replay/drawings/model";
import { deleteSimDrawing, linkDrawingToOrder, listSimDrawings, requireOrderDrawing, saveSimDrawing } from "./sim-drawing.service";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

async function account(label: string) {
  const u = await createTestUser(`simdraw-${label}`);
  userIds.push(u.id);
  const rows = [["2024.05.14", "09:00", "1.08000", "1.08000", "1.08000", "1.08000", "10", "0", "0"]];
  const ds = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(mt5Text(rows)), fileName: "EURUSD_M1_202405140900_202405140900.csv" });
  const acct = await createLabAccount(u.id, { name: "D", datasets: [{ assetSymbol: "EURUSD", datasetId: ds.id }], periodStart: "2024-05-14", periodEnd: "2024-05-14", startingBalance: 10000, currency: "USD" });
  return { userId: u.id, accountId: acct.id };
}

const line = (id: string): Omit<ChartDrawing, "linkedTradeId"> => ({
  id,
  type: "TREND",
  assetSymbol: "EURUSD",
  anchors: [{ time: 100, price: 1.08 }, { time: 200, price: 1.09 }],
  style: { color: "#8ab4f8", width: 2, dash: "solid", opacity: 1 },
  data: {},
  locked: false,
  hidden: false,
});

describe("simulation chart drawings", () => {
  it("creates, updates (upsert), lists and deletes per account + instrument", async () => {
    const { userId, accountId } = await account("crud");
    await saveSimDrawing(userId, accountId, line("draw-0001"));
    await saveSimDrawing(userId, accountId, { ...line("draw-0001"), locked: true });
    const list = await listSimDrawings(userId, accountId, "EURUSD");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "draw-0001", locked: true, linkedTradeId: null });
    await deleteSimDrawing(userId, accountId, "EURUSD", "draw-0001");
    expect(await listSimDrawings(userId, accountId, "EURUSD")).toEqual([]);
  });

  it("validates, isolates users and freezes ended accounts", async () => {
    const a = await account("iso-a");
    const b = await account("iso-b");
    await expect(saveSimDrawing(a.userId, a.accountId, { ...line("draw-0002"), anchors: [{ time: 1, price: 1 }] })).rejects.toThrow(/needs 2 anchor/);
    await expect(saveSimDrawing(a.userId, a.accountId, { ...line("draw-0003"), assetSymbol: "GBPUSD" })).rejects.toThrow(/isn't one of/);
    await saveSimDrawing(a.userId, a.accountId, line("draw-0004"));
    // b can't read or overwrite a's drawing, even with its id on b's own account.
    await expect(listSimDrawings(b.userId, a.accountId, "EURUSD")).rejects.toThrow();
    await expect(saveSimDrawing(b.userId, b.accountId, line("draw-0004"))).rejects.toThrow(/not found/);
    // The database refuses a drawing whose user doesn't own the account.
    await expect(prisma.simChartDrawing.create({ data: { id: "draw-0005", userId: b.userId, accountId: a.accountId, assetSymbol: "EURUSD", type: "TREND", anchors: [], style: {} } })).rejects.toThrow(/SIM_OWNERSHIP/);
    await prisma.simAccount.update({ where: { id: a.accountId }, data: { status: "COMPLETED" } });
    await expect(saveSimDrawing(a.userId, a.accountId, line("draw-0006"))).rejects.toThrow(/ended/);
    expect(await listSimDrawings(a.userId, a.accountId, "EURUSD")).toHaveLength(1);
  });

  it("links a position drawing to an order server-side; clients can't forge or clear the link", async () => {
    const a = await account("link-a");
    const b = await account("link-b");
    const long: Omit<ChartDrawing, "linkedTradeId"> = { ...line("draw-l001"), type: "LONG", anchors: [{ time: 100, price: 1.08 }, { time: 200, price: 1.08 }], data: { position: { entry: 1.08, stop: 1.079, targets: [1.082] } } };
    await saveSimDrawing(a.userId, a.accountId, long);
    await saveSimDrawing(a.userId, a.accountId, line("draw-t001"));
    // Side must match direction; only position drawings; only the owner's.
    await expect(requireOrderDrawing(a.userId, a.accountId, "EURUSD", "draw-l001", "SELL")).rejects.toThrow(/long position drawing can't place a sell/);
    await expect(requireOrderDrawing(a.userId, a.accountId, "EURUSD", "draw-t001", "BUY")).rejects.toThrow(/Only long or short/);
    await expect(requireOrderDrawing(b.userId, a.accountId, "EURUSD", "draw-l001", "BUY")).rejects.toThrow();
    await expect(requireOrderDrawing(b.userId, b.accountId, "EURUSD", "draw-l001", "BUY")).rejects.toThrow(/wasn't found/);
    expect((await requireOrderDrawing(a.userId, a.accountId, "EURUSD", "draw-l001", "BUY")).id).toBe("draw-l001");

    // A client trying to set orderRef itself: dropped.
    const forged = { ...long, data: { ...long.data, orderRef: { orderId: "forged", positionId: null, side: "BUY" as const, status: "FILLED" as const, minute: 1 } } };
    expect((await saveSimDrawing(a.userId, a.accountId, forged)).data.orderRef).toBeUndefined();

    const ref = { orderId: "order-1", positionId: "pos-1", side: "BUY" as const, status: "FILLED" as const, minute: 42 };
    expect((await linkDrawingToOrder(a.userId, a.accountId, "draw-l001", ref)).data.orderRef).toEqual(ref);
    // Moving the drawing afterwards keeps the link; the client can't clear it.
    const moved = await saveSimDrawing(a.userId, a.accountId, { ...long, data: { position: { entry: 1.081, stop: 1.079, targets: [1.083] } } });
    expect(moved.data.orderRef).toEqual(ref);
    expect(moved.data.position?.entry).toBe(1.081);
    await expect(linkDrawingToOrder(b.userId, a.accountId, "draw-l001", ref)).rejects.toThrow();
  });
});
