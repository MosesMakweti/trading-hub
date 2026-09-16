// Stage 20.3 — first-time / idempotent setup of the dedicated test
// database. Safe to run repeatedly: creates `trading_hub_test` only if it
// doesn't already exist, then applies the real migration chain via
// `prisma migrate deploy` (never `db push`, never `migrate reset`). Never
// touches your development database — see scripts/lib/test-db.mjs for the
// hard guard that enforces this.
//
// Usage:
//   npm run test:db:setup
import { execFileSync } from "node:child_process";
import { createDatabase, databaseExists, printSanitizedTarget, resolveTestDatabaseTarget } from "./lib/test-db.mjs";

async function main() {
  const { dbName, testUrl, adminUrl } = resolveTestDatabaseTarget();
  printSanitizedTarget(testUrl, dbName);

  const exists = await databaseExists(adminUrl, dbName);
  if (exists) {
    console.log(`[test-db-setup] "${dbName}" already exists — skipping creation.`);
  } else {
    console.log(`[test-db-setup] Creating "${dbName}"...`);
    await createDatabase(adminUrl, dbName);
  }

  console.log(`[test-db-setup] Applying migrations to "${dbName}" via prisma migrate deploy...`);
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: "inherit",
  });

  console.log(`\n[test-db-setup] Done. "${dbName}" is ready for \`npm test\`.\n`);
}

main().catch((error) => {
  console.error(`\n[test-db-setup] FAILED: ${error.message}\n`);
  process.exit(1);
});
