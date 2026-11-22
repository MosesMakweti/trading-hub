import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { mt5Text, wc } from "@/domain/native-replay/testing/m1-fixtures";
import { formatWallClock } from "@/domain/native-replay/wall-clock";
import { createLabAccount, deleteSimAccount, requireSimAccount, SimError, SimNotFoundError, startSimClock } from "./sim-account.service";
import { advanceSimClock } from "./sim-clock.service";
import { cancelOrder, closePosition, modifyPosition, placeOrder } from "./sim-execution.service";
import { getSimAccountState, getSimCandles } from "./sim-state.service";
import { verifyLedger } from "./sim-ledger";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
const enc = (s: string) => new TextEncoder().encode(s);

/**
 * EURUSD bid bars, spread 10 points (ask = bid + 0.00010):
 *   14 May 09:00–09:09 — dip to 1.07880 at 09:04, rally to 1.08250 at 09:06, flat 1.08240 after.
 *   15 May 09:00–09:04 — flat 1.08300.
 */
function fixture(): string {
  const rows: string[][] = [];
  const add = (d: string, t: string, o: string, h: string, l: string, c: string) => rows.push([d, t, o, h, l, c, "10", "0", "10"]);
  add("2024.05.14", "09:00", "1.08000", "1.08010", "1.07990", "1.08000");
  add("2024.05.14", "09:01", "1.08000", "1.08020", "1.07995", "1.08010");
  add("2024.05.14", "09:02", "1.08010", "1.08030", "1.08005", "1.08020");
  add("2024.05.14", "09:03", "1.08020", "1.08025", "1.07940", "1.07950");
  add("2024.05.14", "09:04", "1.07950", "1.07960", "1.07880", "1.07890");
  add("2024.05.14", "09:05", "1.07890", "1.08100", "1.07885", "1.08090");
  add("2024.05.14", "09:06", "1.08090", "1.08250", "1.08080", "1.08240");
  for (const t of ["09:07", "09:08", "09:09"]) add("2024.05.14", t, "1.08240", "1.08240", "1.08240", "1.08240");
  for (const t of ["09:00", "09:01", "09:02", "09:03", "09:04"]) add("2024.05.15", t, "1.08300", "1.08300", "1.08300", "1.08300");
  return mt5Text(rows);
}

async function setup(label: string, costs: { commissionPerUnitPerSide?: number; swapShortPerUnit?: number } = { commissionPerUnitPerSide: 3.5 }) {
  const u = await createTestUser(`sim-${label}`);
  userIds.push(u.id);
  const ds = await importHistoricalDataset(u.id, { bytes: enc(fixture()), fileName: "EURUSD_M1_202405140900_202405150904.csv" });
  const account = await createLabAccount(u.id, {
    name: `Lab ${label}`,
    datasets: [{ assetSymbol: "EURUSD", datasetId: ds.id }],
    periodStart: "2024-05-14",
    periodEnd: "2024-05-17",
    startingBalance: 10_000,
    currency: "USD",
    costs,
  });
  return { userId: u.id, accountId: account.id, datasetId: ds.id };
}
const clock = async (userId: string, accountId: string) => (await getSimAccountState(userId, accountId)).clock?.time;

describe("Strategy Lab account lifecycle", () => {
  it("creates an account with its starting balance on the ledger, starts the clock and freezes its data", async () => {
    const { userId, accountId } = await setup("create");
    let state = await getSimAccountState(userId, accountId);
    expect(state.status).toBe("CREATED");
    expect(state.money).toMatchObject({ balance: "10000.00", equity: "10000.00" });
    expect(state.clock).toBeNull();
    await expect(placeOrder(userId, accountId, { symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "1" } })).rejects.toThrow(/Start the replay/);

    await startSimClock(userId, accountId);
    await startSimClock(userId, accountId); // idempotent
    state = await getSimAccountState(userId, accountId);
    expect(state.status).toBe("ACTIVE");
    expect(state.clock?.time).toBe("2024-05-14T09:00");
    expect(state.quotes[0]).toMatchObject({ symbol: "EURUSD", bid: "1.08000", ask: "1.08010" });

    // Frozen by the database: pins, clock direction, rules.
    await expect(prisma.simDatasetPin.deleteMany({ where: { accountId } })).rejects.toThrow(/SIM_PIN_FROZEN/);
    await expect(prisma.simAccount.update({ where: { id: accountId }, data: { currentMinute: wc("2024-05-14T08:00") } })).rejects.toThrow(/SIM_CLOCK/);
    await expect(prisma.simAccount.update({ where: { id: accountId }, data: { rules: {} } })).rejects.toThrow(/rules are frozen/);
  });

  it("refuses another user's dataset, and an instrument the dataset doesn't hold", async () => {
    const a = await setup("ds-a");
    const b = await createTestUser("sim-ds-b");
    userIds.push(b.id);
    const base = { name: "x", periodStart: "2024-05-14", periodEnd: "2024-05-15", startingBalance: 1000, currency: "USD" };
    await expect(createLabAccount(b.id, { ...base, datasets: [{ assetSymbol: "EURUSD", datasetId: a.datasetId }] })).rejects.toThrow(/wasn't found/);
    await expect(createLabAccount(a.userId, { ...base, datasets: [{ assetSymbol: "GBPUSD", datasetId: a.datasetId }] })).rejects.toThrow(/can't be used for GBPUSD/);
    await expect(createLabAccount(a.userId, { ...base, periodStart: "2024-06-01", periodEnd: "2024-06-02", datasets: [{ assetSymbol: "EURUSD", datasetId: a.datasetId }] })).rejects.toThrow(/no bars inside/);
  });
});

describe("execution", () => {
  it("sizes a market buy by risk %, stops it out at the stop, and books money exactly", async () => {
    const { userId, accountId } = await setup("risk");
    await startSimClock(userId, accountId);
    // Ask 1.08010, stop 1.07900 → 110 points × $1/point/lot = $110 per lot; 1% of $10,000 = $100 → 0.90 lots.
    const outcome = await placeOrder(userId, accountId, {
      symbol: "EURUSD", side: "BUY", type: "MARKET", stopLoss: "1.07900", takeProfit: "1.08200", sizing: { mode: "RISK_PERCENT", riskPercent: 1 },
    });
    expect(outcome.status).toBe("FILLED");
    let state = await getSimAccountState(userId, accountId);
    expect(state.positions[0]).toMatchObject({ entryPrice: "1.08010", quantity: "0.9", stopLoss: "1.07900" });
    expect(state.money.balance).toBe("9996.85"); // −0.9 × $3.50 commission

    const step = await advanceSimClock(userId, accountId, { kind: "BARS", count: 5 }, "step-1");
    expect(step).toMatchObject({ moved: true, closedPositions: 1 });
    state = await getSimAccountState(userId, accountId);
    expect(state.clock?.time).toBe("2024-05-14T09:05");
    expect(state.positions).toEqual([]);
    // (1.07900 − 1.08010) × 0.9 × 100,000 = −$99.00; commissions 2 × −$3.15.
    expect(state.history[0]).toMatchObject({ closeReason: "STOP_LOSS", grossPnl: "-99", netPnl: "-105.30", r: "-1.05", closedAt: "2024-05-14T09:04" });
    expect(state.money).toMatchObject({ balance: "9894.70", equity: "9894.70", realizedPnl: "-99.00", commissions: "-6.30" });
    const ledger = await prisma.$transaction((tx) => verifyLedger(tx, accountId));
    expect(ledger.balance.toFixed(2)).toBe("9894.70");
    expect(ledger.entries).toBe(4);
  });

  it("fills a buy limit on the ask, then takes profit; the target is never assumed on the fill bar", async () => {
    const { userId, accountId } = await setup("limit");
    await startSimClock(userId, accountId);
    await expect(placeOrder(userId, accountId, { symbol: "EURUSD", side: "BUY", type: "LIMIT", price: "1.08100", sizing: { mode: "QUANTITY", quantity: "1" } })).rejects.toThrow(/below the current ask/);
    await placeOrder(userId, accountId, {
      symbol: "EURUSD", side: "BUY", type: "LIMIT", price: "1.07960", stopLoss: "1.07870", takeProfit: "1.08200", sizing: { mode: "QUANTITY", quantity: "1" }, clientRequestId: "req-1",
    });
    const dup = await placeOrder(userId, accountId, {
      symbol: "EURUSD", side: "BUY", type: "LIMIT", price: "1.07960", stopLoss: "1.07870", takeProfit: "1.08200", sizing: { mode: "QUANTITY", quantity: "1" }, clientRequestId: "req-1",
    });
    expect(dup.duplicate).toBe(true);
    expect(await prisma.simOrder.count({ where: { accountId } })).toBe(1);

    await advanceSimClock(userId, accountId, { kind: "SEEK", to: wc("2024-05-14T09:09") });
    const state = await getSimAccountState(userId, accountId);
    // Ask low at 09:03 = 1.07950 ≤ 1.07960 → filled at the limit; TP 1.08200 reached at 09:06.
    expect(state.history[0]).toMatchObject({ entryPrice: "1.07960", closeReason: "TAKE_PROFIT", grossPnl: "240", netPnl: "233.00", closedAt: "2024-05-14T09:06" });
    expect(state.money.balance).toBe("10233.00");
    const fills = await prisma.simFill.findMany({ where: { accountId }, orderBy: [{ minute: "asc" }, { sequence: "asc" }] });
    expect(fills.map((f) => [f.kind, f.reason, formatWallClock(f.minute)])).toEqual([
      ["OPEN", "PENDING_TRIGGERED", "2024-05-14T09:03"],
      ["CLOSE", "TAKE_PROFIT", "2024-05-14T09:06"],
    ]);
  });

  it("closes half a short, holds the rest overnight (swap at the rollover), then closes it", async () => {
    const { userId, accountId } = await setup("swap", { commissionPerUnitPerSide: 3.5, swapShortPerUnit: -2 });
    await startSimClock(userId, accountId);
    await advanceSimClock(userId, accountId, { kind: "SEEK", to: wc("2024-05-14T09:07") });
    const { positionId } = await placeOrder(userId, accountId, { symbol: "EURUSD", side: "SELL", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "2" } });
    const half = await closePosition(userId, accountId, positionId!, { percent: 50, commandId: "half-1" });
    expect(half).toMatchObject({ closedQuantity: "1", remainingQuantity: "1", realizedPnl: "-10.00" }); // closes at the ask 1.08250
    expect((await closePosition(userId, accountId, positionId!, { percent: 50, commandId: "half-1" })).duplicate).toBe(true);

    await advanceSimClock(userId, accountId, { kind: "SEEK", to: wc("2024-05-15T09:01") });
    const swapRows = await prisma.simLedgerEntry.findMany({ where: { accountId, type: "SWAP" } });
    expect(swapRows.map((r) => [r.amount.toString(), formatWallClock(r.minute!)])).toEqual([["-2", "2024-05-15T09:00"]]);

    await modifyPosition(userId, accountId, positionId!, { stopLoss: "1.08400", takeProfit: null });
    await expect(modifyPosition(userId, accountId, positionId!, { stopLoss: "1.08200", takeProfit: null })).rejects.toThrow(/above the current price/);
    await closePosition(userId, accountId, positionId!, {});
    const state = await getSimAccountState(userId, accountId);
    // Opening commission −7; half: −10 −3.5; swap −2; rest at ask 1.08310: −70 −3.5.
    expect(state.money.balance).toBe("9904.00");
    expect(state.history[0]).toMatchObject({ grossPnl: "-80", netPnl: "-96.00" });
    expect((await prisma.$transaction((tx) => verifyLedger(tx, accountId))).balance.toFixed(2)).toBe("9904.00");
  });

  it("cancels a pending order and refuses invalid input", async () => {
    const { userId, accountId } = await setup("cancel");
    await startSimClock(userId, accountId);
    const { orderId } = await placeOrder(userId, accountId, { symbol: "EURUSD", side: "SELL", type: "STOP", price: "1.07900", sizing: { mode: "QUANTITY", quantity: "1" } });
    await cancelOrder(userId, accountId, orderId);
    await advanceSimClock(userId, accountId, { kind: "BARS", count: 5 });
    expect(await prisma.simPosition.count({ where: { accountId } })).toBe(0);
    await expect(placeOrder(userId, accountId, { symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "0.015" } })).rejects.toThrow(/multiple of 0.01/);
    await expect(placeOrder(userId, accountId, { symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "RISK_PERCENT", riskPercent: 1 } })).rejects.toThrow(/needs a stop loss/);
    await expect(placeOrder(userId, accountId, { symbol: "GBPUSD", side: "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "1" } })).rejects.toThrow(SimError);
    await expect(placeOrder(userId, accountId, { symbol: "EURUSD", side: "BUY", type: "MARKET", stopLoss: "1.08400", sizing: { mode: "QUANTITY", quantity: "1" } })).rejects.toThrow(/below the entry/);
  });
});

describe("clock", () => {
  it("never reveals bars after the clock, and a retried command moves once", async () => {
    const { userId, accountId } = await setup("clock");
    await startSimClock(userId, accountId);
    await advanceSimClock(userId, accountId, { kind: "BARS", count: 3 }, "cmd-a");
    await advanceSimClock(userId, accountId, { kind: "BARS", count: 3 }, "cmd-a");
    expect(await clock(userId, accountId)).toBe("2024-05-14T09:03");
    const m1 = await getSimCandles(userId, accountId, { symbol: "EURUSD", timeframe: "M1", limit: 50 });
    expect(m1.candles.at(-1)!.time).toBe("2024-05-14T09:03");
    const paged = await getSimCandles(userId, accountId, { symbol: "EURUSD", timeframe: "M1", limit: 50, to: wc("2024-05-15T09:04") });
    expect(paged.candles.at(-1)!.time).toBe("2024-05-14T09:03"); // a later `to` is clamped to the clock
    const m30 = await getSimCandles(userId, accountId, { symbol: "EURUSD", timeframe: "M30", limit: 5 });
    expect(m30.candles.at(-1)).toMatchObject({ state: "FORMING", low: 1.0794, close: 1.0795 });
    await expect(advanceSimClock(userId, accountId, { kind: "SEEK", to: wc("2024-05-14T09:01") })).rejects.toThrow(/only moves forward/);
  });

  it("crosses days with NEXT_DAY and reports the period end", async () => {
    const { userId, accountId } = await setup("days");
    await startSimClock(userId, accountId);
    await advanceSimClock(userId, accountId, { kind: "NEXT_DAY" });
    expect(await clock(userId, accountId)).toBe("2024-05-14T09:09");
    await advanceSimClock(userId, accountId, { kind: "NEXT_DAY" });
    expect(await clock(userId, accountId)).toBe("2024-05-15T09:04");
    const end = await advanceSimClock(userId, accountId, { kind: "BARS", count: 1 });
    expect(end).toMatchObject({ moved: false, atPeriodEnd: true });
  });

  it("concurrent advances apply one after the other", async () => {
    const { userId, accountId } = await setup("concurrent");
    await startSimClock(userId, accountId);
    await Promise.all([1, 2, 3].map((i) => advanceSimClock(userId, accountId, { kind: "BARS", count: 1 }, `c-${i}`)));
    expect(await clock(userId, accountId)).toBe("2024-05-14T09:03");
    const acct = await requireSimAccount(userId, accountId);
    expect(acct.clockVersion).toBe(4);
  });
});

describe("isolation", () => {
  it("another user can't see, trade or move the account; live tables are untouched", async () => {
    const { userId, accountId } = await setup("iso");
    await startSimClock(userId, accountId);
    await placeOrder(userId, accountId, { symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "1" } });
    const intruder = await createTestUser("sim-intruder");
    userIds.push(intruder.id);
    await expect(getSimAccountState(intruder.id, accountId)).rejects.toBeInstanceOf(SimNotFoundError);
    await expect(placeOrder(intruder.id, accountId, { symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "1" } })).rejects.toBeInstanceOf(SimNotFoundError);
    await expect(advanceSimClock(intruder.id, accountId, { kind: "BARS", count: 1 })).rejects.toBeInstanceOf(SimNotFoundError);
    await expect(deleteSimAccount(intruder.id, accountId)).rejects.toBeInstanceOf(SimNotFoundError);
    // A forged child row for someone else's account is refused by the database.
    await expect(prisma.simEvent.create({ data: { userId: intruder.id, accountId, type: "X" } })).rejects.toThrow(/SIM_OWNERSHIP/);

    const live = await Promise.all([
      prisma.trade.count({ where: { userId } }),
      prisma.tradingAccount.count({ where: { userId } }),
      prisma.positionFill.count({ where: { userId } }),
      prisma.accountLedgerEntry.count({ where: { account: { userId } } }),
      prisma.tradingDay.count({ where: { userId } }),
    ]);
    expect(live).toEqual([0, 0, 0, 0, 0]);
  });

  it("history is append-only; deleting the account removes it all", async () => {
    const { userId, accountId } = await setup("append");
    const entry = await prisma.simLedgerEntry.findFirstOrThrow({ where: { accountId } });
    await expect(prisma.simLedgerEntry.update({ where: { id: entry.id }, data: { amount: 1 } })).rejects.toThrow(/SIM_IMMUTABLE/);
    await expect(prisma.simLedgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/SIM_IMMUTABLE/);
    await expect(
      prisma.simLedgerEntry.create({ data: { userId, accountId, sequence: 2, type: "ADJUSTMENT", amount: 5, balanceAfter: 999, idempotencyKey: "bad" } }),
    ).rejects.toThrow(/running balance mismatch/);
    await deleteSimAccount(userId, accountId);
    expect(await prisma.simLedgerEntry.count({ where: { accountId } })).toBe(0);
  });
});

describe("datasets used by simulation accounts", () => {
  it("can't be deleted while an account uses them; deleting the user still works", async () => {
    const { userId, accountId, datasetId } = await setup("ds-delete");
    await startSimClock(userId, accountId);
    const { deleteHistoricalDataset } = await import("@/server/services/native-replay/historical-dataset.service");
    await expect(deleteHistoricalDataset(userId, datasetId)).rejects.toThrow(/used by 1 simulation account \("Lab ds-delete"\)/);
    await expect(prisma.historicalDataset.delete({ where: { id: datasetId } })).rejects.toThrow();
    await prisma.user.delete({ where: { id: userId } });
    expect(await prisma.simAccount.count({ where: { id: accountId } })).toBe(0);
  });
});
