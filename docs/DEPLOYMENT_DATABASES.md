# Deployment databases, sessions and storage — Production vs Preview

## Current state (inspected 2026-10-09, read-only)

Vercel project `traditorium/trading-hub`; production domain traditorium.com.
Values were never decrypted.

| Variable | Scope | Meaning |
|---|---|---|
| `DATABASE_URL` | **one** variable for Production, Preview **and** Development | Every Preview reads and writes the **production** Neon database |
| `DIRECT_URL` | Production only | Used only by the build-time migration gate |
| `AUTH_SECRET` | **one** variable for all three | Preview and Production can decrypt each other's session cookies |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | separate entry per environment | Whether the Preview values are a separate bucket and token is **not known** without reading them |

Other facts:
- The build command is the default `npm run build` (`node
  scripts/vercel-migrate.mjs && next build`), with no ignored-build-step.
- System environment variables are exposed (`autoExposeSystemEnvs: true`).
- There are 0 custom environments, 0 team-level shared variables and no
  Marketplace integration.
- Previews are protected by Vercel Authentication (`all_except_custom_domains`).
- Local `.env` / `.env.test` database URLs use `localhost`. Local `.env` also
  contains R2 credentials; check which bucket they point at.

### How Production migrations work (unchanged by this change)
- In Production the gate:
  - uses `DIRECT_URL`;
  - throws if it is missing;
  - throws if its host contains `-pooler` (Neon's PgBouncer: Prisma's
    advisory lock is unsafe through transaction pooling; incident `8fce274`).
- It then runs `prisma migrate deploy` with `DATABASE_URL` overridden to that
  URL. A failure stops `next build`, so the previous Production keeps serving.
- Runtime traffic uses `DATABASE_URL` (pooled) via `@prisma/adapter-pg`.
- **A migration lands only when a Production build actually runs.** Check the
  build log or `prisma migrate status`.

### Vercel variable precedence (docs)
- Branch-specific Preview variables override general Preview variables with
  the same name.
- Changes apply only to new deployments.
- Two all-branch Preview variables with the same name are not documented.
  **Untick Preview on the shared variable before adding a Preview-only one.**
- `VERCEL_ENV` is only `production`, `preview` or `development`. Custom
  environments run with `VERCEL_ENV=preview` and their name in
  `VERCEL_TARGET_ENV`.

## The migration gate (`scripts/lib/migrate-plan.mjs`, unit-tested)

| Build | Behaviour |
|---|---|
| Production | **Unchanged**: `DIRECT_URL`, the same missing/`-pooler` checks and messages |
| Preview, no `PREVIEW_DIRECT_URL` | Skip (today's behaviour); logs what enables it |
| Preview, `PRODUCTION_DB_ENDPOINT` set and runtime `DATABASE_URL` is that endpoint | **Fail**: Preview would run against production |
| Preview, `PREVIEW_DIRECT_URL` set | Migrate only if **both** layers below pass |
| Custom environment (`VERCEL_TARGET_ENV` ≠ `preview`) | Skip |
| Development | Skip (unchanged) |
| Local (no `VERCEL_ENV`) | Migrate `DATABASE_URL` (unchanged) |

**Layer 1 — configuration.**
- `PRODUCTION_DB_ENDPOINT` must be set and look like `ep-…`.
- Both `PREVIEW_DIRECT_URL` and the Preview `DATABASE_URL` must be Neon
  `ep-…` endpoint hosts. Generic and non-Neon hosts are rejected.
- `PREVIEW_DIRECT_URL` must not be a `-pooler` host.
- Both URLs must be the **same** endpoint, and it must differ from
  `PRODUCTION_DB_ENDPOINT`.
- `DATABASE_URL` and `DIRECT_URL` are never Preview migration targets.

**Layer 2 — database marker.**
- Right before migrating, the build connects to the exact database it is
  about to migrate (`PREVIEW_DIRECT_URL`).
- It requires `public._traditorium_environment` to contain exactly one row
  `role = 'preview'`.
- That row exists only on the Neon preview branch. A missing table or row, a
  wrong value, duplicates or a connection error all refuse.

Layer 1 relies on correctly entered values. A swapped or mistyped
`PRODUCTION_DB_ENDPOINT` combined with a production `PREVIEW_DIRECT_URL`
passes layer 1, and layer 2 is what stops it (regression-tested). The
protection is therefore only as strong as the rule **"the marker exists only
on the Preview branch"**. Never create it in production, and never create a
branch from a database that has it.

Other notes:
- `prisma migrate deploy` ignores the extra marker table.
- It also tolerates migrations from abandoned PRs that are applied on the
  branch but missing locally (verified on a throwaway database).

## Sessions — `AUTH_SECRET`
- Auth.js v5 uses JWT sessions encrypted with `AUTH_SECRET`
  (`src/server/auth.ts`), and the token carries the user id.
- While Preview and Production share the secret, and a data branch shares
  the user ids, a token from a Preview is a valid Production session.
- **Fix:** give Preview its own `AUTH_SECRET`. No code change is needed.
  Changing it signs Preview users out once.

## Storage — R2
- **One client, no fallback:** all app storage goes through `getR2()`
  (`src/lib/r2.ts`). It throws if any `R2_*` variable is missing, and there
  is no fallback or hard-coded bucket.
- **Safe defaults:** uploads and both market-data caches disable themselves
  when R2 isn't configured. The cache flags (`DATABENTO_R2_CACHE_ENABLED`,
  `TWELVE_DATA_R2_CACHE_ENABLED`) are not set in Vercel.
- **Exception:** the manual script
  `scripts/purge-twelvedata-market-data-cache.mjs` builds its own client from
  whatever `R2_*` is in the shell or `.env`.
- **Deletes act on keys stored in database rows:**
  - media deletion;
  - the Data Management reset (`data-management.service.ts`);
  - MT5 and historical import cleanup.
- **Two invariants the setup must keep:**
  1. **Database copied from production + production bucket** → a Preview
     delete removes production files that production still references.
  2. **Production database + Preview bucket** → a Preview upload creates
     production rows that point at objects only in the Preview bucket, which
     show as broken images in production.

  So a Preview's database and bucket must always switch **together**: R2
  first, database immediately after, in one sitting. The rehearsal does the
  same with variables scoped to its own branch.

## Manual setup — in this order

Never paste connection strings or keys into chat, code or committed files.
Use the Vercel dashboard or the `vercel env add` prompt.

**0. Land the code.**
- Merge this change. Without new variables it behaves exactly as today.
- Update other open branches from `master` later (step 5).

**1. Prepare, without changing any deployment.**
- Cloudflare R2: create a **Preview bucket** and an API token with Object
  Read & Write on **that bucket only**.
- Neon: create branch `preview` from production. **Schema-only** is preferred
  if your plan offers it (no user data, no copied file keys); otherwise copy
  data at "head".
- Neon SQL editor, **on the `preview` branch only**, create the marker:
  ```sql
  CREATE TABLE public."_traditorium_environment" (key text PRIMARY KEY, value text NOT NULL);
  INSERT INTO public."_traditorium_environment" (key, value) VALUES ('role', 'preview');
  ```
  Then confirm the production branch has **no** such table.
- Note the production and preview endpoint ids (the `ep-…` first host label).
- Confirm production is at `master`'s migration head (latest Production
  build log, or `prisma migrate status` against production). The branch
  starts from that state.

**2. Rehearse on one test Git branch.** Branch-specific variables override
only that branch; no other Preview changes. For a new branch, e.g.
`preview-db-rehearsal`, add these **branch-specific** Preview variables:

| Variable | Value |
|---|---|
| `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | the Preview bucket and its token (add these **first**) |
| `DATABASE_URL` | preview branch **pooled** URL |
| `PREVIEW_DIRECT_URL` | preview branch **direct** URL |
| `AUTH_SECRET` | a new random value (`openssl rand -base64 32`) |
| `PRODUCTION_DB_ENDPOINT` | the production `ep-…` id |

- Push `preview-db-rehearsal`, based on the updated `master`.
- The build log must show `[migrate] Preview: marker verified; prisma migrate
  deploy → isolated branch ep-<preview id>`.
- Log in, upload a test image (it must land in the Preview bucket) and delete
  it.
- Production rows, files and caches are not touched: this branch's database,
  bucket and secret are all its own.

**3. Cut over all Previews, in one maintenance window, while nobody pushes.**
Storage first, database immediately after, so no Preview ever pairs a
production database with the Preview bucket, or a copied database with the
production bucket:
1. Set the all-branches **Preview** values of `R2_BUCKET`, `R2_ACCESS_KEY_ID`
   and `R2_SECRET_ACCESS_KEY` to the Preview bucket and its token.
2. Shared `DATABASE_URL`: untick **Preview** (and **Development**, so
   `vercel env pull` never writes the production URL locally). Immediately
   add a Preview `DATABASE_URL` set to the branch pooled URL.
3. Shared `AUTH_SECRET`: untick **Preview**; add a Preview `AUTH_SECRET`
   with a new value.
4. Add a Preview `PREVIEW_DIRECT_URL`: the branch direct URL.
5. **Last**, add a Preview `PRODUCTION_DB_ENDPOINT`: the production id. From
   then on, a Preview pointing at production fails its build.
6. Remove the rehearsal branch-specific variables.

Existing Preview deployments keep their old variables until redeployed (a
Preview built during the window with R2 switched but the database not yet
switched would mix them). Run steps 1–2 back to back, and redeploy
afterwards rather than relying on any Preview built during the window.

**4. Redeploy and verify.**
- Redeploy the Previews you need. Check the build log line, login and
  upload.
- The next Production build log is unchanged.

**5. Open branches** (e.g. PR #21).
- Merge `master` into the branch, push, and check its Preview migrated the
  isolated branch before considering a merge to production.

**6. Upkeep.**
- Neon *Reset from parent* removes the marker (it doesn't exist on
  production), so Preview builds then refuse until you recreate it with the
  SQL in step 1.

## Remaining risks
- **The marker is the deciding safeguard.** It must exist only on the Preview
  branch.
- **Production data in Preview:** a full-copy branch holds production
  personal data, reachable by team members through protected Previews. A
  custom domain assigned to a Preview bypasses Vercel Authentication.
- **Rows copied by a data branch:** API tokens etc. work in Preview against
  the Preview database.
- **Local R2:** local runs use whatever bucket `.env` points at, including the
  manual purge script.
- **Pre-existing:** if system environment variables were ever disabled,
  `VERCEL_ENV` would be absent and the build would take the local path
  (`DATABASE_URL`).
