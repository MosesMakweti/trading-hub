// Stage 20.3 — shared target-resolution + hard safety guard for
// `test-db-setup.mjs` and `test-db-reset.mjs`. Deliberately does NOT import
// `@/server/testing/db-safety` — these scripts run via
// `node --experimental-strip-types`, which (like
// `purge-twelvedata-market-data-cache.mjs`) does not resolve the project's
// `@/*` path alias. The expected name is duplicated here as a literal
// constant; keep it in sync with `EXPECTED_TEST_DATABASE_NAME` in
// `src/server/testing/db-safety.ts` if it's ever renamed.
import "dotenv/config";
import dotenv from "dotenv";
import pg from "pg";

export const EXPECTED_TEST_DATABASE_NAME = "trading_hub_test";

/**
 * Loads `.env.test` (never `.env`) and returns the admin connection URL
 * (same server, `postgres` maintenance database) and the test database's
 * own URL — but only after confirming the configured database name is
 * EXACTLY `trading_hub_test`. Throws (never silently falls back to `.env`)
 * if `.env.test` is missing, malformed, or points anywhere else — this is
 * the one place both scripts refuse to guess.
 */
export function resolveTestDatabaseTarget() {
  const result = dotenv.config({ path: ".env.test", override: true, quiet: true });
  if (result.error) {
    throw new Error(
      ".env.test could not be loaded. Copy .env.test.example to .env.test first (it must point at a database " +
        `named exactly "${EXPECTED_TEST_DATABASE_NAME}", never your development database).`,
    );
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error(".env.test does not define DATABASE_URL.");

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(".env.test's DATABASE_URL is not a valid connection URL.");
  }

  const dbName = url.pathname.replace(/^\//, "");
  if (dbName !== EXPECTED_TEST_DATABASE_NAME) {
    throw new Error(
      `.env.test's DATABASE_URL points at database "${dbName}", not the required "${EXPECTED_TEST_DATABASE_NAME}". ` +
        "Refusing to proceed — this guard exists specifically so a misconfigured .env.test can never target " +
        "your development database.",
    );
  }

  const adminUrl = new URL(url.toString());
  adminUrl.pathname = "/postgres";

  return { dbName, testUrl: url, adminUrl };
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function withAdminClient(adminUrl, fn) {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function databaseExists(adminUrl, dbName) {
  return withAdminClient(adminUrl, async (client) => {
    const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    return rows.length > 0;
  });
}

export async function createDatabase(adminUrl, dbName) {
  await withAdminClient(adminUrl, (client) => client.query(`CREATE DATABASE ${quoteIdent(dbName)}`));
}

export async function dropDatabase(adminUrl, dbName) {
  await withAdminClient(adminUrl, (client) => client.query(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)} WITH (FORCE)`));
}

export function printSanitizedTarget(testUrl, dbName) {
  console.log(`[test-db] target database: "${dbName}" on ${testUrl.hostname}:${testUrl.port || 5432} (credentials not printed)`);
}
