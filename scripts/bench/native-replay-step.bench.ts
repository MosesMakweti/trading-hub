/**
 * Native Replay (legacy Backtest Runs) step benchmark — server side, TEST DB.
 * Run: set -a; . ./.env.test; set +a; [BENCH_DB_LATENCY_MS=12] npx tsx scripts/bench/native-replay-step.bench.ts
 */
import { performance } from "node:perf_hooks";
import pg from "pg";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun } from "@/server/services/backtest-run.service";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { attachDatasetToRun } from "@/server/services/native-replay/backtest-dataset-pin.service";
import { advanceReplay, initializeReplay } from "@/server/services/native-replay/backtest-replay.service";
import { syntheticMt5Export } from "@/domain/native-replay/testing/m1-fixtures";

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

async function main() {
  const u = await createTestUser("bench-native");
  try {
    const run = await createBacktestRun(u.id, createBacktestRunSchema.parse({ name: "bench", assets: ["EURUSD"], startDate: "2024-05-13", endDate: "2024-05-24" }));
    const { text } = syntheticMt5Export({ startDay: "2024-05-13", days: 10 });
    const ds = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(text), fileName: "EURUSD_M1_202405130000_202405242359.csv" });
    await attachDatasetToRun(u.id, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds.id });
    const ref = { runId: run.id, dateKey: "2024-05-15", assetSymbol: "EURUSD" };
    await initializeReplay(u.id, ref);
    for (const [label, command] of [["BARS 1", { kind: "BARS", count: 1 }], ["CANDLE M15", { kind: "CANDLE", timeframe: "M15" }]] as const) {
      const ms: number[] = [];
      let q = 0;
      for (let i = 0; i < 20; i++) {
        const q0 = queries;
        const t = performance.now();
        await advanceReplay(u.id, ref, command as never, null, "EURUSD");
        ms.push(performance.now() - t);
        q = queries - q0;
      }
      ms.sort((a, b) => a - b);
      console.log(`advanceReplay ${label.padEnd(12)} median ${ms[10].toFixed(1).padStart(7)} ms   ${q} queries${LATENCY ? ` (simulated ${LATENCY} ms/statement)` : ""}`);
    }
  } finally {
    await deleteTestUsers(u.id);
    await prisma.$disconnect();
  }
}
main();
