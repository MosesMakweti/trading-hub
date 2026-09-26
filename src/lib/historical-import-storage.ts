import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, NotFound, NoSuchKey, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getR2 } from "@/lib/r2";

/**
 * Native Replay — temporary storage for MT5 files uploaded straight from the
 * browser to R2. Deliberately separate from `media-storage.ts`: these objects
 * are short-lived import sources, never media, and every operation here is
 * confined to the `native-replay-imports/` prefix — this module cannot touch
 * a media object even if handed its key.
 *
 * Uses the same private bucket and client (`getR2()`); the browser only ever
 * receives a presigned PUT for ONE server-chosen key, with the exact byte size
 * and content type signed (R2 rejects any other size) and a short expiry.
 */

export const IMPORT_OBJECT_PREFIX = "native-replay-imports/";
export const IMPORT_CONTENT_TYPE = "text/csv";

export function importObjectKey(userId: string, token: string): string {
  return `${IMPORT_OBJECT_PREFIX}${userId}/${token}.csv`;
}

function assertImportKey(key: string): void {
  if (!key.startsWith(IMPORT_OBJECT_PREFIX) || key.includes("..")) {
    throw new Error("Refusing to touch a storage object outside the import prefix.");
  }
}

/** A presigned PUT for exactly `sizeBytes` bytes of text/csv at `key`. */
export async function presignImportUpload(key: string, sizeBytes: number, expiresInSeconds: number): Promise<string> {
  assertImportKey(key);
  const { client, bucket } = getR2();
  return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: IMPORT_CONTENT_TYPE, ContentLength: sizeBytes }), {
    expiresIn: expiresInSeconds,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
}

/** Stored size in bytes, or null when the object doesn't exist (not uploaded yet). */
export async function headImportObject(key: string): Promise<number | null> {
  assertImportKey(key);
  const { client, bucket } = getR2();
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return res.ContentLength ?? 0;
  } catch (error) {
    if (error instanceof NotFound || error instanceof NoSuchKey || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

export async function readImportObject(key: string): Promise<Uint8Array> {
  assertImportKey(key);
  const { client, bucket } = getR2();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error("The uploaded file is empty.");
  return res.Body.transformToByteArray();
}

/** Idempotent (deleting a missing object succeeds). */
export async function deleteImportObject(key: string): Promise<void> {
  assertImportKey(key);
  const { client, bucket } = getR2();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
