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

describe("session jumps", () => {
  it("AT_OR_AFTER with `until`: lands inside the window or doesn't move; review never passes the clock", async () => {
    const feeds = await accountFeedsCached(prisma, accountId);
    const now = await clock();
    const end = parseWallClock("2024-05-24T23:59")!;
    // A window with no data (Sunday) → no target, so the clock wouldn't move.
    const sunday = parseWallClock("2024-05-19T08:00")!;
    expect(await targetMinuteBuffered(feeds, now, { kind: "SEEK", to: sunday, align: "AT_OR_AFTER", until: sunday + 540 }, end, 0)).toBeNull();
    // A window with data → its first bar.
    const tue = parseWallClock("2024-05-21T08:00")!;
    expect(await targetMinuteBuffered(feeds, now, { kind: "SEEK", to: tue, align: "AT_OR_AFTER", until: tue + 540 }, end, 0)).toBe(tue);
    // Review: an earlier session start, never past the clock.
    const acc = await prisma.simAccount.findUniqueOrThrow({ where: { id: accountId } });
    const earlier = parseWallClock("2024-05-14T08:00")!;
    expect(await reviewTarget(feeds, now, now, periodMinutes(acc).from, { kind: "SEEK", to: earlier, align: "AT_OR_AFTER", until: earlier + 540 })).toBe(earlier);
    expect(await reviewTarget(feeds, now, now, periodMinutes(acc).from, { kind: "SEEK", to: now + 10, align: "AT_OR_AFTER" })).toBeNull();
  });
});

describe("acceptance: playback interval × chart timeframe (independent controls)", () => {
  let u2 = "";
  let a2 = "";
  beforeAll(async () => {
    const u = await createTestUser("sim-playback-accept");
    userIds.push(u.id);
    u2 = u.id;
    const ds = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(syntheticMt5Export({ startDay: "2024-05-13", days: 3 }).text), fileName: "EURUSD_M1_202405130000_202405152359.csv" });
    const acct = await createLabAccount(u.id, { name: "Accept", datasets: [{ assetSymbol: "EURUSD", datasetId: ds.id }], periodStart: "2024-05-13", periodEnd: "2024-05-15", startingBalance: 10000, currency: "USD" });
    a2 = acct.id;
    await startSimClock(u.id, acct.id);
  });
  const now2 = async () => (await prisma.simAccount.findUniqueOrThrow({ where: { id: a2 } })).currentMinute!;
  const step = (tf: "M1" | "M5" | "H1") => advanceSimClock(u2, a2, { kind: "CANDLE", timeframe: tf });
  const last = async (tf: "M30" | "H1" | "M1") => {
    const c = await getSimCandles(u2, a2, { symbol: "EURUSD", timeframe: tf, limit: 5 });
    return c.candles[c.candles.length - 1];
  };
  /** Every revealed M1 bar, in order — to prove nothing was skipped or duplicated. */
  const revealed = async () => (await getSimCandles(u2, a2, { symbol: "EURUSD", timeframe: "M1", limit: 5000 })).candles.map((b) => b.minute);

  it("B: 5-minute steps — six steps complete a 30-minute candle, which forms between", async () => {
    // Line up on a closed 30-minute candle first.
    while ((await now2()) % 30 !== 29) await step("M1");
    const base = await now2();
    for (let k = 1; k <= 6; k++) {
      await step("M5");
      expect(await now2()).toBe(base + 5 * k);
      const c = await last("M30");
      expect(c.minute).toBe(base + 1);
      expect(c.state).toBe(k === 6 ? "COMPLETED" : "FORMING");
    }
  });

  it("C/A: 1-minute steps — an hour candle forms over 60 steps; a 30-minute one over 30", async () => {
    while ((await now2()) % 60 !== 59) await step("M1");
    const base = await now2();
    for (let k = 1; k <= 60; k++) {
      await step("M1");
      expect(await now2()).toBe(base + k);
      const h = await last("H1");
      expect(h.minute).toBe(base + 1);
      expect(h.state).toBe(k === 60 ? "COMPLETED" : "FORMING");
      const m30 = await last("M30");
      expect(m30.state).toBe(k === 30 || k === 60 ? "COMPLETED" : "FORMING");
    }
  });

  it("E: switching the interval mid-play continues from the current position, to the next boundary of the new interval, skipping nothing", async () => {
    const before = await now2();
    await step("M1");
    await step("M1");
    await step("M1");
    expect(await now2()).toBe(before + 3);
    await step("M5"); // next step uses the new interval: to the end of the 5-minute bucket after the current minute
    const after = await now2();
    expect(after).toBe(bucketStart(before + 4, "M5") + 4);
    expect(after - (before + 3)).toBeLessThanOrEqual(5);
    // Contiguous, no duplicates, nothing beyond the clock.
    const ms = await revealed();
    expect(new Set(ms).size).toBe(ms.length);
    expect(ms[ms.length - 1]).toBe(after);
    for (let i = 1; i < ms.length; i++) if (ms[i] - ms[i - 1] !== 1) expect(Math.floor(ms[i] / 1440)).not.toBe(Math.floor(ms[i - 1] / 1440)); // gaps only between days of data
  });
});

