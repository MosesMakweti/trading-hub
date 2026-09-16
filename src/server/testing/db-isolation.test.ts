import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { Client } from "pg";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { EXPECTED_TEST_DATABASE_NAME } from "@/server/testing/db-safety";

/**
 * Stage 20.3 §15 — permanent regression proof that running the test suite
 * (against `trading_hub_test`) can NEVER mutate the development database
 * (`trading_hub`). This is the one test file in the suite deliberately
 * allowed to open a SEPARATE, direct, READ-ONLY connection to the
 * development database — every other test file only ever touches
 * `prisma` (the app's singleton, locked to `trading_hub_test` by
 * `assertTestDatabaseSafety`). This file must never call `.query` with
 * anything other than a plain `SELECT count(*)` on that connection.
 *
 * Reads `.env`'s own DATABASE_URL directly from disk (via `dotenv.parse`,
 * never `process.env.DATABASE_URL`, which by the time this file runs has
 * already been overridden to `trading_hub_test` by `vitest.setup.ts`) —
 * this is the only reliable way to reach the ACTUAL development database
 * from inside a test process without reintroducing the exact hazard this
 * stage removed.
 */
function readDevDatabaseUrl(): string {
  const parsed = dotenv.parse(readFileSync(".env"));
  const url = parsed.DATABASE_URL;
  if (!url) throw new Error("Could not read DATABASE_URL from .env for the isolation regression check.");
  return url;
}

async function readOnlyDevCounts(devUrl: string) {
  const client = new Client({ connectionString: devUrl });
  await client.connect();
  try {
    const [users, trades] = await Promise.all([client.query('SELECT count(*)::int AS count FROM "User"'), client.query('SELECT count(*)::int AS count FROM "Trade"')]);
    return { users: users.rows[0].count as number, trades: trades.rows[0].count as number };
  } finally {
    await client.end();
  }
}

describe("Test/development database isolation (Stage 20.3 §15-16)", () => {
  it("the test suite's own DATABASE_URL is the dedicated test database, never development", () => {
    const testDbName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, "");
    const devDbName = new URL(readDevDatabaseUrl()).pathname.replace(/^\//, "");
    expect(testDbName).toBe(EXPECTED_TEST_DATABASE_NAME);
    expect(devDbName).not.toBe(EXPECTED_TEST_DATABASE_NAME);
    expect(testDbName).not.toBe(devDbName);
  });

  it("creating and cleaning up test fixtures never changes development User/Trade counts", async () => {
    const devUrl = readDevDatabaseUrl();
    const before = await readOnlyDevCounts(devUrl);

    // A representative DB-backed operation against the TEST database only.
    const user = await createTestUser("isolation-proof");
    await prisma.trade.create({
      data: {
        userId: user.id,
        tradeDate: new Date("2026-08-04T00:00:00.000Z"),
        executionMinutes: 5,
        direction: "LONG",
        higherTimeframeBias: "BULLISH",
        biasConfidencePercent: 80,
        assetSymbol: "XAUUSD",
        actualRR: 1,
      },
    });
    await deleteTestUsers(user.id);

    const after = await readOnlyDevCounts(devUrl);
    expect(after).toEqual(before);
  });

  it("NODE_ENV is 'test' under vitest, which is what triggers the .env.test override", () => {
    expect(process.env.NODE_ENV).toBe("test");
  });
});
