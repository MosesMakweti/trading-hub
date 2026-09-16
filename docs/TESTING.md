# Testing & the dedicated test database (Stage 20.3)

## Why a separate database

Before Stage 20.3, Vitest loaded the same `.env` as normal development, so
every test-created row landed in the same long-lived `trading_hub`
database used for interactive development. This let test fixtures
accumulate there indefinitely (thousands of rows), made destructive test
cleanup riskier than it needed to be, and masked a real bug (see
"The FK fix" below) behind what looked like "known, ignorable test
infrastructure flakiness."

**Vitest now always runs against `trading_hub_test`, never `trading_hub`.**

## First-time setup

```
cp .env.test.example .env.test
npm run test:db:setup
```

`test:db:setup` is idempotent — creates `trading_hub_test` only if it
doesn't already exist, then applies the full migration chain via
`prisma migrate deploy` (never `db push`). Safe to run repeatedly, and
safe to run again after pulling new migrations.

## Normal testing

```
npm test
```

No extra steps. `vitest.setup.ts` loads `.env.test` (overriding `.env`'s
`DATABASE_URL`) automatically whenever `NODE_ENV=test`, which Vitest sets
itself.

## Intentional full reset

```
npm run test:db:reset -- --confirm=RESET-TEST-DB
```

Drops and recreates `trading_hub_test` from absolute zero, then reapplies
every migration. Requires the exact `--confirm=RESET-TEST-DB` flag on the
command line — no accidental invocation can trigger it. Use this if the
test database ever ends up in a state you don't trust (it never should,
in normal use, since it holds no data you need to keep).

## The hard safety guard

File-based env loading alone is not trusted as the safety mechanism — a
missing `.env.test`, a stray shell-exported `DATABASE_URL`, or a future
refactor could all silently defeat it. Every test run additionally goes
through `assertTestDatabaseSafety()` (`src/server/testing/db-safety.ts`),
registered as a global `beforeAll` in `vitest.setup.ts`, which:

1. Parses the database name out of `DATABASE_URL` and requires it to be
   exactly `trading_hub_test` (an allowlist of one — not a blocklist of
   known-bad names, so any unrecognized or production-like name is
   rejected too).
2. Independently confirms the ACTUAL connected database via
   `SELECT current_database()`.

If either check fails, the test file fails immediately with a clear
message — no query is ever attempted against the wrong database. This
guard runs before every test file automatically; no test author has to
remember to call it.

The same exact-match guard (`scripts/lib/test-db.mjs`) protects
`test:db:setup` and `test:db:reset` — both refuse to run against anything
other than `trading_hub_test`, and `test:db:reset` additionally requires
the explicit `--confirm=` flag.

## Cleanup / isolation convention

The existing convention — a fresh, randomly-suffixed user created per test
(or per `describe` block) via a local `makeUser()`-style helper, tracked
in an array, deleted via `prisma.user.deleteMany({ where: { id: { in: ids } } })`
in `afterAll` — was already sound and is unchanged. `src/server/testing/cleanup.ts`
now offers this as a shared `createTestUser`/`deleteTestUsers` pair for
new tests to reach for, but existing test files were not mass-refactored
to use it (the objective was reliable cleanup, not stylistic uniformity).

Concurrency: Vitest parallelizes across test files by default. This is
safe here because every test-created user's email is uniquified with both
a timestamp and a random suffix, every application model is scoped to a
specific `userId`, and no test file performs an unscoped `deleteMany`
(audited — see `docs/PRISMA_MIGRATION_CHAIN_AUDIT.md`'s companion
Stage 20.3 notes). No serialization/parallelism changes were needed.

## The FK fix

`TradeAccountAllocation_tradingAccountId_fkey` test-teardown failures
(previously affecting 14 files) are resolved at the root: the schema now
matches what the application code always assumed —
`TradeAccountAllocation.tradingAccount` cascades on delete, exactly like
its sibling `.trade` relation. This was a real, reachable production
issue (not merely a test artifact) — `deleteDataSection("accounts", ...)`
in `data-management.service.ts` hard-deletes a user's non-Performance
`TradingAccount` rows without first deleting their trades, and its own
code comment already (incorrectly) assumed the allocation rows would
cascade away. See `prisma/migrations/20260915120948_trade_account_allocation_cascade_on_account_delete/`
and `docs/PRISMA_MIGRATION_CHAIN_AUDIT.md` for the full analysis.

## CI readiness

No CI pipeline exists in this repository yet. A future one needs only:

- An explicit, CI-provisioned `DATABASE_URL` (or `.env.test`) naming
  whatever database that CI environment considers its test database —
  `assertTestDatabaseSafety()` will enforce whatever name is configured,
  it does not hardcode a specific server/host, only the database name
  `trading_hub_test`. (If CI should use a different name, update
  `EXPECTED_TEST_DATABASE_NAME` in `src/server/testing/db-safety.ts` and
  `scripts/lib/test-db.mjs` together.)
- `prisma migrate deploy` run once against that database before `npm test`
  (exactly what `npm run test:db:setup` already does) — deterministic,
  from-zero, no dependency on a developer's long-lived local state.
- No other setup — the suite creates and cleans its own fixtures per run.
