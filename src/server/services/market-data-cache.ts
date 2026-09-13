/**
 * Durable L2 cache for real (non-Fixture) historical market data — Stage
 * 17B §21. Backed by the same Cloudflare R2 bucket already wired for media
 * (`src/lib/r2.ts`), under a distinct `market-data/` key prefix. Gated
 * behind `DATABENTO_R2_CACHE_ENABLED`, which defaults OFF: Databento's
 * redistribution/caching terms weren't confirmed during this stage (Stage
 * 17A flagged licensing as the recurring blocker across every vendor), so
 * durably storing real vendor data is opt-in until that's resolved, not a
 * default behavior this code assumes is fine.
 *
 * Only ever caches ONE literal contract's ONE fully-closed UTC calendar day
 * at a time (never "today," never a partial/in-progress session) — see
 * `isDayFullyClosed`. Every read is validated (schema version, contract/date
 * match, timestamp ordering, no duplicates) before being trusted; anything
 * that fails validation is treated as a cache miss, never a hard error —
 * corrupt cache data must never take Replay down.
 */
import { GetObjectCommand, NoSuchKey, PutObjectCommand } from "@aws-sdk/client-s3";

import { getR2, isR2Configured } from "@/lib/r2";
import { compareCandles, isValidCandle } from "@/domain/market-data/candle";
import type { Candle } from "@/domain/market-data/candle";

const DAY_MS = 86_400_000;
const SCHEMA_VERSION = 1;

interface CacheEnvelope {
  schemaVersion: number;
  datasetId: string;
  contractSymbol: string;
  dateKey: string; // YYYY-MM-DD, UTC
  cachedAt: string; // ISO
  candles: Candle[];
}

export function isMarketDataR2CacheEnabled(): boolean {
  return process.env.DATABENTO_R2_CACHE_ENABLED === "true" && isR2Configured();
}

/** A UTC day is "fully closed" once it has entirely elapsed — with a small
 *  buffer for Databento's own historical-data publication lag (Stage 17A:
 *  roughly T+1). Never cache "today" or a day still in progress. */
export function isDayFullyClosed(dayStartMs: number, now: number = Date.now()): boolean {
  return dayStartMs + DAY_MS + DAY_MS <= now;
}

function keyFor(datasetId: string, contractSymbol: string, dateKey: string): string {
  return `market-data/databento/${datasetId}/${contractSymbol}/1m/${dateKey}.json`;
}

function isValidEnvelope(value: unknown, expected: { datasetId: string; contractSymbol: string; dateKey: string }): value is CacheEnvelope {
  if (typeof value !== "object" || value == null) return false;
  const v = value as Partial<CacheEnvelope>;
  if (v.schemaVersion !== SCHEMA_VERSION) return false;
  if (v.datasetId !== expected.datasetId || v.contractSymbol !== expected.contractSymbol || v.dateKey !== expected.dateKey) return false;
  if (!Array.isArray(v.candles)) return false;
  if (!v.candles.every((c) => isValidCandle(c))) return false;
  for (let i = 1; i < v.candles.length; i += 1) {
    if (v.candles[i].timestamp <= v.candles[i - 1].timestamp) return false; // must be strictly ascending, no dupes
  }
  return true;
}

/** Returns cached candles for this exact (dataset, contract, day), or null
 *  on a miss OR any validation failure (logged, never thrown). */
export async function readCachedDay(datasetId: string, contractSymbol: string, dateKey: string): Promise<Candle[] | null> {
  if (!isMarketDataR2CacheEnabled()) return null;
  const { client, bucket } = getR2();
  const key = keyFor(datasetId, contractSymbol, dateKey);
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) return null;
    const text = await res.Body.transformToString();
    const parsed = JSON.parse(text);
    if (!isValidEnvelope(parsed, { datasetId, contractSymbol, dateKey })) {
      console.warn(`[market-data-cache] Discarding corrupt/mismatched cache entry at ${key}`);
      return null;
    }
    return parsed.candles;
  } catch (error) {
    if (error instanceof NoSuchKey) return null;
    console.warn(`[market-data-cache] Cache read failed for ${key}, falling back to live fetch.`, error);
    return null;
  }
}

/** Writes candles for one fully-closed day. Never throws — a cache write
 *  failure must never fail the underlying market-data fetch it's caching. */
export async function writeCachedDay(
  datasetId: string,
  contractSymbol: string,
  dateKey: string,
  candles: Candle[],
): Promise<void> {
  if (!isMarketDataR2CacheEnabled()) return;
  const { client, bucket } = getR2();
  const key = keyFor(datasetId, contractSymbol, dateKey);
  const envelope: CacheEnvelope = {
    schemaVersion: SCHEMA_VERSION,
    datasetId,
    contractSymbol,
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
    console.warn(`[market-data-cache] Cache write failed for ${key} (non-fatal).`, error);
  }
}
