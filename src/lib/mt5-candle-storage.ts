import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, NoSuchKey, PutObjectCommand } from "@aws-sdk/client-s3";

import { getR2 } from "@/lib/r2";
import type { Candle } from "@/domain/market-data/candle";

/**
 * Stage 21.3A §18/§19/§20 — normalized MT5 candle storage. A DELIBERATELY
 * SEPARATE module from `media-storage.ts`: imported historical candle data
 * has a materially different access pattern (range-fetched by a
 * `HistoricalMarketDataProvider`, never displayed as an image/attachment,
 * never deleted via the generic media-delete flow) and a different lifetime
 * (tied to a `MarketDataImport` row, not a `MediaAsset`). Reuses the SAME
 * underlying R2 client (`getR2()`) — no duplicated credential/config
 * handling — but never touches `MediaAsset` or its storage-key convention.
 *
 * CHUNKING (§19): one JSON array per CALENDAR MONTH (UTC) per import —
 * `market-data-imports/<userId>/<importId>/<YYYY-MM>.json`. Chosen because:
 * - A month of M1 candles is ~43,200 rows (~1-2MB as JSON) — small enough
 *   to fetch/parse as one object, large enough to keep the object COUNT
 *   for a multi-year import in the hundreds, not tens of thousands (avoids
 *   both "one giant blob for a decade of data" and "one object per day").
 * - Matches the existing Stage 17B provider-cache's own day/session
 *   granularity in spirit (bounded, predictable request sizes) without
 *   copying its exact day-chunking (a month is the right size specifically
 *   BECAUSE this is a one-time durable import, not a per-session live fetch
 *   — Replay's own prefetch window layer already handles finer-grained
 *   incremental loading on TOP of whatever a provider returns).
 * - A Replay range request spanning N months touches exactly N objects,
 *   regardless of how many YEARS of history the import as a whole covers —
 *   "fetch symbol + date range + base timeframe efficiently" (§18) without
 *   ever downloading unrelated months.
 */

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function chunkObjectKey(userId: string, importId: string, yearMonth: string): string {
  return `market-data-imports/${userId}/${importId}/${yearMonth}.json`;
}

/** Every calendar-month key (UTC) touched by `[from, to]`, inclusive —
 *  pure and independently testable, since this is exactly what determines
 *  how many R2 objects one Replay range request will read. */
export function monthKeysForRange(from: number, to: number): string[] {
  if (from > to) return [];
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), 1));
  const end = new Date(Date.UTC(new Date(to).getUTCFullYear(), new Date(to).getUTCMonth(), 1));
  while (cursor.getTime() <= end.getTime()) {
    keys.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

/** Groups already-sorted canonical candles into their month chunks and
 *  writes each as one R2 object — the ONLY write path for imported candle
 *  data (never a per-candle write). */
export async function writeCandleChunks(userId: string, importId: string, candles: Candle[]): Promise<{ chunksWritten: number }> {
  const { client, bucket } = getR2();
  const byMonth = new Map<string, Candle[]>();
  for (const c of candles) {
    const key = monthKey(c.timestamp);
    const list = byMonth.get(key);
    if (list) list.push(c);
    else byMonth.set(key, [c]);
  }
  for (const [yearMonth, monthCandles] of byMonth) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: chunkObjectKey(userId, importId, yearMonth),
        Body: JSON.stringify(monthCandles),
        ContentType: "application/json",
      }),
    );
  }
  return { chunksWritten: byMonth.size };
}

/** Reads exactly the month chunks overlapping `[from, to]` and returns the
 *  candles actually within that range — never a whole-import download for
 *  a narrow Replay request (§18/§19). A missing chunk (never written, or a
 *  month with no candles) is simply skipped, not an error. */
export async function readCandleChunksInRange(userId: string, importId: string, from: number, to: number): Promise<Candle[]> {
  const { client, bucket } = getR2();
  const months = monthKeysForRange(from, to);
  const out: Candle[] = [];
  for (const yearMonth of months) {
    let body: string;
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: chunkObjectKey(userId, importId, yearMonth) }));
      if (!res.Body) continue;
      body = await res.Body.transformToString();
    } catch (e) {
      if (e instanceof NoSuchKey) continue;
      throw e;
    }
    const monthCandles = JSON.parse(body) as Candle[];
    for (const c of monthCandles) if (c.timestamp >= from && c.timestamp <= to) out.push(c);
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

/** Deletes every chunk belonging to one import — used when an import is
 *  replaced/removed (§22). Lists by prefix rather than requiring the
 *  caller to know exactly which months exist. */
export async function deleteImportChunks(userId: string, importId: string): Promise<void> {
  const { client, bucket } = getR2();
  const prefix = `market-data-imports/${userId}/${importId}/`;
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  for (const obj of listed.Contents ?? []) {
    if (obj.Key) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
  }
}
