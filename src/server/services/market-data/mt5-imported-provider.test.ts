import { GetObjectCommand, NoSuchKey, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { createMt5Import } from "@/server/services/mt5-import.service";
import { analyzeMarketDataQuality } from "@/domain/market-data/quality-analysis";
import { Mt5ImportedHistoricalMarketDataProvider } from "./mt5-imported-provider";
import type { Candle } from "@/domain/market-data/candle";

/** A real in-memory R2, not just a write-only stub — this provider READS
 *  chunks back (unlike mt5-import.service.test.ts, which only exercises the
 *  write path), so the mock needs to actually round-trip what it's given. */
const store = new Map<string, string>();
const sendMock = vi.fn(async (command: unknown) => {
  if (command instanceof PutObjectCommand) {
    store.set(command.input.Key!, command.input.Body as string);
    return {};
  }
  if (command instanceof GetObjectCommand) {
    const body = store.get(command.input.Key!);
    if (body === undefined) throw new NoSuchKey({ message: "not found", $metadata: {} });
    return { Body: { transformToString: async () => body } };
  }
  return {};
});
vi.mock("@/lib/r2", () => ({
  getR2: vi.fn(() => ({ client: { send: sendMock }, bucket: "test-bucket" })),
}));

const userIds: string[] = [];
async function makeUser(label: string) {
  const user = await prisma.user.create({ data: { email: `mt5-provider-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` } });
  userIds.push(user.id);
  return user;
}
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

const MIN = 60_000;
function candles(startMs: number, count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({ timestamp: startMs + i * MIN, open: 100, high: 101, low: 99, close: 100.5, volume: null }));
}
function quality(cs: Candle[]) {
  return analyzeMarketDataQuality(cs, "1m", cs[0].timestamp, cs[cs.length - 1].timestamp);
}

async function makeImport(userId: string, opts: { canonicalSymbol?: string; nativeTimeframe?: "1m" | "5m"; start?: number; count?: number } = {}) {
  const cs = candles(opts.start ?? Date.UTC(2026, 0, 6), opts.count ?? 60); // Jan 6 2026 (a Tuesday)
  return createMt5Import(userId, {
    sourceSymbol: (opts.canonicalSymbol ?? "XAUUSD") + ".a",
    canonicalSymbol: opts.canonicalSymbol ?? "XAUUSD",
    nativeTimeframe: opts.nativeTimeframe ?? "1m",
    timeConvention: { kind: "UTC" },
    candles: cs,
    quality: quality(cs),
    status: "READY",
  });
}

describe("Mt5ImportedHistoricalMarketDataProvider (Stage 21.3B §3/§6)", () => {
  beforeEach(() => {
    sendMock.mockClear();
    store.clear();
  });

  it("returns real imported candles for the default (merge-all-overlapping) mode", async () => {
    const user = await makeUser("default-mode");
    await makeImport(user.id);
    const provider = new Mt5ImportedHistoricalMarketDataProvider(user.id);

    const from = Date.UTC(2026, 0, 6);
    const result = await provider.fetchCandles({ canonicalSymbol: "XAUUSD", from, to: from + 10 * MIN });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candles.length).toBeGreaterThan(0);
      expect(result.provenance?.providerId).toBe("mt5-imported");
      // §14/§15 — merge-all mode has no single dataset identity to report.
      expect(result.provenance?.datasetId).toBeUndefined();
    }
  });

  it("an explicitly pinned importId returns candles from exactly that dataset, and reports its own id as datasetId (§14/§15)", async () => {
    const user = await makeUser("pinned-dataset");
    const imp = await makeImport(user.id, { start: Date.UTC(2026, 0, 6), count: 30 });
    const provider = new Mt5ImportedHistoricalMarketDataProvider(user.id, "1m", imp.id);

    const from = Date.UTC(2026, 0, 6);
    const result = await provider.fetchCandles({ canonicalSymbol: "XAUUSD", from, to: from + 5 * MIN });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candles.length).toBe(6);
      expect(result.provenance?.datasetId).toBe(imp.id);
      expect(result.provenance?.segments).toEqual([{ contractSymbol: imp.id, from, to: from + 5 * MIN }]);
    }
  });

  it("selecting between two datasets for the SAME symbol returns only the pinned one's data", async () => {
    const user = await makeUser("two-datasets");
    const jan = await makeImport(user.id, { start: Date.UTC(2026, 0, 6), count: 10 });
    const feb = await makeImport(user.id, { start: Date.UTC(2026, 1, 3), count: 10 });

    const janProvider = new Mt5ImportedHistoricalMarketDataProvider(user.id, "1m", jan.id);
    const janResult = await janProvider.fetchCandles({ canonicalSymbol: "XAUUSD", from: Date.UTC(2026, 1, 3), to: Date.UTC(2026, 1, 3) + 5 * MIN });
    // Pinned to the January import — must NOT find February's data even though it exists for this user/symbol.
    expect(janResult.ok).toBe(false);
    if (!janResult.ok) expect(janResult.error.code).toBe("OUT_OF_COVERAGE");

    const febProvider = new Mt5ImportedHistoricalMarketDataProvider(user.id, "1m", feb.id);
    const febResult = await febProvider.fetchCandles({ canonicalSymbol: "XAUUSD", from: Date.UTC(2026, 1, 3), to: Date.UTC(2026, 1, 3) + 5 * MIN });
    expect(febResult.ok).toBe(true);
  });

  it("a foreign user's importId cannot be retrieved — ownership boundary (§7)", async () => {
    const owner = await makeUser("owner");
    const attacker = await makeUser("attacker");
    const imp = await makeImport(owner.id);

    const provider = new Mt5ImportedHistoricalMarketDataProvider(attacker.id, "1m", imp.id);
    const result = await provider.fetchCandles({ canonicalSymbol: "XAUUSD", from: Date.UTC(2026, 0, 6), to: Date.UTC(2026, 0, 6) + 5 * MIN });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_COVERAGE"); // never a distinguishable "found but not yours"
  });

  it("a nonexistent importId fails safely, the same way a foreign one does", async () => {
    const user = await makeUser("missing-import");
    const provider = new Mt5ImportedHistoricalMarketDataProvider(user.id, "1m", "does-not-exist");
    const result = await provider.fetchCandles({ canonicalSymbol: "XAUUSD", from: Date.UTC(2026, 0, 6), to: Date.UTC(2026, 0, 6) + 5 * MIN });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_COVERAGE");
  });

  it("a pinned import for a DIFFERENT symbol than requested is refused, never returns the wrong instrument's candles", async () => {
    const user = await makeUser("symbol-mismatch");
    const imp = await makeImport(user.id, { canonicalSymbol: "EURUSD" });
    const provider = new Mt5ImportedHistoricalMarketDataProvider(user.id, "1m", imp.id);

    const result = await provider.fetchCandles({ canonicalSymbol: "XAUUSD", from: Date.UTC(2026, 0, 6), to: Date.UTC(2026, 0, 6) + 5 * MIN });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_COVERAGE");
  });

  it("a pinned import for a DIFFERENT native timeframe than the provider instance serves is refused", async () => {
    const user = await makeUser("timeframe-mismatch");
    const imp = await makeImport(user.id, { nativeTimeframe: "5m" });
    const provider = new Mt5ImportedHistoricalMarketDataProvider(user.id, "1m", imp.id); // instance serves 1m, import is 5m

    const result = await provider.fetchCandles({ canonicalSymbol: "XAUUSD", from: Date.UTC(2026, 0, 6), to: Date.UTC(2026, 0, 6) + 5 * MIN });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_COVERAGE");
  });

  it("an unresolvable canonical symbol is rejected before any import lookup happens", async () => {
    const user = await makeUser("unresolvable-symbol");
    const provider = new Mt5ImportedHistoricalMarketDataProvider(user.id);
    const result = await provider.fetchCandles({ canonicalSymbol: "NOT_A_REAL_SYMBOL", from: 0, to: 60_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_SYMBOL");
    expect(sendMock).not.toHaveBeenCalled(); // never touches R2 for an unresolvable symbol
  });

  it("a requested range entirely outside the imported coverage returns OUT_OF_COVERAGE, not an empty success", async () => {
    const user = await makeUser("out-of-range");
    await makeImport(user.id, { start: Date.UTC(2026, 0, 6), count: 10 });
    const provider = new Mt5ImportedHistoricalMarketDataProvider(user.id);

    const farFuture = Date.UTC(2030, 0, 1);
    const result = await provider.fetchCandles({ canonicalSymbol: "XAUUSD", from: farFuture, to: farFuture + 60_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OUT_OF_COVERAGE");
  });
});
