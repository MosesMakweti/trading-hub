import { describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { savePlan } from "@/server/services/trade-plan.service";
import {
  deletePartialExit,
  listPartialExits,
  mapPartialToTarget,
  upsertPartialExit,
} from "@/server/services/trade-partial-exit.service";

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `partial-exit-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

async function cleanupUsers(...ids: string[]) {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function makeTrade(userId: string) {
  return prisma.trade.create({
    data: {
      userId,
      tradeDate: new Date("2026-01-05"),
      executionMinutes: 570,
      direction: "LONG",
      higherTimeframeBias: "BULLISH",
      biasConfidencePercent: 80,
      expectedRR: 2,
      assetSymbol: "EURUSD",
    },
  });
}

describe("trade-partial-exit.service — CRUD", () => {
  it("creates, lists, updates, and deletes a partial exit", async () => {
    const user = await makeUser("crud");
    const trade = await makeTrade(user.id);

    const created = await upsertPartialExit(user.id, trade.id, {
      exitOrder: 1,
      exitPrice: 1.089,
      percentClosed: 50,
      exitedAt: new Date("2026-01-05T14:00:00Z"),
      grossPnl: 100,
      fees: 2,
    });
    expect(created.netPnl?.toNumber()).toBe(98);

    const list = await listPartialExits(user.id, trade.id);
    expect(list).toHaveLength(1);
    expect(list[0].exitOrder).toBe(1);

    const updated = await upsertPartialExit(user.id, trade.id, {
      id: created.id,
      exitOrder: 1,
      exitPrice: 1.09,
      percentClosed: 50,
      exitedAt: new Date("2026-01-05T14:05:00Z"),
    });
    expect(updated.exitPrice.toNumber()).toBe(1.09);

    await deletePartialExit(user.id, trade.id, created.id);
    expect(await listPartialExits(user.id, trade.id)).toHaveLength(0);

    await cleanupUsers(user.id);
  });

  it("rejects a duplicate exitOrder on create", async () => {
    const user = await makeUser("dup-order");
    const trade = await makeTrade(user.id);

    await upsertPartialExit(user.id, trade.id, { exitOrder: 1, exitPrice: 1.089, exitedAt: new Date() });
    await expect(upsertPartialExit(user.id, trade.id, { exitOrder: 1, exitPrice: 1.095, exitedAt: new Date() })).rejects.toThrow(/already exists/);

    await cleanupUsers(user.id);
  });

  it("rejects a total percentClosed across partials exceeding 100%", async () => {
    const user = await makeUser("pct-cap");
    const trade = await makeTrade(user.id);

    await upsertPartialExit(user.id, trade.id, { exitOrder: 1, exitPrice: 1.089, percentClosed: 60, exitedAt: new Date() });
    await expect(
      upsertPartialExit(user.id, trade.id, { exitOrder: 2, exitPrice: 1.091, percentClosed: 50, exitedAt: new Date() }),
    ).rejects.toThrow(/exceeds 100%/);

    await cleanupUsers(user.id);
  });

  it("allows an update to keep its own percentClosed without double-counting against itself", async () => {
    const user = await makeUser("pct-self");
    const trade = await makeTrade(user.id);

    const created = await upsertPartialExit(user.id, trade.id, { exitOrder: 1, exitPrice: 1.089, percentClosed: 80, exitedAt: new Date() });
    const updated = await upsertPartialExit(user.id, trade.id, { id: created.id, exitOrder: 1, exitPrice: 1.089, percentClosed: 85, exitedAt: new Date() });
    expect(updated.percentClosed?.toNumber()).toBe(85);

    await cleanupUsers(user.id);
  });

  it("rejects a plannedTargetId that doesn't belong to the trade", async () => {
    const user = await makeUser("bad-target");
    const trade = await makeTrade(user.id);

    await expect(
      upsertPartialExit(user.id, trade.id, { exitOrder: 1, exitPrice: 1.089, plannedTargetId: "does-not-exist", exitedAt: new Date() }),
    ).rejects.toThrow(/Planned target not found/);

    await cleanupUsers(user.id);
  });

  it("scopes all operations to the owning user", async () => {
    const owner = await makeUser("owner");
    const intruder = await makeUser("intruder");
    const trade = await makeTrade(owner.id);

    await expect(upsertPartialExit(intruder.id, trade.id, { exitOrder: 1, exitPrice: 1.089, exitedAt: new Date() })).rejects.toThrow(/Trade not found/);

    await cleanupUsers(owner.id, intruder.id);
  });
});

describe("trade-partial-exit.service — mapping to planned targets", () => {
  it("lets the trader explicitly (re)map a partial to a planned target, overriding any automatic match", async () => {
    const user = await makeUser("map-target");
    const trade = await makeTrade(user.id);

    await savePlan(user.id, trade.id, {
      direction: "LONG",
      entry: 1.085,
      stopLoss: 1.083,
      targets: [
        { targetOrder: 1, label: "TP1", targetPrice: 1.089, plannedClosePercent: 50 },
        { targetOrder: 2, label: "TP2", targetPrice: 1.091, plannedClosePercent: 50 },
      ],
    });
    const targets = await prisma.plannedTarget.findMany({ where: { tradeId: trade.id }, orderBy: { targetOrder: "asc" } });

    const partial = await upsertPartialExit(user.id, trade.id, { exitOrder: 1, exitPrice: 1.0895, exitedAt: new Date() });
    expect(partial.plannedTargetId).toBeNull();

    await mapPartialToTarget(user.id, trade.id, partial.id, targets[1].id);
    const [refetched] = await listPartialExits(user.id, trade.id);
    expect(refetched.plannedTargetId).toBe(targets[1].id);

    await mapPartialToTarget(user.id, trade.id, partial.id, null);
    const [cleared] = await listPartialExits(user.id, trade.id);
    expect(cleared.plannedTargetId).toBeNull();

    await cleanupUsers(user.id);
  });
});
