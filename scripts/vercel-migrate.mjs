// Build-time migration gate. Runs `prisma migrate deploy` over Neon's DIRECT
// (non-pooler) connection: Prisma's session-level advisory lock is unsafe
// through PgBouncer transaction pooling. Production migrates over DIRECT_URL
// exactly as before; Preview migrates only a dedicated Neon branch
// (PREVIEW_DIRECT_URL, guarded in lib/migrate-plan.mjs) and otherwise skips.
// See docs/DEPLOYMENT_DATABASES.md.
import { spawnSync } from "node:child_process";

import { neonEndpoint, planMigration } from "./lib/migrate-plan.mjs";

const plan = planMigration(process.env);
if (plan.action === "skip") {
  console.log(`[migrate] ${plan.reason}`);
  process.exit(0);
}
if (plan.action === "fail") throw new Error(`[migrate] ${plan.reason}`);

if (plan.label === "preview branch") {
  // Endpoint ids are host labels, not credentials — logged so the build log
  // shows which branch was migrated.
  console.log(`[migrate] Preview: prisma migrate deploy → isolated branch ${neonEndpoint(plan.url)}`);
}
const r = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: plan.url },
});
process.exit(r.status ?? 1);
