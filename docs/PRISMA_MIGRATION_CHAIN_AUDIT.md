# Prisma Migration Chain Integrity Audit (Stage 20.2)

Triggered by Stage 20.1: `prisma migrate dev` refused to apply the new
`AiReviewAnalystReport.coverageSummaryJson` migration against the real
development database, reporting that `20260912221500_replay_execution_engine`
"was modified after it was applied" and asking to reset the schema. The
reset was correctly refused (the dev database holds thousands of real
records) and the migration was instead applied manually and marked
resolved. This document is the follow-up audit that determines whether
that was a symptom of a genuinely broken migration chain, or something
narrower — and fixes the narrower thing safely.

**Bottom line: the migration chain itself was never broken.** The drift
warning was caused entirely by two stale, already-superseded rows left
behind in the development database's own `_prisma_migrations` bookkeeping
table — not by any actual difference between the committed migration files
and the schema they produce.

---

## 1. Database environments

- **Local development**: a single Docker Postgres container
  (`trading-hub-postgres-1`, `postgres:17-alpine`, `docker-compose.yml`),
  database `trading_hub`, credentials from `.env`'s `DATABASE_URL`. This is
  the **only** database this project talks to locally — there is no
  separate test database; `vitest.setup.ts` loads the same `.env` via
  `dotenv/config`, so the Vitest suite runs against this exact same
  database. This explains why it accumulates thousands of leftover rows
  over time (test fixtures from many prior runs), and why the "existing
  dev DB has thousands of records" constraint is real and must be
  respected.
- **CI**: no CI configuration exists in the repository (no
  `.github/workflows`, no other CI config found) — there is currently no
  automated pipeline that runs migrations or tests against a database.
- **Production/deployment**: no `vercel.json` or committed deploy script
  exists in the repository, and `package.json` has no `migrate deploy`
  step wired into `build`/`postinstall` (`postinstall` only runs
  `prisma generate`, which needs no database connection). Production's
  database connection details live outside this repository (platform
  environment variables) and were **not inspected or connected to** —
  there is no existing, already-safe read-only mechanism in this project's
  workflow for doing so, and the task's own safety rules require one
  before touching production in any way. See §13 for what can and can't be
  concluded about production without that access.

No credentials are reproduced anywhere in this document or in any file
this stage created.

## 2. Migration history audit

- **74** migration directories in `prisma/migrations/` (verified via
  `ls`), matching **74 distinct** `migration_name` values in the
  development database's `_prisma_migrations` table — no migration is
  missing on either side, and no migration exists on one side but not the
  other.
- However, the development database's `_prisma_migrations` table had **76
  total rows**, not 74: `20260912221500_replay_execution_engine` had
  **three** rows instead of one.

```
migration_name                            started_at             rolled_back_at         applied_steps_count  checksum
20260912221500_replay_execution_engine    2026-09-12 19:11:17    2026-09-12 19:11:52    0                    cfa26a0c...
20260912221500_replay_execution_engine    2026-09-12 19:13:00    2026-09-12 19:13:51    0                    8639ad66...
20260912221500_replay_execution_engine    2026-09-12 19:14:06    (null — succeeded)     1                    8639ad66...
```

The on-disk `prisma/migrations/20260912221500_replay_execution_engine/migration.sql` file's SHA-256 checksum is `8639ad66...` — **exactly matching the checksum of the successful (third) row**, not the two failed ones. The file on disk is, and was, the correct/final version.

## 3. Exact drift discovered

**None, in the actual schema.** Confirmed by direct reproduction (§7-9
below): a byte-for-byte structural `pg_dump --schema-only` comparison
between the real development database and a database built from scratch
by replaying every one of the 74 committed migrations in order shows
**zero real differences** — the only diff line is a `COMMENT ON SCHEMA
public IS 'standard public schema';` statement, which is a Postgres
database-creation artifact (whether the `public` schema happens to carry
its default comment), unrelated to Prisma, unrelated to any migration, and
with no effect on the application.

The "drift" `prisma migrate dev` detected was in **migration bookkeeping
metadata**, not schema: the two stale rolled-back rows for
`20260912221500_replay_execution_engine`.

## 4. Confirmed cause vs. likely explanation

**Confirmed** (directly reproduced — see §7 below): a database whose
schema is byte-identical to the correct one, but whose
`_prisma_migrations` table has these same two stale rolled-back rows
sitting alongside the successful one for the same migration name,
produces the **exact same** "was modified after it was applied" /
reset-request message from `prisma migrate dev`. Removing exactly those
two rows makes `prisma migrate dev` report "Already in sync" with zero
other changes. This is not a theory — it was reproduced and then undone
twice against a disposable database created solely for this test.

**Confirmed, from the stored failure logs in `_prisma_migrations.logs`**
(a real, historical two-step authoring problem in this one migration,
already resolved by the time it succeeded):

1. **First attempt** (checksum `cfa26a0c...`, the migration file's
   original content) failed with Postgres error `23502`: `column
   "realizedReplayR" of relation "ReplayTrade" contains null values`. The
   original file tried to make `ReplayTrade.realizedReplayR` `NOT NULL`
   without first backfilling existing `NULL` rows.
2. The file was then edited to add the backfill statement that is on line
   32 of the file today (`UPDATE "ReplayTrade" SET "realizedReplayR" = 0
   WHERE "realizedReplayR" IS NULL;`), changing its checksum to
   `8639ad66...`.
3. **Second attempt**, using the corrected file, failed with a
   *different* error — Postgres `42710`: `type "ReplayTradeLifecycle"
   already exists`. This means that enum type, created earlier in the
   same script by the first attempt, was still physically present in the
   database at the time of the second attempt.
4. **Third attempt**, using the identical (already-corrected) file
   moments later, succeeded completely.

**Likely, not proven** (the mechanism behind step 3 specifically):
Postgres DDL is transactional, so a cleanly rolled-back failed migration
should not leave a `CREATE TYPE` behind for a later attempt to collide
with. The migration file itself contains no non-transactional statement
(no `CONCURRENTLY`, confirmed by inspection) that would explain a partial
commit. The most plausible explanation is that the `ReplayTradeLifecycle`
type was removed manually (e.g. a `DROP TYPE` run directly, outside
Prisma) in the ~15 seconds between the second attempt's rollback
(`19:13:51`) and the third attempt's start (`19:14:06`), which is
consistent with someone iterating on this migration by hand at the time.
This part is recorded as **likely**, not confirmed — there is no
statement-level database log available to prove it conclusively, and it
has zero bearing on the current, already-verified correctness of the
schema.

**No historical migration FILE was found to have changed** other than
this one intentional, in-progress edit during its own original authoring
(Stage 12-16 development, well before Stage 20.1) — confirmed by `git
log`/`git diff` showing zero uncommitted or unexpected changes to any
migration file, and by the checksum match in §2 above.

## 5. Disposable verification database

A separate Postgres database, `traditorium_migration_verify`, was created
on the **same** local Postgres server as `trading_hub` (same container,
different database name) — explicitly confirmed different from the
`DATABASE_URL` database name before every command that touched it, per
this stage's absolute safety rule. It was dropped and recreated multiple
times over the course of this audit and does not exist after this stage
finished (final state confirmed: only `postgres` and `trading_hub` remain
on the server). It was **never** used to test anything against the real
`trading_hub` database, and no command in this audit ran `migrate reset`,
`db push`, or any destructive operation against `trading_hub`.

## 6. Zero-to-current migration replay result

`prisma migrate deploy` (the production-style path — never `migrate dev`,
never `db push`) against the empty `traditorium_migration_verify`
database applied **all 74 migrations successfully**, in order, with no
failures — including both `20260912221500_replay_execution_engine` and
Stage 20.1's `20260915105117_ai_analyst_coverage_summary`. Output ended
with: `All migrations have been successfully applied.` The resulting
`_prisma_migrations` table had exactly 74 rows, all finished, zero rolled
back, and the checksum recorded for `replay_execution_engine` matched the
on-disk file and the development database's own successful-row checksum
exactly.

This was run **twice** — once during initial investigation, and once more
against a freshly dropped-and-recreated instance of the verification
database as the final, untainted proof (per this stage's own requirement
not to treat an incrementally-patched debugging database as valid proof).
Both runs produced identical results.

## 7. Clean database vs. `schema.prisma`

`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`,
pointed at the freshly-replayed verification database, returned:

```
-- This is an empty migration.
```

i.e. **zero difference** between the database produced by replaying every
migration and the current `schema.prisma`.

## 8. Clean database vs. development database

`pg_dump --schema-only --no-owner --no-privileges` from both databases,
diffed directly:

- **Real drift: none.**
- **Expected/environmental only:** a `\restrict`/`\unrestrict` line (a
  `pg_dump` 17 per-invocation lock token, different every time you run
  `pg_dump`, never a schema property) and the `COMMENT ON SCHEMA public`
  line noted in §3 (a database-creation-time artifact, not a Prisma-managed
  object).

No table, column, type, default, index, unique constraint, or foreign key
differs between the two databases.

## 9. Repair strategy chosen

**The migration chain required no repair** — §6-8 prove it is already
fully reproducible from zero and already matches `schema.prisma` exactly.
No new migration was created for this stage, and no historical migration
file was rewritten.

**One narrow, validated repair remains available but was not applied to
the real development database in this session** (see §14 for why, and the
exact statement for you to run):

Delete exactly the two stale rolled-back rows for
`20260912221500_replay_execution_engine` from the **development**
database's `_prisma_migrations` table (identified by their exact `id`s;
a CSV backup of both full rows — content and stored error logs — was
saved to `prisma/backups/stale_migration_rows_backup_20260915.csv` before
any deletion was attempted). This was designed as the **smallest possible
forward-only-compatible fix**: it does not touch `schema.prisma`, does not
create a new migration, does not modify any user data table, and only
removes rows that Prisma itself already marked `rolled_back_at` (i.e.
already-inert bookkeeping). It was **proven safe and effective first** on
the disposable verification database (§10) before being attempted on the
real one.

## 10. Validation of the repair (on the disposable database only)

1. Two synthetic rows reproducing the exact same shape (same migration
   name, same two historical checksums, `rolled_back_at` set,
   `applied_steps_count = 0`) were inserted into the verification
   database's `_prisma_migrations` table.
2. `prisma migrate dev --create-only` against that database reproduced
   the **exact same** "was modified after it was applied" / reset-request
   message — confirming the cause.
3. The two synthetic rows were deleted by exact `id`.
4. `prisma migrate status` and a full `prisma migrate dev` both then
   reported the database as clean / "Already in sync" — confirming the
   fix, with zero other side effects (schema unchanged throughout).

## 11. Existing development database — current state

**Unchanged and safe.** `User` and `Trade` row counts were checked before
and after every operation that touched `trading_hub` in this session (all
read-only inspection queries); nothing was inserted, updated, or deleted
in any application table. The two stale `_prisma_migrations` rows
identified in §2 **still exist** in the real development database as of
the end of this stage — see §14.

`prisma migrate status` against the real development database currently
reports "up to date" (this was already true before this stage, from Stage
20.1's manual resolve) — but a future `prisma migrate dev` invocation
against it **will still hit the same reset-request warning** until those
two rows are removed, because `migrate status` and `migrate dev` perform
different checks (status doesn't reproduce the drift check; dev does).

## 12. Stage 20.1 migration (`coverageSummaryJson`) — verified

- SQL is correct: `ALTER TABLE "AiReviewAnalystReport" ADD COLUMN "coverageSummaryJson" JSONB;` — a single, additive, nullable column.
- The file is tracked in git (`prisma/migrations/20260915105117_ai_analyst_coverage_summary/migration.sql`).
- In development, it is recorded as applied (via the earlier manual `migrate resolve --applied`) with the correct checksum.
- Against the completely fresh verification database, it applied **normally, via ordinary `prisma migrate deploy`** — no manual SQL, no manual resolve step required. This is the key confirmation: a brand-new install (or a production database receiving this migration for the first time) needs **no special handling** — the manual steps taken in Stage 20.1 were purely a workaround for the pre-existing dev-database-local bookkeeping issue, not something the migration itself requires going forward.
- `schema.prisma` matches (§7).

## 13. Production compatibility assessment

Not connected to, per the safety rules (no existing safe read-only
mechanism for it is wired into this repository/workflow). What can be
concluded without that access:

- The migration chain (all 74 files, unmodified) is proven reproducible
  from empty via the standard `prisma migrate deploy` path (§6-7) — a
  production database that is empty, or that is at any valid prior point
  in this exact history, can adopt the rest of the chain through the
  normal, unmodified workflow.
- The specific bookkeeping issue found here (§2-4) is a **local artifact
  of a debugging session on this developer's machine** (a migration that
  failed twice while being authored, then succeeded) — there is no reason
  to expect production ever went through the same failed-then-fixed
  sequence, since the migration file was already in its final, correct
  form by the time it would ever have reached a deploy pipeline. If it
  somehow did, the exact same symptom (a stale rolled-back row) and the
  exact same, now-documented diagnosis and fix would apply.
- No automated `prisma migrate deploy` step exists in this repository's
  build/deploy configuration today (`package.json`'s `build` script is
  plain `next build`; `postinstall` only runs `prisma generate`). This
  means migrations are presumably applied to production out-of-band
  (manually, or via a step configured directly in the hosting platform
  rather than in this repo) — worth confirming with whoever manages
  deployment, but this is a pre-existing operational fact, not something
  Stage 20.2 introduced or is positioned to change.

## 14. Future standard workflow status

**Almost fully restored, with one explicit, pending action.** Once the two
stale rows identified in §2 are removed from the real development
database's `_prisma_migrations` table, `prisma migrate dev` will work
normally there again for all future schema changes — no more manual SQL,
no more manual `migrate resolve`. Until then, that one command will
continue to report the same reset request on that machine specifically
(this does not affect `migrate deploy`, `migrate status`, or any other
database).

**This one action was intentionally not performed automatically in this
session** — the harness's own permission system blocked the write as a
"modify shared resources" action requiring your explicit approval, which
is the correct call for a direct write to a long-lived database with
thousands of real records, even though it was independently validated
first on a disposable copy. To apply it yourself, after confirming you're
comfortable doing so:

```sql
-- Deletes ONLY the two specific rows identified and backed up in this audit
-- (prisma/backups/stale_migration_rows_backup_20260915.csv). Does not touch
-- any application data table. Does not touch schema.prisma or any migration
-- file.
DELETE FROM "_prisma_migrations"
WHERE id IN ('aac7af08-e027-43fa-ab86-f294fa7bdd23', 'cd6b9466-438b-4d0a-9688-72c3f741526f');
```

Run via `docker exec trading-hub-postgres-1 psql -U trading_hub -d trading_hub -c "..."` or any Postgres client pointed at the dev database. A backup of the exact row content (including their full historical error logs) is at `prisma/backups/stale_migration_rows_backup_20260915.csv` if you ever want to inspect them again before/after.

## 15. FK teardown issue — diagnosis only (not fixed this stage)

`TradeAccountAllocation_tradingAccountId_fkey` failing during test
`afterAll(prisma.user.deleteMany(...))` cleanup, across ~14 test files:

- **Relationship causing it**: `TradeAccountAllocation` has two parent
  foreign keys — `trade` (`onDelete: Cascade`) and `tradingAccount`
  (**no `onDelete` specified**, so Postgres defaults to `NO ACTION`,
  which behaves like `RESTRICT`). `TradingAccount.user` and `Trade.user`
  both cascade from `User`.
- **Why cleanup order fails**: deleting a `User` triggers two independent
  cascade chains at once — `User → Trade → TradeAccountAllocation`
  (fully cascading) and `User → TradingAccount` (cascading only as far as
  `TradingAccount` itself, since `TradeAccountAllocation.tradingAccountId`
  has no cascade). If the `TradingAccount` deletion's `NO ACTION`
  constraint check is evaluated before the sibling `Trade` cascade has
  already removed the same `TradeAccountAllocation` row, Postgres sees a
  live reference to the `TradingAccount` being deleted and raises the FK
  violation. This is a classic "diamond" cascade shape: one child table
  reachable from the same deleted root via two parents, only one of which
  cascades.
- **Why it surfaces in ~14 unrelated-looking test files**: any test that
  creates a `Trade` with a realized result goes through
  `getOrCreatePerformanceAccount(userId)` (`trades.service.ts`,
  `performance-account.service.ts`), which silently provisions a
  `TradingAccount` ("Performance Account") and a linked
  `TradeAccountAllocation` row as an ordinary side effect of normal trade
  creation/update — not something the test file itself has to mention by
  name for the FK shape to apply.
- **Likely future repair** (not applied — a schema/product decision, not
  a pure database-safety fix, and explicitly out of scope for this
  stage): add `onDelete: Cascade` to
  `TradeAccountAllocation.tradingAccount` in `schema.prisma`, mirroring
  what `.trade` already does, via a normal additive migration
  (`DROP CONSTRAINT` + `ADD CONSTRAINT ... ON DELETE CASCADE`). This is a
  real behavior change (deleting a `TradingAccount` would then also delete
  its allocation/ledger rows) that deserves its own review rather than a
  drive-by fix inside a migration-audit stage.
- Confirmed this is **not** a migration-drift issue: the constraint's
  missing cascade is exactly what `schema.prisma` and every migration
  file already say, consistently, in development and in the verified
  clean replay alike.

## 16. Migration-chain verification procedure

`scripts/verify-migration-chain.mjs` (added this stage) automates exactly
the replay-and-diff procedure from §6-7 against an explicitly-named,
disposable database, with three independent safety guards (no default
target; hard refusal if the name matches your own `DATABASE_URL`
database; a name-shape check requiring something like "verify"/"scratch"/
"tmp"/"throwaway" in the name). It drops and recreates that database from
zero every run, so the result is never an incrementally-patched database.

```
node --experimental-strip-types scripts/verify-migration-chain.mjs --verify-db-name=traditorium_migration_verify
```

Not wired into any CI (none exists in this repository) or git hook —
it's a manual/on-demand command for a developer (or a future CI job, if
one is added) to run after adding a new migration, before trusting that
it will apply cleanly to a fresh environment.
