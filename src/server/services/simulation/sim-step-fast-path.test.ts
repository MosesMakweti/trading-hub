import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { syntheticMt5Export } from "@/domain/native-replay/testing/m1-fixtures";
import { applyRevealed, fromWire, wireToBars } from "@/domain/native-replay/chart-model";
import type { ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { applyStepPatch } from "@/types/simulation";
import { createLabAccount, startSimClock } from "./sim-account.service";
import { advanceSimClock, type AdvanceOutcome } from "./sim-clock.service";
import { placeOrder } from "./sim-execution.service";
import { accountFeedsCached, type ClockCommand } from "./sim-market";
import { getRevealedBars, getSimAccountState, getSimCandles, getSimStepPatch } from "./sim-state.service";

const userIds: string[] = [];
let userId = "";
let accountId = "";

beforeAll(async () => {
  const u = await createTestUser("sim-fast-path");
  userIds.push(u.id);
  userId = u.id;
  const ds = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(syntheticMt5Export({ startDay: "2024-05-13", days: 10 }).text), fileName: "EURUSD_M1_202405130000_202405242359.csv" });
  const acct = await createLabAccount(u.id, { name: "Fast path", datasets: [{ assetSymbol: "EURUSD", datasetId: ds.id }], periodStart: "2024-05-13", periodEnd: "2024-05-24", startingBalance: 10000, currency: "USD", costs: { commissionPerUnitPerSide: 3.5, defaultSpreadPoints: 8 } });
  accountId = acct.id;
  await startSimClock(u.id, acct.id);
  await advanceSimClock(u.id, acct.id, { kind: "NEXT_DAY" });
});
afterAll(() => deleteTestUsers(...userIds));

/** One step the way the action does it: outcome + (patch | state) + revealed bars. */
async function step(command: ClockCommand) {
  const { snapshot, ...outcome } = await advanceSimClock(userId, accountId, command);
  const feeds = await accountFeedsCached(prisma, accountId);
  const revealed = outcome.moved ? await getRevealedBars(feeds, ["EURUSD"], outcome.fromMinute, outcome.toMinute) : [];
  return { outcome: outcome as Omit<AdvanceOutcome, "snapshot">, snapshot, revealed };
}

describe("replay fast path", () => {
  it("charts folded from revealed bars equal a fresh server load, for every step kind and timeframe", async () => {
    const tfs: ReplayTimeframe[] = ["M1", "M5", "M15", "H1", "H4", "D1"];
    const charts = new Map<ReplayTimeframe, ReturnType<typeof fromWire>[]>();
    for (const tf of tfs) {
      const r = await getSimCandles(userId, accountId, { symbol: "EURUSD", timeframe: tf, limit: 300 });
      charts.set(tf, r.candles.map((c) => fromWire(c, r.priceScale)));
    }
    const commands: ClockCommand[] = [
      { kind: "BARS", count: 1 },
      { kind: "CANDLE", timeframe: "M15" },
      { kind: "BARS", count: 7 },
      { kind: "CANDLE", timeframe: "H1" },
      { kind: "NEXT_DAY" },
      { kind: "BARS", count: 1 },
      { kind: "CANDLE", timeframe: "H4" },
    ];
    for (const command of commands) {
      const { outcome, revealed } = await step(command);
      expect(outcome.moved).toBe(true);
      const bars = revealed[0].bars!;
      expect(bars.length).toBeGreaterThan(0);
      expect(bars.every((b) => b.minute > outcome.fromMinute && b.minute <= outcome.toMinute)).toBe(true); // never past the clock
      for (const tf of tfs) {
        const list = charts.get(tf)!;
        applyRevealed(list, wireToBars(bars, revealed[0].priceScale), tf, outcome.toMinute);
        const fresh = await getSimCandles(userId, accountId, { symbol: "EURUSD", timeframe: tf, limit: 300 });
        const expected = fresh.candles.map((c) => fromWire(c, fresh.priceScale));
        const tail = list.slice(-expected.length);
        expect(tail.map((c) => [c.time, c.open, c.high, c.low, c.close, c.tickVolume, c.state]), `${tf} after ${JSON.stringify(command)}`).toEqual(expected.map((c) => [c.time, c.open, c.high, c.low, c.close, c.tickVolume, c.state]));
      }
    }
  });

  it("the step patch equals the full state when nothing traded; trades fall back to the full state", async () => {
    await placeOrder(userId, accountId, { symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "1" } });
    const before = await getSimAccountState(userId, accountId);
    await placeOrder(userId, accountId, { symbol: "EURUSD", side: "BUY", type: "LIMIT", price: (Number(before.quotes[0].ask) - 0.05).toFixed(5), sizing: { mode: "QUANTITY", quantity: "1" } });
    let prev = await getSimAccountState(userId, accountId);
    for (let i = 0; i < 5; i++) {
      const { outcome, snapshot } = await step({ kind: "CANDLE", timeframe: "M5" });
      const full = await getSimAccountState(userId, accountId);
      if (!outcome.tradingChanged) {
        expect(snapshot).toBeDefined();
        const patched = applyStepPatch(prev, await getSimStepPatch(snapshot!));
        expect(patched).toEqual(full);
      } else {
        expect(snapshot).toBeUndefined();
      }
      prev = full;
    }
    // A step that closes the position is a trading change.
    const open = prev.positions[0];
    const tp = (Number(prev.quotes[0].bid) + 0.00001).toFixed(5);
    await prisma.simPosition.update({ where: { id: open.id }, data: { takeProfit: Math.round(Number(tp) * 1e5) } });
    const { outcome } = await step({ kind: "BARS", count: 240 });
    if (outcome.closedPositions > 0) expect(outcome.tradingChanged).toBe(true);
  });
});
