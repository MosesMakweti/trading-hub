import { S3Client } from "@aws-sdk/client-s3";

// Cloudflare R2 is S3-compatible, so we talk to it with the AWS S3 client pointed
// at the account's R2 endpoint. The bucket is PRIVATE — nothing here builds a
// public URL. Stored objects are only ever streamed back through the auth-scoped
// GET /api/media/[id] route (see media-storage.ts + that route).

export interface R2Config {
  client: S3Client;
  bucket: string;
}

interface R2Env {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function readEnv(): R2Env | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/** Whether R2 credentials are fully configured — gates `isUploadsEnabled()`. */
export function isR2Configured(): boolean {
  return readEnv() !== null;
}

// One client per process. Cached on `globalThis` so Next.js's dev-mode module
// reloading doesn't leak a new client on every edit (same pattern as server/db.ts).
const globalForR2 = globalThis as unknown as { r2Client?: S3Client };

/** The configured R2 client + bucket, or throws if credentials are missing. */
export function getR2(): R2Config {
  const env = readEnv();
  if (!env) {
    throw new Error(
      "R2 storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.",
    );
  }
  const client =
    globalForR2.r2Client ??
    new S3Client({
      region: "auto",
      endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey,
      },
    });
  if (process.env.NODE_ENV !== "production") globalForR2.r2Client = client;
  return { client, bucket: env.bucket };
}
