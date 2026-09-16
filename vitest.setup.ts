// Ensures `.env` is loaded inside each vitest worker (not just the CLI
// launcher process) — needed for DB-touching integration tests (e.g.
// prop-firms.service.test.ts) whose Prisma client reads `DATABASE_URL` from
// `process.env` at import time. Mirrors prisma.config.ts's own `dotenv/config`.
import "dotenv/config";

// Stage 20.3 — `.env` alone would leave DATABASE_URL pointed at the
// long-lived development database, which is exactly what caused test
// fixtures to accumulate there. Vitest sets NODE_ENV=test automatically, so
// when running under test we additionally load `.env.test` with
// `override: true`, giving its DATABASE_URL (the dedicated
// `trading_hub_test`) priority over whatever `.env` set. This file loading
// alone is NOT the safety mechanism — see `assertTestDatabaseSafety` below,
// which fails loudly if this override didn't take effect for any reason
// (missing `.env.test`, a misconfigured value, etc.) rather than silently
// letting a test touch the development database.
if (process.env.NODE_ENV === "test") {
  const dotenv = await import("dotenv");
  dotenv.config({ path: ".env.test", override: true, quiet: true });
}

const { assertTestDatabaseSafety } = await import("@/server/testing/db-safety");
const { beforeAll } = await import("vitest");

beforeAll(async () => {
  await assertTestDatabaseSafety();
});
