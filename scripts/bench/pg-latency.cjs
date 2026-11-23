/**
 * Benchmark-only preload: adds BENCH_DB_LATENCY_MS before every Postgres
 * statement to SIMULATE a remote database. Usage:
 *   BENCH_DB_LATENCY_MS=12 NODE_OPTIONS="--require ./scripts/bench/pg-latency.cjs" npx next start
 * Never used by the application itself.
 */
const ms = Number(process.env.BENCH_DB_LATENCY_MS || 0);
if (ms > 0) {
  const pg = require("pg");
  const original = pg.Client.prototype.query;
  pg.Client.prototype.query = function (...args) {
    const self = this;
    // Callback-style calls are passed straight through (not used by the Prisma adapter).
    if (typeof args[args.length - 1] === "function") return original.apply(self, args);
    return new Promise((r) => setTimeout(r, ms)).then(() => original.apply(self, args));
  };
  console.log(`[bench] simulated DB latency: ${ms} ms per statement`);
}
