// Build-time migration gate. Runs `prisma migrate deploy` over Neon's DIRECT
// (non-pooler) connection: Prisma's session-level advisory lock is unsafe
// through PgBouncer transaction pooling. Preview builds never migrate.
import { spawnSync } from "node:child_process";

const env = process.env.VERCEL_ENV;
if (env && env !== "production") {
  console.log(`[migrate] VERCEL_ENV=${env}: skipping prisma migrate deploy.`);
  process.exit(0);
}

let url = process.env.DATABASE_URL;
if (env === "production") {
  url = process.env.DIRECT_URL;
  if (!url) throw new Error("[migrate] DIRECT_URL is not set for Production.");
  if (new URL(url).hostname.includes("-pooler")) {
    throw new Error("[migrate] DIRECT_URL is a pooled (-pooler) host; use Neon's direct connection.");
  }
}

const r = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(r.status ?? 1);
