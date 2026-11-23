import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { syntheticMt5Export } from "@/domain/native-replay/testing/m1-fixtures";
import { parseWallClock } from "@/domain/native-replay/wall-clock";
import { bucketStart } from "@/domain/native-replay/timeframes";
import { createLabAccount, startSimClock } from "./sim-account.service";
import { advanceSimClock } from "./sim-clock.service";
import { accountFeedsCached, periodMinutes, reviewTarget, targetMinuteBuffered } from "./sim-market";
import { getSimCandles } from "./sim-state.service";

const userIds: string[] = [];
let userId = "";
let accountId = "";

beforeAll(async () => {
  const u = await createTestUser("sim-playback");
  userIds.push(u.id);
  userId = u.id;
  const ds = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(syntheticMt5Export({ startDay: "2024-05-13", days: 10 }).text), fileName: "EURUSD_M1_202405130000_202405242359.csv" });
  const acct = await createLabAccount(u.id, { name: "Playback", datasets: [{ assetSymbol: "EURUSD", datasetId: ds.id }], periodStart: "2024-05-13", periodEnd: "2024-05-24", startingBalance: 10000, currency: "USD" });
  accountId = acct.id;
  await startSimClock(u.id, acct.id);
});
afterAll(() => deleteTestUsers(...userIds));

const clock = async () => (await prisma.simAccount.findUniqueOrThrow({ where: { id: accountId } })).currentMinute!;

describe("playback commands", () => {
  it("N playback candles == N single playback candles, for M1/M5/M15/H1 (across a weekend too)", async () => {
    const feeds = await accountFeedsCached(prisma, accountId);
    const end = parseWallClock("2024-05-24T23:59")!;
    for (const cur of [await clock(), parseWallClock("2024-05-14T09:07")!, parseWallClock("2024-05-17T23:40")!]) {
      for (const tf of ["M1", "M5", "M15", "H1"] as const) {
        let at = cur;
        for (let k = 0; k < 7; k++) at = (await targetMinuteBuffered(feeds, at, { kind: "CANDLE", timeframe: tf }, end, 0)) ?? at;
        expect(await targetMinuteBuffered(feeds, cur, { kind: "CANDLE", timeframe: tf, count: 7 }, end, 0), `${tf} from ${cur}`).toBe(at);
      }
    }
  });

  it("a 30-minute candle forms from 1-minute playback and closes at its boundary", async () => {
    const start = await clock();
    for (let i = 0; i < 31; i++) {
      await advanceSimClock(userId, accountId, { kind: "CANDLE", timeframe: "M1" });
      const c = await getSimCandles(userId, accountId, { symbol: "EURUSD", timeframe: "M30", limit: 3 });
      const m1 = await getSimCandles(userId, accountId, { symbol: "EURUSD", timeframe: "M1", limit: 60 });
      const now = await clock();
      const last = c.candles[c.candles.length - 1];
      const members = m1.candles.filter((b) => b.minute >= last.minute && b.minute <= now);
      expect(last.open).toBe(members[0].open); // first constituent bar's open
      expect(last.high).toBe(Math.max(...members.map((b) => b.high)));
      expect(last.low).toBe(Math.min(...members.map((b) => b.low)));
      expect(last.close).toBe(members[members.length - 1].close); // latest revealed close
      expect(last.tickVolume).toBe(members.reduce((n, b) => n + (b.tickVolume ?? 0), 0));
      expect(last.state).toBe(now === last.minute + 29 ? "COMPLETED" : "FORMING");
    }
    expect(await clock()).toBe(start + 31);
  });

  it("SEEK AT_OR_AFTER lands on the first real bar at/after the time (skipping a weekend)", async () => {
    const sat = parseWallClock("2024-05-18T08:00")!; // no data on the weekend
    await advanceSimClock(userId, accountId, { kind: "SEEK", to: sat, align: "AT_OR_AFTER" });
    expect(await clock()).toBe(parseWallClock("2024-05-20T00:00")!); // Monday's first bar
  });
});

describe("review (backward) navigation never passes the clock", () => {
  it("back / forward / seek targets are revealed bars only", async () => {
    const feeds = await accountFeedsCached(prisma, accountId);
    const account = await prisma.simAccount.findUniqueOrThrow({ where: { id: accountId } });
    const now = account.currentMinute!;
    const from = periodMinutes(account).from;
    await advanceSimClock(userId, accountId, { kind: "BARS", count: 45 });
    const live = await clock();
    // Back one M15 bar from the live clock = last bar before the current M15 bucket.
    const back = await reviewTarget(feeds, live, live, from, { kind: "BACK", timeframe: "M15" });
    expect(back).toBe(bucketStart(live, "M15") - 1);
    // Forward from there never goes past the clock, even for a huge timeframe.
    expect(await reviewTarget(feeds, back!, live, from, { kind: "FORWARD", timeframe: "M15" })).toBeLessThanOrEqual(live);
    expect(await reviewTarget(feeds, back!, live, from, { kind: "FORWARD", timeframe: "D1" })).toBe(live);
    // A seek into the future is clamped to the clock.
    expect(await reviewTarget(feeds, now, live, from, { kind: "SEEK", to: live + 100_000 })).toBe(live);
  });

  it("an asOf view equals what the chart showed at that time, and can't look ahead", async () => {
    const before = await clock();
    const snapshot = await getSimCandles(userId, accountId, { symbol: "EURUSD", timeframe: "M15", limit: 50 });
    await advanceSimClock(userId, accountId, { kind: "BARS", count: 37 });
    const view = await getSimCandles(userId, accountId, { symbol: "EURUSD", timeframe: "M15", limit: 50, asOf: before });
    expect(view.candles).toEqual(snapshot.candles);
    const future = await getSimCandles(userId, accountId, { symbol: "EURUSD", timeframe: "M15", limit: 50, asOf: before + 100_000 });
    const live = await getSimCandles(userId, accountId, { symbol: "EURUSD", timeframe: "M15", limit: 50 });
    expect(future.candles).toEqual(live.candles); // clamped to the clock
  });
});
