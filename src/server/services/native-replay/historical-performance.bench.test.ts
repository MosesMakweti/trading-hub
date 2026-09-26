/**
 * Native Replay performance benchmark — opt-in (NATIVE_REPLAY_BENCH=1), so it
 * never adds load or flakiness to the normal suite. Prints a table used in
 * docs/NATIVE_REPLAY.md. Run:
 *
 *   NATIVE_REPLAY_BENCH=1 npx vitest run src/server/services/native-replay/historical-performance.bench.test.ts
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { getHistoricalCandles } from "@/server/services/native-replay/historical-candles.service";
import { aggregateCandles } from "@/domain/native-replay/candle-engine";
import { analyzeMt5M1Import } from "@/domain/native-replay/import-analysis";
import type { ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { syntheticMt5Export } from "@/domain/native-replay/testing/m1-fixtures";
import { createBacktestRun } from "@/server/services/backtest-run.service";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { attachDatasetToRun } from "@/server/services/native-replay/backtest-dataset-pin.service";
import { advanceReplay, getReplayCandles, initializeReplay } from "@/server/services/native-replay/backtest-replay.service";

const enabled = process.env.NATIVE_REPLAY_BENCH === "1";
const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

const ms = (t: number) => `${Math.round(performance.now() - t)}ms`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe.skipIf(!enabled)("Native Replay benchmark", () => {
  it("parse + validate at the 2M-bar row ceiling (no database)", () => {
    const { text, bars } = syntheticMt5Export({ startDay: "2019-01-01", days: 1940 });
    global.gc?.();
    const heap0 = process.memoryUsage().heapUsed;
    const t = performance.now();
    const analysis = analyzeMt5M1Import({ text, fileName: "EURUSD_M1_201901010000_202405232359.csv" });
    const elapsed = ms(t);
    global.gc?.();
    // Retained = the canonical typed arrays still referenced by `analysis`
    // (+ external ArrayBuffer memory, where typed arrays live).
    const mem = process.memoryUsage();
    console.log(`\n=== ceiling: ${bars.toLocaleString()} bars, ${(text.length / 1e6).toFixed(0)}MB text ===\nparse + validate: ${elapsed} (retained heap +${Math.round((mem.heapUsed - heap0) / 1e6)}MB, array buffers ${Math.round(mem.arrayBuffers / 1e6)}MB, rss ${Math.round(mem.rss / 1e6)}MB incl. fixture)`);
    expect(analysis.report.counts.bars).toBe(bars);
  }, 600_000);

  for (const days of [97, 486]) {
    it(`${days} calendar days of M1`, async () => {
      const u = await createTestUser(`nr-bench-${days}`);
      userIds.push(u.id);
      const { text, bars } = syntheticMt5Export({ startDay: "2023-01-02", days });
      const bytes = new TextEncoder().encode(text);
      console.log(`\n=== ${bars.toLocaleString()} M1 bars, ${(bytes.byteLength / 1e6).toFixed(1)}MB file ===`);

      global.gc?.();
      const heap0 = process.memoryUsage().heapUsed;
      let t = performance.now();
      const analysis = analyzeMt5M1Import({ text, fileName: "EURUSD_M1_202301020000_202401012359.csv" });
      console.log(`parse + validate: ${ms(t)}  (heap +${Math.round((process.memoryUsage().heapUsed - heap0) / 1e6)}MB)`);
      expect(analysis.report.counts.bars).toBe(bars);

      t = performance.now();
      const ds = await importHistoricalDataset(u.id, { bytes, fileName: "EURUSD_M1_202301020000_202401012359.csv" });
      console.log(`full import (decode + parse + validate + persist + verify): ${ms(t)}`);

      const seq = (await prisma.historicalDataset.findUniqueOrThrow({ where: { id: ds.id } })).seq;
      await prisma.$executeRawUnsafe(`VACUUM (FULL, ANALYZE) "HistoricalBar"`); // measure without dead tuples
      const [size] = await prisma.$queryRaw<{ table: bigint; idx: bigint }[]>`
        SELECT pg_relation_size('"HistoricalBar"') AS table, pg_indexes_size('"HistoricalBar"') AS idx
      `;
      const total = await prisma.historicalBar.count();
      console.log(`storage (whole table, ${total.toLocaleString()} rows): heap ${(Number(size.table) / 1e6).toFixed(1)}MB, index ${(Number(size.idx) / 1e6).toFixed(1)}MB → ~${Math.round((Number(size.table) + Number(size.idx)) / total)} bytes/bar`);
      const plan = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
        `EXPLAIN SELECT * FROM "HistoricalBar" WHERE "datasetSeq" = ${seq} AND "minute" BETWEEN ${ds.lastBarMinute! - 30000} AND ${ds.lastBarMinute!} ORDER BY "minute"`,
      );
      console.log(`range plan: ${plan.map((p) => p["QUERY PLAN"]).join(" | ").slice(0, 160)}`);

      const cases: [ReplayTimeframe, number][] = [["M1", 500], ["M15", 500], ["H1", 500], ["H4", 500], ["D1", 250], ["W1", 52]];
      for (const [timeframe, limit] of cases) {
        const times: number[] = [];
        let count = 0;
        let bucketBars = 0;
        for (let i = 0; i < 5; i += 1) {
          const cutoff = ds.lastBarMinute! - i * 997;
          const t0 = performance.now();
          const res = await getHistoricalCandles(u.id, { datasetId: ds.id, timeframe, limit, cutoff });
          times.push(performance.now() - t0);
          count = res.candles.length;
          bucketBars = res.candles.reduce((s, c) => s + c.barCount, 0);
        }
        // Pure aggregation cost for the same M1 volume.
        const t1 = performance.now();
        aggregateCandles(analysis.bars!, { timeframe, cutoff: ds.lastBarMinute! });
        const aggAll = performance.now() - t1;
        console.log(`${timeframe.padEnd(3)} ${String(count).padStart(3)} candles from ${bucketBars.toLocaleString().padStart(7)} M1 rows: median ${Math.round(median(times))}ms (min ${Math.round(Math.min(...times))}ms) | pure aggregation of ALL ${bars.toLocaleString()} bars: ${Math.round(aggAll)}ms`);
      }
    }, 600_000);
  }

  it("full import from bytes at the 2M-bar ceiling (what the R2 path runs): time and peak memory", async () => {
    const u = await createTestUser("nr-bench-ceiling-import");
    userIds.push(u.id);
    let bytes: Uint8Array | null = new TextEncoder().encode(syntheticMt5Export({ startDay: "2019-01-01", days: 1940 }).text);
    global.gc?.();
    const base = process.memoryUsage().rss;
    let peak = base;
    const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 50);
    const t = performance.now();
    const ds = await importHistoricalDataset(u.id, { bytes, fileName: "EURUSD_M1_201901010000_202405232359.csv" });
    clearInterval(sampler);
    console.log(`\n=== ceiling import: ${ds.barCount.toLocaleString()} bars, ${(bytes.byteLength / 1e6).toFixed(0)}MB file ===\nfull import: ${ms(t)} · RSS before ${Math.round(base / 1e6)}MB (file bytes already held), peak ${Math.round(peak / 1e6)}MB (+${Math.round((peak - base) / 1e6)}MB)`);
    bytes = null;
  }, 600_000);

  it("replay operation latency on a 500k-bar dataset", async () => {
    const u = await createTestUser("nr-bench-replay");
    userIds.push(u.id);
    const { text } = syntheticMt5Export({ startDay: "2023-01-02", days: 486 });
    const ds = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(text), fileName: "EURUSD_M1_202301020000_202405022359.csv" });
    const run = await createBacktestRun(u.id, createBacktestRunSchema.parse({ name: "bench", assets: ["EURUSD"], startDate: "2024-03-04", endDate: "2024-03-29" }));
    await attachDatasetToRun(u.id, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds.id });
    const ref = { runId: run.id, dateKey: "2024-03-13", assetSymbol: "EURUSD" };
    await initializeReplay(u.id, ref);
    await advanceReplay(u.id, ref, { kind: "SEEK", to: (await getReplayCandles(u.id, ref, { timeframe: "M1", limit: 1 })).position.minute + 9 * 60 });
    const time = async (label: string, fn: () => Promise<unknown>, n = 15) => {
      const xs: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const t0 = performance.now();
        await fn();
        xs.push(performance.now() - t0);
      }
      console.log(`${label.padEnd(26)} median ${median(xs).toFixed(1)}ms  p90 ${[...xs].sort((a, b) => a - b)[Math.floor(n * 0.9)].toFixed(1)}ms`);
    };
    console.log("\n=== replay latency (in-process service calls, local Postgres) ===");
    await time("+1 bar", () => advanceReplay(u.id, ref, { kind: "BARS", count: 1 }, crypto.randomUUID()));
    await time("+5 bars", () => advanceReplay(u.id, ref, { kind: "BARS", count: 5 }, crypto.randomUUID()));
    await time("+30 bars", () => advanceReplay(u.id, ref, { kind: "BARS", count: 30 }, crypto.randomUUID()), 8);
    for (const timeframe of ["M1", "M30", "H1", "H4"] as const) await time(`candles ${timeframe} ×500`, () => getReplayCandles(u.id, ref, { timeframe, limit: 500 }), 8);
    await time("candles M30 ×6 (panel)", () => getReplayCandles(u.id, ref, { timeframe: "M30", limit: 6 }));
  }, 600_000);
});
