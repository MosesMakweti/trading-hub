/**
 * Durable L2 cache for Twelve Data OTC (Forex/Metals) historical market
 * data — Stage 17C.2 §22-25. Deliberately a SEPARATE module from
 * `market-data-cache.ts` (Databento's L2 cache), not a generalization of
 * it: Stage 17C.1 found Twelve Data's commercial license ties caching
 * rights to the ACTIVE SUBSCRIPTION and requires deletion within 30 days of
 * termination — a materially different (and stricter) retention obligation
 * than Databento's. Keeping the two caches in separate modules under
 * separate R2 key prefixes (`market-data/twelvedata/` vs.
 * `market-data/databento/`) means a Twelve Data subscription lapse can be
 * enforced by purging exactly this module's keys without touching
 * Databento's cache, media uploads, or any other R2 object — see
 * `purgeAllTwelveDataCache` below and
 * `scripts/purge-twelvedata-market-data-cache.mjs`.
 *
 * `purgeAllTwelveDataCache` here is unit-tested (mocked R2 client) for its
 * confirm-gate and prefix-only-deletion behavior, but the actual operator
 * script does NOT import this module: Node's native TS type-stripping
 * (`--experimental-strip-types`, used by this repo's other standalone
 * scripts) cannot resolve this project's `@/*` tsconfig path alias, only
 * Next.js/Vitest's bundler-level resolution can — so a plain Node script
 * importing this file would fail at the `@/lib/r2` import below. The
 * script instead reimplements the same short list-and-delete-by-prefix
 * operation directly against the real `@aws-sdk/client-s3` package (a
 * normal installed dependency, unaffected by path-alias resolution) — see
 * the prominent cross-reference comments in both files if either the
 * prefix shape or the delete logic here ever changes.
 *
 * Gated behind `TWELVE_DATA_R2_CACHE_ENABLED`, defaulting OFF for the same
 * reason Databento's cache defaults off: durably storing real vendor data
 * is opt-in until licensing is confirmed for the deployment it runs in.
 * Only ever caches ONE provider symbol's ONE fully-closed UTC calendar day
 * at a time — see `isDayFullyClosed` (reused from Databento's cache module;
 * it is a pure, provider-agnostic function of a day boundary and "now").
 * Every read is validated (schema version, provider/basis/symbol/date
 * match, timestamp ordering, no duplicates) before being trusted; anything
 * that fails validation is treated as a cache miss, never a hard error.
 */
import { GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, NoSuchKey, PutObjectCommand } from "@aws-sdk/client-s3";

import { getR2, isR2Configured } from "@/lib/r2";
import { compareCandles, isValidCandle } from "@/domain/market-data/candle";
import type { Candle } from "@/domain/market-data/candle";

export { isDayFullyClosed } from "@/server/services/market-data-cache";

const SCHEMA_VERSION = 1;

/** Every Twelve Data cache object lives under this one prefix — the sole
 *  basis for `purgeAllTwelveDataCache`'s isolation guarantee (§24/§25). */
export const TWELVE_DATA_CACHE_PREFIX = "market-data/twelvedata/";

interface CacheEnvelope {
  schemaVersion: number;
  provider: "twelvedata";
  priceBasis: string;
  providerSymbol: string;
  dateKey: string; // YYYY-MM-DD, UTC
  cachedAt: string; // ISO
  candles: Candle[];
}

export function isTwelveDataR2CacheEnabled(): boolean {
  return process.env.TWELVE_DATA_R2_CACHE_ENABLED === "true" && isR2Configured();
}

/** R2/S3 keys are slash-delimited; a raw Twelve Data provider symbol like
 *  "EUR/USD" contains a "/" that would silently add an unpredictable extra
 *  nesting level to the key (and risk two different symbols sharing a
 *  key-shape ambiguity) — replaced with "_" so every symbol maps to exactly
 *  one flat, predictable key segment (Stage 17C.2 §22). */
function sanitizeSymbolForKey(providerSymbol: string): string {
  return providerSymbol.replace(/\//g, "_");
}

function keyFor(priceBasis: string, providerSymbol: string, dateKey: string): string {
  return `${TWELVE_DATA_CACHE_PREFIX}${priceBasis}/${sanitizeSymbolForKey(providerSymbol)}/1m/${dateKey}.json`;
}

function isValidEnvelope(
  value: unknown,
  expected: { priceBasis: string; providerSymbol: string; dateKey: string },
): value is CacheEnvelope {
  if (typeof value !== "object" || value == null) return false;
  const v = value as Partial<CacheEnvelope>;
  if (v.schemaVersion !== SCHEMA_VERSION) return false;
  if (v.provider !== "twelvedata") return false;
  if (v.priceBasis !== expected.priceBasis || v.providerSymbol !== expected.providerSymbol || v.dateKey !== expected.dateKey) return false;
  if (!Array.isArray(v.candles)) return false;
  if (!v.candles.every((c) => isValidCandle(c))) return false;
  for (let i = 1; i < v.candles.length; i += 1) {
    if (v.candles[i].timestamp <= v.candles[i - 1].timestamp) return false; // must be strictly ascending, no dupes
  }
  return true;
}

/** Returns cached candles for this exact (priceBasis, providerSymbol, day),
 *  or null on a miss OR any validation failure (logged, never thrown). */
export async function readCachedDay(priceBasis: string, providerSymbol: string, dateKey: string): Promise<Candle[] | null> {
  if (!isTwelveDataR2CacheEnabled()) return null;
  const { client, bucket } = getR2();
  const key = keyFor(priceBasis, providerSymbol, dateKey);
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) return null;
    const text = await res.Body.transformToString();
    const parsed = JSON.parse(text);
    if (!isValidEnvelope(parsed, { priceBasis, providerSymbol, dateKey })) {
      console.warn(`[twelve-data-cache] Discarding corrupt/mismatched cache entry at ${key}`);
      return null;
    }
    return parsed.candles;
  } catch (error) {
    if (error instanceof NoSuchKey) return null;
    console.warn(`[twelve-data-cache] Cache read failed for ${key}, falling back to live fetch.`, error);
    return null;
  }
}

/** Writes candles for one fully-closed day. Never throws — a cache write
 *  failure must never fail the underlying market-data fetch it's caching. */
export async function writeCachedDay(priceBasis: string, providerSymbol: string, dateKey: string, candles: Candle[]): Promise<void> {
  if (!isTwelveDataR2CacheEnabled()) return;
  const { client, bucket } = getR2();
  const key = keyFor(priceBasis, providerSymbol, dateKey);
  const envelope: CacheEnvelope = {
    schemaVersion: SCHEMA_VERSION,
    provider: "twelvedata",
    priceBasis,
    providerSymbol,
    dateKey,
    cachedAt: new Date().toISOString(),
    candles: [...candles].sort(compareCandles),
  };
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(envelope),
        ContentType: "application/json",
      }),
    );
  } catch (error) {
    console.warn(`[twelve-data-cache] Cache write failed for ${key} (non-fatal).`, error);
  }
}

/**
 * Stage 17C.2 §24/§25 — the enforceable purge primitive for Twelve Data's
 * subscription-bound retention obligation. Deletes EVERY object under this
 * module's own `market-data/twelvedata/` prefix and nothing else —
 * Databento's cache, media uploads, and every other R2 object live under
 * different prefixes and are structurally unreachable by this function.
 * Requires an EXACT confirmation string (not a boolean) so a stray truthy
 * call can't trigger it; intended to be driven only from
 * `scripts/purge-twelvedata-market-data-cache.mjs` — never from ordinary
 * application code, a server action, or a user-facing UI control.
 */
export async function purgeAllTwelveDataCache(confirm: string): Promise<{ deletedCount: number }> {
  if (confirm !== "PURGE-TWELVEDATA-CACHE") {
    throw new Error('Refusing to purge: call with confirm="PURGE-TWELVEDATA-CACHE" exactly.');
  }
  if (!isR2Configured()) {
    throw new Error("R2 storage is not configured (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET) — nothing to purge.");
  }
  const { client, bucket } = getR2();
  let deletedCount = 0;
  let continuationToken: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: TWELVE_DATA_CACHE_PREFIX, ContinuationToken: continuationToken }),
    );
    const objects = (listed.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
      deletedCount += objects.length;
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
  return { deletedCount };
}
