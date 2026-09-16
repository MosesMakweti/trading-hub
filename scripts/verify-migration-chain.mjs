// Stage 20.2 — proves "empty database + committed migration chain -> valid
// current Traditorium schema" on demand, without ever touching the real
// development or production database.
//
// WHY THIS EXISTS: `prisma migrate dev` on the real dev database once
// requested a full reset due to a *dev-database-local* bookkeeping issue in
// `_prisma_migrations` (two stale rolled-back rows left over from an old
// failed migration attempt — see docs/PRISMA_MIGRATION_CHAIN_AUDIT.md).
// That incident showed there was no easy way to independently confirm
// whether the migration *chain itself* (the files in prisma/migrations/)
// was actually reproducible, separate from whatever state the long-lived
// dev database happened to be in. This script is that independent check.
//
// SAFETY MODEL (read this before running):
// - Requires an explicit `--verify-db-name=<name>` argument. There is no
//   default and no flag that reuses `DATABASE_URL`'s own database as the
//   target — the script hard-refuses if the name you pass matches the
//   database name in your own `DATABASE_URL`.
// - Only ever issues `CREATE DATABASE` / `DROP DATABASE` for that exact,
//   explicitly-named database on the SAME Postgres server your
//   `DATABASE_URL` already points at (same host/port/credentials) — it
//   builds the verification connection string by swapping only the
//   database-name path segment, never by accepting an arbitrary URL that
//   could point somewhere else by mistake.
// - Runs `prisma migrate deploy` (the production-style path), never
//   `prisma migrate dev` and never `prisma db push`, against the
//   verification database only.
// - Drops and recreates the verification database itself every run (it is
//   disposable, single-purpose, and never intended to hold real data) so
//   the replay is always from absolute zero, never incrementally patched.
// - Never reads or writes anything in the database your `DATABASE_URL`
//   points at.
//
// Usage:
//   node --experimental-strip-types scripts/verify-migration-chain.mjs --verify-db-name=traditorium_migration_verify
//
// Optional:
//   --keep    Do not drop the verification database at the end (for manual follow-up inspection).
import "dotenv/config";
import { execFileSync } from "node:child_process";
import pg from "pg";

function parseArgs(argv) {
  const args = { keep: false };
  for (const raw of argv) {
    if (raw === "--keep") args.keep = true;
    else if (raw.startsWith("--verify-db-name=")) args.verifyDbName = raw.slice("--verify-db-name=".length);
  }
  return args;
}

function fail(message) {
  console.error(`\n[verify-migration-chain] FAILED: ${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (!args.verifyDbName || args.verifyDbName.trim().length === 0) {
  fail(
    "Missing required --verify-db-name=<name>. This must be an explicit, disposable database name — there is no default, on purpose, so this script can never accidentally target your real development database.",
  );
}
const verifyDbName = args.verifyDbName.trim();

const rawDatabaseUrl = process.env.DATABASE_URL;
if (!rawDatabaseUrl) fail("DATABASE_URL is not set — nothing to derive the verification server connection from.");

let sourceUrl;
try {
  sourceUrl = new URL(rawDatabaseUrl);
} catch {
  fail("DATABASE_URL is not a valid URL — refusing to guess a target.");
}

const sourceDbName = sourceUrl.pathname.replace(/^\//, "");
if (!sourceDbName) fail("Could not determine the database name from DATABASE_URL's own path.");

if (verifyDbName.toLowerCase() === sourceDbName.toLowerCase()) {
  fail(
    `--verify-db-name (${verifyDbName}) is the SAME as the database in your own DATABASE_URL (${sourceDbName}). ` +
      "Refusing to proceed — this script must never run migrate deploy / drop / create against your real development database.",
  );
}
// A conservative name-shape guard, in addition to the exact-match check
// above — a verification database name should read as obviously disposable.
if (!/verify|scratch|tmp|throwaway/i.test(verifyDbName)) {
  fail(
    `--verify-db-name (${verifyDbName}) doesn't look like a disposable/verification database name ` +
      '(expected it to contain "verify", "scratch", "tmp", or "throwaway"). ' +
      "This is a deliberate extra guard against a typo pointing at a real database — rename the target if this is genuinely intended for verification.",
  );
}

const adminUrl = new URL(sourceUrl.toString());
adminUrl.pathname = "/postgres"; // connect to the maintenance DB to run CREATE/DROP DATABASE
const verifyUrl = new URL(sourceUrl.toString());
verifyUrl.pathname = `/${verifyDbName}`;

console.log(`[verify-migration-chain] Source DATABASE_URL database: "${sourceDbName}" (never touched by this script)`);
console.log(`[verify-migration-chain] Verification database: "${verifyDbName}" (will be dropped + recreated on the same server)`);

async function withAdminClient(fn) {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function quoteIdent(name) {
  // Defense in depth: the name-shape guard above already restricts what
  // can reach here, but never interpolate raw user input into DDL without
  // also escaping embedded quotes.
  return `"${name.replace(/"/g, '""')}"`;
}

async function main() {
  console.log("\n[verify-migration-chain] Step 1/4 — drop + recreate the verification database from absolute zero");
  await withAdminClient(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(verifyDbName)} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${quoteIdent(verifyDbName)}`);
  });

  console.log("\n[verify-migration-chain] Step 2/4 — prisma migrate deploy (production-style path, not migrate dev / db push)");
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: verifyUrl.toString() },
      stdio: "inherit",
    });
  } catch {
    fail("prisma migrate deploy did not complete successfully against the verification database — see output above for the first failing migration.");
  }

  console.log("\n[verify-migration-chain] Step 3/4 — diff the replayed database against schema.prisma (expect: empty diff)");
  let diffOutput = "";
  try {
    diffOutput = execFileSync("npx", ["prisma", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script"], {
      env: { ...process.env, DATABASE_URL: verifyUrl.toString() },
      encoding: "utf8",
    });
  } catch (error) {
    fail(`prisma migrate diff failed to run: ${error.message}`);
  }
  const isEmptyDiff = diffOutput.includes("-- This is an empty migration.");
  console.log(diffOutput.trim());
  if (!isEmptyDiff) {
    fail("The replayed database does NOT match schema.prisma — the migration chain is not currently reproducible. Do not treat this as a clean bill of health.");
  }

  if (!args.keep) {
    console.log("\n[verify-migration-chain] Step 4/4 — dropping the disposable verification database");
    await withAdminClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(verifyDbName)} WITH (FORCE)`);
    });
  } else {
    console.log(`\n[verify-migration-chain] Step 4/4 — skipped (--keep passed): "${verifyDbName}" left in place for manual inspection.`);
  }

  console.log("\n[verify-migration-chain] PASSED — the full migration chain reproduces schema.prisma exactly from an empty database.\n");
}

main().catch((error) => fail(error.stack ?? String(error)));
