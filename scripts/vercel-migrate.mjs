// Build-time migration gate. Runs `prisma migrate deploy` over Neon's DIRECT
// (non-pooler) connection: Prisma's session-level advisory lock is unsafe
// through PgBouncer transaction pooling. Production migrates over DIRECT_URL
// exactly as before; Preview migrates only a dedicated Neon branch that passes
// the configuration checks AND carries the Preview marker row
// (lib/migrate-plan.mjs). See docs/DEPLOYMENT_DATABASES.md.
import { spawnSync } from "node:child_process";
import pg from "pg";

import { neonEndpoint, planMigration, verifyPreviewMarker } from "./lib/migrate-plan.mjs";

const plan = planMigration(process.env);
if (plan.action === "skip") {
  console.log(`[migrate] ${plan.reason}`);
  process.exit(0);
}
if (plan.action === "fail") throw new Error(`[migrate] ${plan.reason}`);

if (plan.label === "preview branch") {
  // Independent of every configured value: the exact database about to be
  // migrated must contain the marker that exists only on the Preview branch.
  const client = new pg.Client({ connectionString: plan.url });
  let marker;
  try {
    await client.connect();
    marker = await verifyPreviewMarker(async (sql) => (await client.query(sql)).rows);
  } catch (e) {
    marker = { ok: false, reason: `Could not connect to verify the Preview marker (${e instanceof Error ? e.message : "unknown error"}).` };
  } finally {
    await client.end().catch(() => {});
  }
  if (!marker.ok) throw new Error(`[migrate] ${marker.reason}`);
  // Endpoint ids are host labels, not credentials — logged for the build log.
  console.log(`[migrate] Preview: marker verified; prisma migrate deploy → isolated branch ${neonEndpoint(plan.url)}`);
}
const r = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: plan.url },
});
process.exit(r.status ?? 1);
