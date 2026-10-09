// Build-time migration plan (pure; no I/O) — used by scripts/vercel-migrate.mjs.
//
// Production — UNCHANGED from the original gate: migrate over DIRECT_URL;
//   fail if it is missing or its host contains "-pooler" (Prisma's
//   session-level advisory lock is unsafe through Neon's PgBouncer pooler).
//
// Preview — may migrate ONLY a dedicated Neon branch. The migration URL comes
//   exclusively from PREVIEW_DIRECT_URL (DATABASE_URL / DIRECT_URL are never
//   Preview migration targets). Two independent layers:
//   1. Configuration checks (this file): both Preview URLs must be Neon `ep-…`
//      endpoint hosts, PREVIEW_DIRECT_URL must be direct (not -pooler), both
//      must be the SAME endpoint, and that endpoint must differ from
//      PRODUCTION_DB_ENDPOINT. A Preview whose runtime DATABASE_URL is
//      PRODUCTION_DB_ENDPOINT fails instead of running.
//   2. A database marker (checked by vercel-migrate.mjs right before
//      migrating, see PREVIEW_MARKER_*): the target database itself must
//      contain the marker row that is created only on the Neon preview
//      branch. Production never has it, so mistyped or swapped values in
//      layer 1 cannot authorize a Production migration.
//   Layer 1 depends on correctly entered values; layer 2 does not.
//
// VERCEL_ENV is only ever production | preview | development. Custom
//   environments run with VERCEL_ENV=preview and their name in
//   VERCEL_TARGET_ENV — they are skipped here (never configured for this).
// Development — skip, unchanged. Local builds (no VERCEL_ENV) — migrate
//   DATABASE_URL, unchanged.

export const ENDPOINT_ID = /^ep-[a-z0-9-]+$/;

/** The marker table + row that must exist ONLY on the Neon preview branch. */
export const PREVIEW_MARKER_TABLE = "_traditorium_environment";
export const PREVIEW_MARKER_SQL = `SELECT value FROM public."${PREVIEW_MARKER_TABLE}" WHERE key = 'role'`;
export const PREVIEW_MARKER_VALUE = "preview";

/** Neon endpoint id of a connection URL: the first host label without "-pooler". */
export function neonEndpoint(url) {
  return new URL(url).hostname.split(".")[0].replace(/-pooler$/, "");
}

/** The original production check, kept verbatim: any "-pooler" in the host. */
function isPooled(url) {
  return new URL(url).hostname.includes("-pooler");
}

function parses(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isNeonEndpointHost(url) {
  return parses(url) && ENDPOINT_ID.test(neonEndpoint(url));
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ action: "skip", reason: string }
 *   | { action: "migrate", url: string | undefined, label: "production" | "preview branch" | "local" }
 *   | { action: "fail", reason: string }}
 *   A "preview branch" migrate plan still requires the database marker check.
 */
export function planMigration(env) {
  const vercelEnv = env.VERCEL_ENV;

  // ── Production: identical to the original script ─────────────────────────
  if (vercelEnv === "production") {
    const url = env.DIRECT_URL;
    if (!url) return { action: "fail", reason: "DIRECT_URL is not set for Production." };
    if (isPooled(url)) return { action: "fail", reason: "DIRECT_URL is a pooled (-pooler) host; use Neon's direct connection." };
    return { action: "migrate", url, label: "production" };
  }

  // ── Preview (and custom environments, which also report "preview") ───────
  if (vercelEnv === "preview") {
    const target = env.VERCEL_TARGET_ENV?.trim();
    if (target && target !== "preview") {
      return { action: "skip", reason: `Custom environment "${target}": skipping prisma migrate deploy.` };
    }

    const prodEndpoint = env.PRODUCTION_DB_ENDPOINT?.trim() || null;
    const previewDirect = env.PREVIEW_DIRECT_URL?.trim() || null;
    const runtime = env.DATABASE_URL?.trim() || null;

    if (prodEndpoint && !ENDPOINT_ID.test(prodEndpoint)) {
      return { action: "fail", reason: "PRODUCTION_DB_ENDPOINT must be a Neon endpoint id like ep-name-123456 (the host label, not a URL)." };
    }
    if (prodEndpoint && runtime && parses(runtime) && neonEndpoint(runtime) === prodEndpoint) {
      return {
        action: "fail",
        reason: "Preview DATABASE_URL points at the PRODUCTION database (PRODUCTION_DB_ENDPOINT). Give Preview its own Neon branch before building.",
      };
    }
    if (!previewDirect) {
      return {
        action: "skip",
        reason: "No PREVIEW_DIRECT_URL (dedicated Preview branch) is configured — Preview never migrates without one. Set PREVIEW_DIRECT_URL and PRODUCTION_DB_ENDPOINT to migrate the Preview branch.",
      };
    }
    if (!prodEndpoint) {
      return { action: "fail", reason: "PREVIEW_DIRECT_URL is set but PRODUCTION_DB_ENDPOINT is not — it is required to rule out production." };
    }
    if (!isNeonEndpointHost(previewDirect)) {
      return { action: "fail", reason: "PREVIEW_DIRECT_URL must be a Neon endpoint host (ep-…); generic or non-Neon hosts can't be verified." };
    }
    if (isPooled(previewDirect)) {
      return { action: "fail", reason: "PREVIEW_DIRECT_URL is a pooled (-pooler) host; use the Preview branch's direct connection." };
    }
    if (neonEndpoint(previewDirect) === prodEndpoint) {
      return { action: "fail", reason: "PREVIEW_DIRECT_URL is the PRODUCTION endpoint — refusing to migrate production from a Preview build." };
    }
    if (!runtime || !isNeonEndpointHost(runtime)) {
      return { action: "fail", reason: "Preview DATABASE_URL must be set to a Neon endpoint host (ep-…) — Preview must run on the same branch it migrates." };
    }
    if (neonEndpoint(runtime) !== neonEndpoint(previewDirect)) {
      return { action: "fail", reason: "Preview DATABASE_URL and PREVIEW_DIRECT_URL point at different Neon endpoints — they must be the pooled and direct connections of one branch." };
    }
    return { action: "migrate", url: previewDirect, label: "preview branch" };
  }

  // ── Development and local builds: unchanged ──────────────────────────────
  if (vercelEnv) return { action: "skip", reason: `VERCEL_ENV=${vercelEnv}: skipping prisma migrate deploy.` };
  return { action: "migrate", url: env.DATABASE_URL, label: "local" };
}

/**
 * Layer 2: the database about to be migrated must prove it is the Preview
 * branch. `query(sql)` runs against that exact database (PREVIEW_DIRECT_URL)
 * and resolves to its rows. Fails closed on a missing table, a missing row,
 * a wrong value or any error.
 * @param {(sql: string) => Promise<{ value?: unknown }[]>} query
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function verifyPreviewMarker(query) {
  try {
    const exists = await query(`SELECT to_regclass('public."${PREVIEW_MARKER_TABLE}"') IS NOT NULL AS value`);
    if (exists[0]?.value !== true) {
      return { ok: false, reason: `The target database has no ${PREVIEW_MARKER_TABLE} marker — it is not the Preview branch. Refusing to migrate.` };
    }
    const rows = await query(PREVIEW_MARKER_SQL);
    if (rows.length !== 1 || rows[0]?.value !== PREVIEW_MARKER_VALUE) {
      return { ok: false, reason: `The ${PREVIEW_MARKER_TABLE} marker does not say role = '${PREVIEW_MARKER_VALUE}'. Refusing to migrate.` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Could not verify the Preview marker (${e instanceof Error ? e.message : "unknown error"}). Refusing to migrate.` };
  }
}
