import { createHash } from "node:crypto";

import { prisma } from "@/server/db";

/**
 * TradingView Extension — Step 3 (docs/extension-api.md). Idempotency for
 * POST /api/v1/trades via an optional `Idempotency-Key` header. Deliberately
 * simple: one row per (user, key), recording a hash of the request body so
 * a genuine retry (same key, same payload) is distinguishable from a key
 * reused for a different payload (same key, different hash — a client bug,
 * not a retry).
 */

/** Deterministic regardless of key insertion order, so two logically
 *  identical request bodies always hash the same way. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(stableStringify(body), "utf8").digest("hex");
}

export type IdempotencyCheck =
  | { status: "new" }
  | { status: "replay"; tradeId: string | null }
  | { status: "conflict" };

/** Call BEFORE doing any work. Reserving the key here (not after creating
 *  the trade) is what closes the double-click/double-submit race: a second
 *  concurrent request with the same key hits the `@@unique([userId, key])`
 *  constraint and is treated as a replay/conflict rather than racing its
 *  own trade creation. */
export async function reserveIdempotencyKey(
  userId: string,
  key: string,
  requestBody: unknown,
): Promise<IdempotencyCheck> {
  const requestHash = hashRequestBody(requestBody);

  const existing = await prisma.apiIdempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
  if (existing) {
    return existing.requestHash === requestHash
      ? { status: "replay", tradeId: existing.tradeId }
      : { status: "conflict" };
  }

  try {
    await prisma.apiIdempotencyKey.create({ data: { userId, key, requestHash, tradeId: null } });
    return { status: "new" };
  } catch {
    // Lost a race with a concurrent identical request between the findUnique
    // above and this create — re-check rather than assume either outcome.
    const raced = await prisma.apiIdempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
    if (!raced) throw new Error("Could not reserve idempotency key.");
    return raced.requestHash === requestHash ? { status: "replay", tradeId: raced.tradeId } : { status: "conflict" };
  }
}

/** Call once the trade this key produced is known. */
export async function recordIdempotencyResult(userId: string, key: string, tradeId: string): Promise<void> {
  await prisma.apiIdempotencyKey.update({ where: { userId_key: { userId, key } }, data: { tradeId } });
}
