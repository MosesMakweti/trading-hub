/**
 * Replay step benchmark (server side). Seeds a 60-day EURUSD dataset into
 * the TEST database, then times each server operation a Next Candle press
 * triggers. Run: set -a; . ./.env.test; set +a; npx tsx scripts/bench/replay-step.bench.ts
 */
import { performance } from "node:perf_hooks";
import pg from "pg";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { syntheticMt5Export } from "@/domain/native-replay/testing/m1-fixtures";
import { createLabAccount, startSimClock } from "@/server/services/simulation/sim-account.service";
import { advanceSimClock } from "@/server/services/simulation/sim-clock.service";
import { getRevealedBars, getSimAccountState, getSimCandles, getSimStepPatch } from "@/server/services/simulation/sim-state.service";
import { accountFeedsCached } from "@/server/services/simulation/sim-market";
import { barCacheStats } from "@/server/services/market-data/bar-cache";

// Counts every statement sent to Postgres; BENCH_DB_LATENCY_MS adds a delay
// before each one to SIMULATE a remote database (e.g. 12 ≈ Vercel iad1 →
// Neon us-east-2). Simulated latency is labelled as such in the output.
let queries = 0;
const LATENCY = Number(process.env.BENCH_DB_LATENCY_MS ?? 0);
const original = pg.Client.prototype.query;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pg.Client.prototype as any).query = function (this: unknown, ...args: any[]) {
  queries++;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!LATENCY) return (original as any).apply(this, args);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Promise((r) => setTimeout(r, LATENCY)).then(() => (original as any).apply(this, args));
};

async function time<T>(label: string, runs: number, fn: () => Promise<T>) {
  const ms: number[] = [];
  let q = 0;
  for (let i = 0; i < runs; i++) {
    const q0 = queries;
    const t0 = performance.now();
    await fn();
    ms.push(performance.now() - t0);
    q = queries - q0;
  }
  ms.sort((a, b) => a - b);
  const med = ms[Math.floor(ms.length / 2)];
  const p90 = ms[Math.floor(ms.length * 0.9)];
  console.log(`${label.padEnd(46)} median ${med.toFixed(1).padStart(7)} ms   p90 ${p90.toFixed(1).padStart(7)} ms   ${String(q).padStart(3)} queries`);
  return med;
}

async function main() {
  const u = await createTestUser("bench-replay");
  try {
    const { text } = syntheticMt5Export({ startDay: "2024-03-04", days: 60 });
    const ds = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(text), fileName: "EURUSD_M1_202403040000_202405022359.csv" });
    const acct = await createLabAccount(u.id, { name: "bench", datasets: [{ assetSymbol: "EURUSD", datasetId: ds.id }], periodStart: "2024-03-04", periodEnd: "2024-05-02", startingBalance: 10000, currency: "USD" });
    await startSimClock(u.id, acct.id);
    // Move ~30 days in so there is plenty of history behind the clock.
    for (let i = 0; i < 30; i++) await advanceSimClock(u.id, acct.id, { kind: "NEXT_DAY" });

    // New path: one step = advance + patch + revealed bars (what the action does).
    const step = async (command: Parameters<typeof advanceSimClock>[2]) => {
      const { snapshot, ...o } = await advanceSimClock(u.id, acct.id, command);
      const feeds = await accountFeedsCached(prisma, acct.id);
      await Promise.all([snapshot ? getSimStepPatch(snapshot) : getSimAccountState(u.id, acct.id), getRevealedBars(feeds, ["EURUSD"], o.fromMinute, o.toMinute)]);
    };
    await time("STEP (advance + patch + revealed) BARS 1", 30, () => step({ kind: "BARS", count: 1 }));
    await time("STEP (advance + patch + revealed) CANDLE M15", 30, () => step({ kind: "CANDLE", timeframe: "M15" }));
    await time("STEP (advance + patch + revealed) CANDLE H1", 20, () => step({ kind: "CANDLE", timeframe: "H1" }));
    console.log("bar buffer:", JSON.stringify(barCacheStats()));
    await time("advanceSimClock BARS 1", 30, () => advanceSimClock(u.id, acct.id, { kind: "BARS", count: 1 }));
    await time("advanceSimClock CANDLE M15", 30, () => advanceSimClock(u.id, acct.id, { kind: "CANDLE", timeframe: "M15" }));
    await time("getSimAccountState", 30, () => getSimAccountState(u.id, acct.id));
    await time("getSimCandles M15 limit 1500", 20, () => getSimCandles(u.id, acct.id, { symbol: "EURUSD", timeframe: "M15", limit: 1500 }));
    await time("getSimCandles M1 limit 1500", 20, () => getSimCandles(u.id, acct.id, { symbol: "EURUSD", timeframe: "M1", limit: 1500 }));
    await time("getSimCandles H1 limit 1500", 20, () => getSimCandles(u.id, acct.id, { symbol: "EURUSD", timeframe: "H1", limit: 1500 }));
    console.log(LATENCY ? `(simulated DB latency: ${LATENCY} ms per statement)` : "(local DB, no added latency)");
    const c = await getSimCandles(u.id, acct.id, { symbol: "EURUSD", timeframe: "M15", limit: 1500 });
    console.log(`M15 response: ${c.candles.length} candles, ${(JSON.stringify(c).length / 1024).toFixed(0)} KB JSON`);
  } finally {
    await deleteTestUsers(u.id);
    await prisma.$disconnect();
  }
}
main();
