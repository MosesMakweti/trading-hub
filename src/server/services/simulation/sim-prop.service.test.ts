import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { mt5Text } from "@/domain/native-replay/testing/m1-fixtures";
import { formatWallClock } from "@/domain/native-replay/wall-clock";
import type { FirmModelInput } from "@/domain/simulation/firm-model";
import { startSimClock } from "./sim-account.service";
import { advanceSimClock } from "./sim-clock.service";
import { placeOrder } from "./sim-execution.service";
import { createFirmModel, getPropAccountStatus, getPropOverview, purchaseChallenge, requestPayout, updateFirmModel } from "./sim-prop.service";
import { getSimAccountState } from "./sim-state.service";
import { verifyLedger } from "./sim-ledger";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

/** EURUSD bid bars on 14 May 2024, no spread. */
function fixture(): string {
  const rows = [
    ["09:00", "1.08000", "1.08000", "1.08000", "1.08000"],
    ["09:01", "1.08000", "1.08250", "1.08000", "1.08200"],
    ["09:02", "1.08200", "1.08350", "1.08200", "1.08300"],
    ["09:03", "1.08300", "1.08300", "1.07700", "1.07800"],
    ["09:04", "1.07800", "1.08600", "1.07800", "1.08500"],
    ["09:05", "1.08500", "1.08500", "1.08500", "1.08500"],
  ].map(([t, o, h, l, c]) => ["2024.05.14", t, o, h, l, c, "10", "0", "0"]);
  return mt5Text(rows);
}

const MODEL: FirmModelInput = {
  firmName: "Test Firm",
  modelName: "Two-step test",
  challengeType: "TWO_STEP",
  sizes: [{ accountSize: 10_000, fee: 99 }],
  phases: [
    { name: "Phase 1", profitTargetPercent: 2, minTradingDays: 1, dailyLoss: { limitPercent: 5, basis: "EQUITY", reference: "INITIAL_BALANCE" }, maxLoss: { limitPercent: 10, model: "STATIC" } },
    { name: "Phase 2", profitTargetPercent: 1, minTradingDays: 1, maxLoss: { limitPercent: 10, model: "STATIC" } },
  ],
  funded: { maxLoss: { limitPercent: 10, model: "STATIC" }, payout: { profitSplitPercent: 80, firstPayoutAfterDays: 0, cycleDays: 1, minPayoutAmount: 10 } },
};

async function setup(label: string) {
  const u = await createTestUser(`prop-${label}`);
  userIds.push(u.id);
  const ds = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(fixture()), fileName: "EURUSD_M1_202405140900_202405140905.csv" });
  const model = await createFirmModel(u.id, MODEL);
  const { challenge, account } = await purchaseChallenge(u.id, { modelRef: model.id, accountSize: 10_000, datasets: [{ assetSymbol: "EURUSD", datasetId: ds.id }], periodStart: "2024-05-14", periodEnd: "2024-05-14" });
  await startSimClock(u.id, account.id);
  return { userId: u.id, challengeId: challenge.id, accountId: account.id, modelId: model.id };
}
const stageAccount = (challengeId: string, phaseIndex: number) => prisma.simAccount.findFirstOrThrow({ where: { challengeId, phaseIndex } });

describe("Prop Firm Simulator journey", () => {
  it("passes phase 1 and phase 2 on later history, gets funded, and pays out through the ledger", async () => {
    const { userId, challengeId, accountId, modelId } = await setup("journey");
    // Editing the model afterwards never changes this challenge.
    await updateFirmModel(userId, modelId, { ...MODEL, phases: [{ ...MODEL.phases![0], profitTargetPercent: 50 }, MODEL.phases![1]] });

    // Phase 1: buy 1 lot at 1.08000, TP 1.08200 → +$200 = 2% at 09:01 → pass.
    await placeOrder(userId, accountId, { symbol: "EURUSD", side: "BUY", type: "MARKET", takeProfit: "1.08200", sizing: { mode: "QUANTITY", quantity: "1" } });
    expect((await getPropAccountStatus(userId, accountId)).passUnmet).toEqual(["Balance below the 10200.00 target.", "Close every open position."]);
    const step1 = await advanceSimClock(userId, accountId, { kind: "BARS", count: 5 });
    expect(step1).toMatchObject({ halted: true, toMinute: expect.any(Number) });
    expect(formatWallClock(step1.toMinute)).toBe("2024-05-14T09:01"); // stopped at the pass minute
    expect(await prisma.simAccount.findUniqueOrThrow({ where: { id: accountId } })).toMatchObject({ status: "PASSED" });

    // Phase 2 continues from 09:01 with a fresh $10,000 — never earlier data.
    const p2 = await stageAccount(challengeId, 1);
    expect(p2).toMatchObject({ kind: "EVALUATION", status: "ACTIVE" });
    expect(formatWallClock(p2.currentMinute!)).toBe("2024-05-14T09:01");
    expect((await getSimAccountState(userId, p2.id)).money.balance).toBe("10000.00");
    // Buy at the 09:01 close 1.08200, TP 1.08300 → +$100 = 1% at 09:02.
    await placeOrder(userId, p2.id, { symbol: "EURUSD", side: "BUY", type: "MARKET", takeProfit: "1.08300", sizing: { mode: "QUANTITY", quantity: "1" } });
    await advanceSimClock(userId, p2.id, { kind: "BARS", count: 4 });

    const funded = await stageAccount(challengeId, 2);
    expect(funded).toMatchObject({ kind: "FUNDED", status: "ACTIVE" });
    expect((await prisma.simChallenge.findUniqueOrThrow({ where: { id: challengeId } })).status).toBe("FUNDED");

    // Funded: buy at 1.08300, TP 1.08550. 09:03 dips to 1.07700 (−$600 floating, above the 9,000 floor), 09:04 hits TP → +$250.
    await placeOrder(userId, funded.id, { symbol: "EURUSD", side: "BUY", type: "MARKET", takeProfit: "1.08550", sizing: { mode: "QUANTITY", quantity: "1" } });
    await advanceSimClock(userId, funded.id, { kind: "BARS", count: 2 });
    expect((await getSimAccountState(userId, funded.id)).money.balance).toBe("10250.00");

    const status = await getPropAccountStatus(userId, funded.id);
    expect(status.payout).toMatchObject({ eligible: true, grossPayout: "250.00", traderShare: "200.00", firmShare: "50.00", splitPercent: 80 });
    const payout = await requestPayout(userId, funded.id);
    expect([payout.grossPayout, payout.traderShare, payout.firmShare, payout.balanceAfter].map((d) => d.toFixed(2))).toEqual(["250.00", "200.00", "50.00", "10000.00"]);
    const ledger = await prisma.$transaction((tx) => verifyLedger(tx, funded.id));
    expect([ledger.balance.toFixed(2), ledger.withdrawals.toFixed(2)]).toEqual(["10000.00", "-250.00"]); // a withdrawal, not a reset
    await expect(requestPayout(userId, funded.id)).rejects.toThrow(/every 1 days|no realized profit/);

    const overview = await getPropOverview(userId);
    expect(overview.totals).toMatchObject({ purchased: 1, funded: 1, passRate: 100, phaseCompletionRate: 100, fees: "99.00", payoutsTrader: "200.00", payoutsFirm: "50.00", netSimulated: "101.00" });
    expect(overview.challenges[0].stages.map((s) => [s.name, s.status])).toEqual([["Phase 1", "PASSED"], ["Phase 2", "PASSED"], ["Funded", "ACTIVE"]]);
    // The original phase-1 target was 2%, not the edited 50%.
    expect((await prisma.simChallenge.findUniqueOrThrow({ where: { id: challengeId } })).modelVersion).toBe(1);
  });

  it("breaches the daily loss on floating equity, stops at that minute and reports it", async () => {
    const { userId, challengeId, accountId } = await setup("breach");
    // 2 lots at 1.08000. At 09:03 the low 1.07700 puts equity at 9,400 < the 9,500 daily floor.
    await placeOrder(userId, accountId, { symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "2" } });
    const step = await advanceSimClock(userId, accountId, { kind: "BARS", count: 5 });
    expect(step.halted).toBe(true);
    expect(formatWallClock(step.toMinute)).toBe("2024-05-14T09:03");

    const account = await prisma.simAccount.findUniqueOrThrow({ where: { id: accountId }, include: { breach: true } });
    expect(account.status).toBe("BREACHED");
    expect(account.breach).toMatchObject({ rule: "DAILY_LOSS", floatingInvolved: true, basis: "EQUITY" });
    expect([account.breach!.measured, account.breach!.floor].map((d) => d!.toFixed(2))).toEqual(["9400.00", "9500.00"]);
    // Liquidated at the 09:03 close 1.07800: −0.002 × 2 lots = −$400.
    const state = await getSimAccountState(userId, accountId);
    expect(state.money.balance).toBe("9600.00");
    expect(state.history[0]).toMatchObject({ closeReason: "LIQUIDATION" });
    await expect(placeOrder(userId, accountId, { symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "1" } })).rejects.toThrow(/breached a rule/);
    await expect(advanceSimClock(userId, accountId, { kind: "BARS", count: 1 })).rejects.toThrow(/breached/);
    expect((await prisma.simChallenge.findUniqueOrThrow({ where: { id: challengeId } })).status).toBe("BREACHED");
    expect(await prisma.simAccount.count({ where: { challengeId } })).toBe(1); // no next phase

    const overview = await getPropOverview(userId);
    expect(overview.breachesByRule).toEqual([{ rule: "DAILY_LOSS", count: 1 }]);
    expect(overview.challenges[0].breach).toMatchObject({ rule: "DAILY_LOSS", measured: "9400.00", floor: "9500.00", floatingInvolved: true });
  });

  it("refuses sizes the model doesn't offer and keeps challenges private", async () => {
    const { userId, modelId } = await setup("refuse");
    await expect(purchaseChallenge(userId, { modelRef: modelId, accountSize: 5_000, datasets: [], periodStart: "2024-05-14", periodEnd: "2024-05-14" })).rejects.toThrow(/isn't offered/);
    const intruder = await createTestUser("prop-intruder");
    userIds.push(intruder.id);
    await expect(purchaseChallenge(intruder.id, { modelRef: modelId, accountSize: 10_000, datasets: [], periodStart: "2024-05-14", periodEnd: "2024-05-14" })).rejects.toThrow(/not found/);
    expect((await getPropOverview(intruder.id)).challenges).toEqual([]);
  });
});
