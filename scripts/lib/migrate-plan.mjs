// Build-time migration plan (pure; no I/O) — used by scripts/vercel-migrate.mjs.
//
// Production — UNCHANGED from the original gate: migrate over DIRECT_URL;
//   fail if it is missing or its host contains "-pooler" (Prisma's
//   session-level advisory lock is unsafe through Neon's PgBouncer pooler).
//
// Preview — migrates ONLY a dedicated, isolated Neon branch. The migration
//   URL comes exclusively from PREVIEW_DIRECT_URL (a distinct name, so no
//   Vercel scope/precedence mistake can ever hand Preview production's
//   DIRECT_URL). DATABASE_URL and DIRECT_URL are never migration targets in
//   Preview. Rules:
//     • PRODUCTION_DB_ENDPOINT set (the production Neon endpoint id,
//       e.g. ep-cool-name-123456 — a hostname label, not a secret) and the
//       Preview runtime DATABASE_URL is that endpoint → FAIL: Preview would
//       run against production.
//     • No PREVIEW_DIRECT_URL → SKIP (today's behaviour) and say what to set.
//     • PREVIEW_DIRECT_URL set → it must be a direct (non-pooler) host, NOT
//       the production endpoint (PRODUCTION_DB_ENDPOINT is then required),
//       and the SAME endpoint as the Preview runtime DATABASE_URL (pooled +
//       direct of one branch). Otherwise FAIL with the reason.
//
// Other Vercel environments (development, custom) — skip, unchanged.
// Local builds (no VERCEL_ENV) — migrate DATABASE_URL, unchanged.

const ENDPOINT_ID = /^ep-[a-z0-9-]+$/;

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

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ action: "skip", reason: string }
 *   | { action: "migrate", url: string | undefined, label: "production" | "preview branch" | "local" }
 *   | { action: "fail", reason: string }}
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

  // ── Preview: a dedicated, isolated branch only ───────────────────────────
  if (vercelEnv === "preview") {
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
      return { action: "fail", reason: "PREVIEW_DIRECT_URL is set but PRODUCTION_DB_ENDPOINT is not — it is required to prove the Preview branch is not production." };
    }
    if (!parses(previewDirect)) return { action: "fail", reason: "PREVIEW_DIRECT_URL is not a valid connection URL." };
    if (isPooled(previewDirect)) {
      return { action: "fail", reason: "PREVIEW_DIRECT_URL is a pooled (-pooler) host; use the Preview branch's direct connection." };
    }
    if (neonEndpoint(previewDirect) === prodEndpoint) {
      return { action: "fail", reason: "PREVIEW_DIRECT_URL is the PRODUCTION endpoint — refusing to migrate production from a Preview build." };
    }
    if (!runtime || !parses(runtime)) {
      return { action: "fail", reason: "PREVIEW_DIRECT_URL is set but the Preview DATABASE_URL is missing or invalid — Preview must run on the same branch it migrates." };
    }
    if (neonEndpoint(runtime) !== neonEndpoint(previewDirect)) {
      return { action: "fail", reason: "Preview DATABASE_URL and PREVIEW_DIRECT_URL point at different Neon endpoints — they must be the pooled and direct connections of one branch." };
    }
    return { action: "migrate", url: previewDirect, label: "preview branch" };
  }

  // ── Everything else: unchanged ───────────────────────────────────────────
  if (vercelEnv) return { action: "skip", reason: `VERCEL_ENV=${vercelEnv}: skipping prisma migrate deploy.` };
  return { action: "migrate", url: env.DATABASE_URL, label: "local" };
}
