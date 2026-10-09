# Deployment databases, sessions and storage — Production vs Preview

## Current state (inspected 2026-10-09, read-only)

Vercel project `traditorium/trading-hub`; production domain traditorium.com.
Values were never decrypted.

| Variable | Scope | Meaning |
|---|---|---|
| `DATABASE_URL` | **one** variable for Production, Preview **and** Development | Every Preview reads and writes the **production** Neon database |
| `DIRECT_URL` | Production only | Used only by the build-time migration gate |
| `AUTH_SECRET` | **one** variable for all three environments | Preview and Production can decrypt each other's session cookies |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | separate entry per environment | Whether the values differ (separate bucket and token) is **not known** without reading them |

Other facts:
- There is no Vercel Marketplace integration; Neon was added by hand.
- Previews are protected by Vercel Authentication (`all_except_custom_domains`).
- Local `.env` / `.env.test` use `localhost`; `.env.local` holds only
  `VERCEL_OIDC_TOKEN`.
- Team-level (shared) environment variables were not inspected.

### How Production migrations work
- `npm run build` = `node scripts/vercel-migrate.mjs && next build`, with no
  `vercel.json`. If the migration step fails, `next build` never runs and the
  deployment fails, so the previous Production keeps serving.
- In Production the gate:
  - uses `DIRECT_URL`;
  - throws if it is missing;
  - throws if its host contains `-pooler`. This is Neon's PgBouncer host;
    Prisma's session-level advisory lock is unsafe through transaction
    pooling (P1002 incident, `8fce274`).
- It then runs `prisma migrate deploy` with `DATABASE_URL` overridden to that
  direct URL.
- Runtime traffic is separate: the app uses `DATABASE_URL` (pooled) through
  `@prisma/adapter-pg`. `prisma.config.ts` reads `DATABASE_URL` only for
  CLI commands.
- **A migration lands only when a Production build actually runs.** Merging
  is not enough; check the Production build log or `prisma migrate status`.
- Previously Preview, Development and other Vercel environments skipped
  migrations. Local builds (no `VERCEL_ENV`) migrate `DATABASE_URL`.

### Variable precedence (Vercel docs)
- *"Any branch-specific variables will override other preview environment
  variables with the same name."*
- *"Changes … only apply to new deployments."* Existing deployments must be
  redeployed.
- The docs do **not** describe two all-branch Preview variables with the same
  name. **Do not add a second `DATABASE_URL`/`AUTH_SECRET` for Preview while
  the shared one still includes Preview.** Untick Preview on the shared
  variable first, or use a branch-specific override.
- This is why the Preview migration URL has its own name, `PREVIEW_DIRECT_URL`.
  No scoping mistake with `DIRECT_URL` can ever hand Production's direct URL
  to a Preview migration.

## The migration gate (`scripts/lib/migrate-plan.mjs`, unit-tested)

| Build | Behaviour |
|---|---|
| Production | **Unchanged**: `DIRECT_URL`, the same missing/`-pooler` checks and the same messages |
| Preview, no `PREVIEW_DIRECT_URL` | Skip (today's behaviour) and log which variables enable it |
| Preview, `PREVIEW_DIRECT_URL` set | Migrate it only if all checks below pass |
| Preview, `PRODUCTION_DB_ENDPOINT` set and runtime `DATABASE_URL` is that endpoint | **Fail** the build: Preview would run against production |
| Development / custom environments | Skip (unchanged) |
| Local (no `VERCEL_ENV`) | Migrate `DATABASE_URL` (unchanged) |

Before a Preview migration, all of these must hold. Any failure fails the
build with the reason:
- `PRODUCTION_DB_ENDPOINT` is set and looks like `ep-…`;
- `PREVIEW_DIRECT_URL` is a valid URL and not a `-pooler` host;
- its endpoint is **not** the production endpoint;
- the Preview runtime `DATABASE_URL` is the **same** endpoint (pooled and
  direct connections of one branch).

`DATABASE_URL` and `DIRECT_URL` are never Preview migration targets.

A shared Preview branch tolerates migrations from abandoned PRs:
`prisma migrate deploy` does not fail on applied migrations it doesn't have
locally (verified on a throwaway database).

## Sessions — `AUTH_SECRET`
- Auth.js v5 with `session: { strategy: "jwt" }` (`src/server/auth.ts`). The
  session cookie is encrypted with `AUTH_SECRET` and carries the user id.
- With a shared secret, a token issued by a Preview decrypts on Production.
  A branch copied from production has the same user ids, so a token minted
  on Preview is a valid Production session.
- Browsers won't send the cookie across domains, but a copied token can be
  replayed.
- **Fix:** untick Preview on the shared `AUTH_SECRET` and add a
  Preview-only value (`openssl rand -base64 32`). No code change is needed;
  Auth.js reads `AUTH_SECRET` from the environment.
- Changing it signs out every Preview user once.

## Storage — R2 (must be isolated before, or with, the database)

Code paths, from the R2 client in `src/lib/r2.ts`:
- **Deletes by key read from database rows:**
  - media deletion (`media.service`, `api/media/upload`, `api/v1/media`);
  - **Data Management full reset** (`data-management.service.ts:47`, which
    deletes every `storageKey` of the user's media);
  - MT5 import deletion (`deleteImportChunks`);
  - historical import cleanup (`deleteImportObject`);
  - the Twelve Data cache purge (`purgeAllTwelveDataCache`).
- **Deterministic keys, which Preview can overwrite:**
  - market-data caches (`market-data/databento/…`, Twelve Data `…/1m/<date>.json`);
  - MT5 chunks of an existing import (`market-data-imports/<user>/<import>/…`).
- **Random keys, never overwritten:** new media uploads (`<userId>/<uuid>`).

Risk:
- **Today:** Preview and Production share the database, so the rows and files
  stay consistent with each other.
- **After isolating only the database with a data copy:** a Preview row still
  points at a production object. Deleting media or running a data reset on
  Preview would **delete production files that production still references**.
- **Rule:** give Preview its own bucket **and** an R2 API token limited to
  that bucket before Preview gets a copied database. A schema-only branch also
  avoids copied `storageKey`s.
- **Side effect:** with a separate bucket, media copied from production shows
  as missing in Preview.

## Manual setup — in this order

Never paste connection strings or keys into chat, code or committed files.
Enter them in the Vercel dashboard or at the `vercel env add` prompt (which
doesn't echo values).

**0. Land the code first.**
- Merge this change. With no new variables it behaves exactly as today.
- Then bring other open branches up to date with `master` (e.g. PR #21's
  branch), so their Previews get the gate.

**1. Isolate storage.**
- Cloudflare: create a bucket for Preview, e.g. `traditorium-preview`.
- Cloudflare: create an R2 API token with Object Read & Write on **that
  bucket only**.
- Vercel: edit the existing **Preview** entries of `R2_BUCKET`,
  `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` to the new values.
  `R2_ACCOUNT_ID` can stay.
- If a check shows the Preview entries already use a separate bucket and a
  token scoped to it, skip this step.

**2. Neon: create the Preview branch.**
- Create a branch named `preview` from the production branch.
  **Schema-only** is preferred if your plan offers it: no production user
  data and no copied file keys. Otherwise copy data at "head".
- Do **not** install the Neon Vercel integration for this option.
- Note two endpoint ids (the `ep-…` first host label; not secrets): the
  **production** compute endpoint and the **preview** branch endpoint.
- If the branch is schema-only, plan a test login for Preview, since there
  are no users.

**3. Rehearse on one test Git branch** (a branch-specific override touches
no other Preview). In Vercel, add **branch-specific** Preview variables for a
new branch, e.g. `preview-db-rehearsal`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | preview branch **pooled** URL |
| `PREVIEW_DIRECT_URL` | preview branch **direct** URL |
| `AUTH_SECRET` | a new random value |
| `PRODUCTION_DB_ENDPOINT` | the production `ep-…` id (type Config is fine) |

- Push `preview-db-rehearsal` (based on the updated `master`).
- Its build log must show
  `[migrate] Preview: prisma migrate deploy → isolated branch ep-<preview id>`.
- Log in on that Preview, upload and delete a test image, and confirm it
  lands in the Preview bucket.
- Production is untouched throughout.

**4. Cut over all Previews, in one sitting, while nobody pushes.**
1. Shared `DATABASE_URL`: untick **Preview**. Also untick **Development**, so
   `vercel env pull` can never write the production URL to a local file.
2. Immediately add `DATABASE_URL` for Preview, all branches: the preview
   branch pooled URL.
3. Shared `AUTH_SECRET`: untick **Preview**; add `AUTH_SECRET` for Preview,
   all branches: a new value.
4. Add `PREVIEW_DIRECT_URL` for Preview, all branches: the preview branch
   direct URL.
5. **Last**, add `PRODUCTION_DB_ENDPOINT` for Preview, all branches: the
   production id. From now on, any Preview that points at production fails
   its build instead of running.
6. Remove the rehearsal branch-specific variables.

Between steps 1 and 2, a Preview build that starts has **no** database: it
fails or errors, but cannot reach production. Doing step 5 last means
partial configuration never blocks Previews prematurely.

**5. Redeploy and verify.**
- Redeploy the Previews you need; old Preview deployments keep their old
  variables.
- Check the build log line, login and a media upload.
- The next Production build log is unchanged: no Preview line, and the usual
  `prisma migrate deploy` output.

**6. Upkeep.**
- After an abandoned PR's migration, or whenever Preview data drifts: Neon →
  `preview` → *Reset from parent*.

## Remaining risks
- **Production data in Preview:** a full-copy branch holds production
  personal data, reachable by team members through protected Previews. Any
  custom domain assigned to a Preview bypasses Vercel Authentication.
- **Rows copied by a data branch:** API tokens, prop-firm accounts, etc. are
  valid in Preview against the Preview database.
- **R2:** until step 1, Preview may share production storage. Market-data
  caches can be overwritten by a Preview with buggy cache code.
- **Not checked:** team-level environment variables and custom-domain
  assignments.
- **Neon naming assumption:** the gate relies on Neon host naming (`ep-…`
  first label, `-pooler` for pooled hosts).
