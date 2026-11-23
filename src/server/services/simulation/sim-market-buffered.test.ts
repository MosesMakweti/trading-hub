import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { mt5Text, syntheticMt5Export } from "@/domain/native-replay/testing/m1-fixtures";
import { parseWallClock } from "@/domain/native-replay/wall-clock";
import { REPLAY_TIMEFRAMES } from "@/domain/native-replay/timeframes";
import { barCacheStats, MAX_BYTES, resetBarCache } from "@/server/services/market-data/bar-cache";
import {
  latestBars,
  latestBarsBuffered,
  loadStepBars,
  loadStepBarsBuffered,
  targetMinute,
  targetMinuteBuffered,
  type ClockCommand,
  type SimFeed,
} from "./sim-market";

const userIds: string[] = [];
let feeds: SimFeed[] = [];
let from = 0;
let to = 0;

beforeAll(async () => {
  const u = await createTestUser("sim-buffered");
  userIds.push(u.id);
  // EURUSD: 10 broker days Mon–Fri incl. a weekend gap.
  const eur = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(syntheticMt5Export({ startDay: "2024-05-13", days: 10 }).text), fileName: "EURUSD_M1_202405130000_202405242359.csv" });
  // GBPUSD: sparse M1 — short runs within a few hours each day, so the two timelines differ.
  const rows: string[][] = [];
  for (let d = 13; d <= 24; d++) {
    if (d === 18 || d === 19) continue; // weekend
    // Runs of 3 consecutive minutes every 17 minutes: real M1 bars, with gaps.
    for (let m = 8 * 60; m < 12 * 60; m += (m % 17 === 2 ? 15 : 1)) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      rows.push([`2024.05.${d}`, `${hh}:${mm}`, "1.26000", "1.26010", "1.25990", "1.26005", "5", "0", "3"]);
    }
  }
  const gbp = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(mt5Text(rows)), fileName: `GBPUSD_M1_202405130800_20240524${rows[rows.length - 1][1].replace(":", "")}.csv` });
  const ds = await prisma.historicalDataset.findMany({ where: { id: { in: [eur.id, gbp.id] } }, select: { id: true, seq: true, priceScale: true, symbol: true } });
  feeds = ds.map((d) => ({ symbol: d.symbol, datasetId: d.id, seq: d.seq, priceScale: d.priceScale })).sort((a, b) => a.symbol.localeCompare(b.symbol));
  from = parseWallClock("2024-05-13T00:00")!;
  to = parseWallClock("2024-05-24T23:59")!;
  resetBarCache();
});
afterAll(() => deleteTestUsers(...userIds));

describe("buffered market reads equal the SQL reads", () => {
  it("targetMinute: every command type from many positions, near and across weekends", async () => {
    const commands: ClockCommand[] = [
      { kind: "BARS", count: 1 },
      { kind: "BARS", count: 7 },
      { kind: "BARS", count: 1440 },
      { kind: "NEXT_DAY" },
      { kind: "SEEK", to: parseWallClock("2024-05-21T10:30")! },
      ...REPLAY_TIMEFRAMES.map((timeframe): ClockCommand => ({ kind: "CANDLE", timeframe })),
    ];
    const positions = [from - 1, from + 5, parseWallClock("2024-05-14T09:13")!, parseWallClock("2024-05-17T23:58")!, parseWallClock("2024-05-18T12:00")!, parseWallClock("2024-05-24T23:30")!, to];
    let checked = 0;
    for (const cur of positions) {
      for (const command of commands) {
        for (const hour of [0, 17]) {
          const sql = await targetMinute(prisma, feeds, cur, command, to, hour);
          const buf = await targetMinuteBuffered(feeds, cur, command, to, hour);
          expect(buf, `${JSON.stringify(command)} from ${cur} reset ${hour}`).toBe(sql);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("loadStepBars and latestBars", async () => {
    const ranges: [number, number][] = [
      [from - 1, from + 30],
      [parseWallClock("2024-05-14T07:50")!, parseWallClock("2024-05-14T12:10")!],
      [parseWallClock("2024-05-17T23:00")!, parseWallClock("2024-05-20T01:00")!],
    ];
    for (const [a, b] of ranges) {
      const sql = await loadStepBars(prisma, feeds, a, b);
      const buf = await loadStepBarsBuffered(feeds, a, b);
      expect(buf.timeline).toEqual(sql.timeline);
      for (const f of feeds) expect([...buf.bars.get(f.symbol)!.entries()]).toEqual([...sql.bars.get(f.symbol)!.entries()]);
    }
    for (const m of [from + 3, parseWallClock("2024-05-18T12:00")!, parseWallClock("2024-05-20T08:03")!, to]) {
      expect(await latestBarsBuffered(feeds, m)).toEqual(await latestBars(prisma, feeds, m));
    }
  });

  it("stays within its memory bound and reuses loaded days", async () => {
    resetBarCache();
    await loadStepBarsBuffered(feeds, from, from + 60);
    const q1 = barCacheStats().queries;
    await loadStepBarsBuffered(feeds, from + 60, from + 120); // same day: no query
    expect(barCacheStats().queries).toBe(q1);
    const s = barCacheStats();
    expect(s.bytes).toBeLessThanOrEqual(MAX_BYTES);
    expect(s.bytes).toBeGreaterThan(0);
  });

  it("concurrent loads of the same days share one query", async () => {
    resetBarCache();
    await Promise.all(Array.from({ length: 8 }, () => loadStepBarsBuffered(feeds, from, from + 2000)));
    expect(barCacheStats().queries).toBe(1);
  });
});
