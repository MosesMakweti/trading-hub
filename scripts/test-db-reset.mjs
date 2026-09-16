// Stage 20.3 — intentional, destructive reset of the dedicated test
// database: drops and recreates `trading_hub_test` from absolute zero,
// then reapplies the full migration chain via `prisma migrate deploy`.
//
// Two independent guards, both required:
// 1. `resolveTestDatabaseTarget()` (scripts/lib/test-db.mjs) refuses to
//    proceed unless `.env.test`'s DATABASE_URL names EXACTLY
//    `trading_hub_test` — a misconfigured or missing `.env.test` can never
//    cause this to target your development database.
// 2. An explicit `--confirm=RESET-TEST-DB` flag, required verbatim on the
//    command line (mirrors `purge-twelvedata-market-data-cache.mjs`'s own
//    convention) — this can never fire from a stray `npm run` alias or a
//    misremembered script name.
//
// Usage:
//   npm run test:db:reset -- --confirm=RESET-TEST-DB
import { execFileSync } from "node:child_process";
import { createDatabase, dropDatabase, printSanitizedTarget, resolveTestDatabaseTarget } from "./lib/test-db.mjs";

async function main() {
  if (!process.argv.includes("--confirm=RESET-TEST-DB")) {
    throw new Error("Refusing to reset the test database without --confirm=RESET-TEST-DB on the command line (this drops all data in it).");
  }

  const { dbName, testUrl, adminUrl } = resolveTestDatabaseTarget();
  printSanitizedTarget(testUrl, dbName);

  console.log(`[test-db-reset] Dropping "${dbName}" (if it exists)...`);
  await dropDatabase(adminUrl, dbName);

  console.log(`[test-db-reset] Recreating "${dbName}"...`);
  await createDatabase(adminUrl, dbName);

  console.log(`[test-db-reset] Applying migrations via prisma migrate deploy...`);
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: "inherit",
  });

  console.log(`\n[test-db-reset] Done. "${dbName}" has been reset to a clean, fully-migrated state.\n`);
}

main().catch((error) => {
  console.error(`\n[test-db-reset] FAILED: ${error.message}\n`);
  process.exit(1);
});
