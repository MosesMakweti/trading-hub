// Stage 17C.2 §24/§25 — deletes ALL R2 objects cached under Twelve Data's
// market-data prefix (`market-data/twelvedata/`) and NOTHING else.
// Databento's cache (`market-data/databento/`), media uploads, and every
// other R2 object live under different prefixes and are structurally
// unreachable by this script.
//
// WHY THIS EXISTS: Twelve Data's commercial license ties caching rights to
// the ACTIVE SUBSCRIPTION and requires deletion within 30 days of
// termination (see docs/TWELVE_DATA_MARKET_DATA.md — "Subscription
// lifecycle"). This is the enforceable mechanism for that obligation.
//
// WHY IT DOESN'T IMPORT `src/server/services/market-data/twelve-data-cache.ts`:
// that file uses this project's `@/*` tsconfig path alias, which Node's
// native TS type-stripping (`--experimental-strip-types`, used here) does
// not resolve — only Next.js/Vitest's bundler-level resolution does. This
// script instead reimplements the same short list-and-delete-by-prefix
// operation directly against the real `@aws-sdk/client-s3` package (a
// normal installed dependency, unaffected by path-alias resolution).
// KEEP THE PREFIX BELOW IN SYNC with `TWELVE_DATA_CACHE_PREFIX` in that
// file if it's ever changed.
//
// Deliberately explicit and hard to invoke by accident: requires
// `--confirm=PURGE-TWELVEDATA-CACHE` verbatim on the command line. Never
// exposed as a UI action or ordinary server action — this is an
// admin/development-only operational script.
//
// Run with:
//   node --experimental-strip-types scripts/purge-twelvedata-market-data-cache.mjs --confirm=PURGE-TWELVEDATA-CACHE
import "dotenv/config";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const REQUIRED_CONFIRM = "PURGE-TWELVEDATA-CACHE";
const PREFIX = "market-data/twelvedata/"; // keep in sync with TWELVE_DATA_CACHE_PREFIX

function readConfirmArg() {
  const arg = process.argv.find((a) => a.startsWith("--confirm="));
  return arg ? arg.slice("--confirm=".length) : null;
}

function readR2Env() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

async function main() {
  const confirm = readConfirmArg();
  if (confirm !== REQUIRED_CONFIRM) {
    console.error(`Refusing to run: pass --confirm=${REQUIRED_CONFIRM} exactly.`);
    process.exitCode = 1;
    return;
  }

  const env = readR2Env();
  if (!env) {
    console.error("R2 storage is not configured (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET) — nothing to purge.");
    process.exitCode = 1;
    return;
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
  });

  let deletedCount = 0;
  let continuationToken;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: env.bucket, Prefix: PREFIX, ContinuationToken: continuationToken }),
    );
    const objects = (listed.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: env.bucket, Delete: { Objects: objects } }));
      deletedCount += objects.length;
      console.log(`Deleted ${objects.length} object(s) (running total: ${deletedCount})`);
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);

  console.log(`Done. Purged ${deletedCount} Twelve Data market-data cache object(s) under "${PREFIX}". Databento's cache and all other R2 data were untouched.`);
}

main().catch((error) => {
  console.error("Purge failed:", error);
  process.exitCode = 1;
});
