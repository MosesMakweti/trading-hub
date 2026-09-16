import { prisma } from "@/server/db";

/**
 * Stage 20.3 — the single source of truth for "which database is the
 * dedicated test database." Reused by `assertTestDatabaseSafety` below,
 * `scripts/test-db-setup.mjs`, and `scripts/test-db-reset.mjs` so there is
 * exactly one place this name can ever be changed.
 */
export const EXPECTED_TEST_DATABASE_NAME = "trading_hub_test";

/**
 * Hard runtime safety guard against ever running database-backed tests
 * (create/cleanup/delete) against the long-lived development database.
 * Deliberately does NOT trust `.env`/`.env.test` file-loading alone (a
 * missing file, a stale shell env var, or a future refactor could all
 * silently defeat that) — this checks two independent things:
 *
 * 1. The database name as PARSED from `DATABASE_URL` — cheap, and catches
 *    the common case (wrong/missing `.env.test`) with an immediate, clear
 *    message before any query is even attempted.
 * 2. The ACTUAL connected database identity via `SELECT current_database()`
 *    — catches anything the static parse could miss (e.g. a connection
 *    string that behaves differently than its literal path suggests).
 *
 * Both must equal exactly `trading_hub_test` — this is an allowlist of
 * one, not a blocklist of known-bad names, so it also rejects any
 * production-like or unrecognized name by construction. Called once per
 * test file from `vitest.setup.ts`'s global `beforeAll` — every DB-backed
 * test file gets this protection automatically, without having to
 * remember to call it itself.
 */
export async function assertTestDatabaseSafety(): Promise<void> {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      "[test-db-safety] DATABASE_URL is not set. Refusing to run database-backed tests. " +
        "Copy .env.test.example to .env.test and run `npm run test:db:setup`.",
    );
  }

  let parsedName: string;
  try {
    parsedName = new URL(rawUrl).pathname.replace(/^\//, "");
  } catch {
    throw new Error(`[test-db-safety] DATABASE_URL is not a valid connection URL. Refusing to run database-backed tests.`);
  }

  if (parsedName !== EXPECTED_TEST_DATABASE_NAME) {
    throw new Error(
      `[test-db-safety] DATABASE_URL points at database "${parsedName}", not the dedicated test database ` +
        `"${EXPECTED_TEST_DATABASE_NAME}". Refusing to run database-backed tests — this almost always means ` +
        `.env.test is missing, misconfigured, or wasn't loaded. Copy .env.test.example to .env.test ` +
        `and run \`npm run test:db:setup\`. NEVER point tests at your development database.`,
    );
  }

  const rows = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  const actualName = rows[0]?.current_database;
  if (actualName !== EXPECTED_TEST_DATABASE_NAME) {
    throw new Error(
      `[test-db-safety] Connected to database "${actualName}", not "${EXPECTED_TEST_DATABASE_NAME}", ` +
        `despite DATABASE_URL's path parsing as the expected name. Refusing to run database-backed tests.`,
    );
  }
}
