import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { createMt5Import, deleteMt5Import, findOverlappingMt5Imports, getMt5Import, listMt5Imports } from "@/server/services/mt5-import.service";
import { analyzeMarketDataQuality } from "@/domain/market-data/quality-analysis";
import type { Candle } from "@/domain/market-data/candle";

const sendMock = vi.fn();
vi.mock("@/lib/r2", () => ({
  getR2: vi.fn(() => ({ client: { send: sendMock }, bucket: "test-bucket" })),
}));

const userIds: string[] = [];
async function makeUser(label: string) {
  const user = await prisma.user.create({ data: { email: `mt5-import-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` } });
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

describe("createMt5Import / listMt5Imports / getMt5Import — Stage 21.3A §18/§21", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  it("persists metadata and writes R2 chunks for a valid import", async () => {
    const user = await makeUser("basic");
    const cs = candles(Date.UTC(2024, 0, 2), 10);
    const result = await createMt5Import(user.id, {
      sourceSymbol: "XAUUSD.a",
      canonicalSymbol: "XAUUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: cs,
      quality: quality(cs),
      status: "READY",
      sourceLabel: "IC Markets",
      originalFileName: "XAUUSD_M1.csv",
    });
    expect(result.sourceSymbol).toBe("XAUUSD.a");
    expect(result.canonicalSymbol).toBe("XAUUSD");
    expect(result.candleCount).toBe(10);
    expect(sendMock).toHaveBeenCalled(); // R2 write happened

    const row = await prisma.marketDataImport.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.userId).toBe(user.id);
    expect(row.sourceType).toBe("MT5");
  });

  it("refuses to persist an import in an unacceptable state", async () => {
    const user = await makeUser("invalid-state");
    const cs = candles(Date.UTC(2024, 0, 2), 1);
    await expect(
      createMt5Import(user.id, { sourceSymbol: "XAUUSD", canonicalSymbol: "XAUUSD", nativeTimeframe: "1m", timeConvention: { kind: "UTC" }, candles: cs, quality: quality(cs), status: "INVALID" }),
    ).rejects.toThrow();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("refuses to persist zero candles", async () => {
    const user = await makeUser("zero-candles");
    await expect(
      createMt5Import(user.id, { sourceSymbol: "XAUUSD", canonicalSymbol: "XAUUSD", nativeTimeframe: "1m", timeConvention: { kind: "UTC" }, candles: [], quality: quality(candles(0, 1)), status: "READY" }),
    ).rejects.toThrow();
  });

  it("removes the metadata row if the R2 write fails, never leaving an orphaned successful-looking import", async () => {
    sendMock.mockRejectedValueOnce(new Error("R2 unavailable"));
    const user = await makeUser("r2-failure");
    const cs = candles(Date.UTC(2024, 0, 2), 5);
    await expect(
      createMt5Import(user.id, { sourceSymbol: "XAUUSD", canonicalSymbol: "XAUUSD", nativeTimeframe: "1m", timeConvention: { kind: "UTC" }, candles: cs, quality: quality(cs), status: "READY" }),
    ).rejects.toThrow("R2 unavailable");
    const rows = await prisma.marketDataImport.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(0);
  });

  it("lists a user's own imports newest-first", async () => {
    const user = await makeUser("list-order");
    const cs1 = candles(Date.UTC(2024, 0, 2), 3);
    const first = await createMt5Import(user.id, { sourceSymbol: "XAUUSD", canonicalSymbol: "XAUUSD", nativeTimeframe: "1m", timeConvention: { kind: "UTC" }, candles: cs1, quality: quality(cs1), status: "READY" });
    await new Promise((r) => setTimeout(r, 5));
    const cs2 = candles(Date.UTC(2024, 1, 2), 3);
    const second = await createMt5Import(user.id, { sourceSymbol: "XAUUSD", canonicalSymbol: "XAUUSD", nativeTimeframe: "1m", timeConvention: { kind: "UTC" }, candles: cs2, quality: quality(cs2), status: "READY" });

    const list = await listMt5Imports(user.id);
    expect(list.map((i) => i.id)).toEqual([second.id, first.id]);
  });
});

describe("Ownership enforcement — Stage 21.3A §21", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  it("a user cannot read another user's import by id", async () => {
    const owner = await makeUser("owner");
    const attacker = await makeUser("attacker");
    const cs = candles(Date.UTC(2024, 0, 2), 3);
    const imp = await createMt5Import(owner.id, { sourceSymbol: "XAUUSD", canonicalSymbol: "XAUUSD", nativeTimeframe: "1m", timeConvention: { kind: "UTC" }, candles: cs, quality: quality(cs), status: "READY" });

    expect(await getMt5Import(attacker.id, imp.id)).toBeNull();
    expect(await getMt5Import(owner.id, imp.id)).not.toBeNull();
  });

  it("a user cannot delete another user's import", async () => {
    const owner = await makeUser("owner2");
    const attacker = await makeUser("attacker2");
    const cs = candles(Date.UTC(2024, 0, 2), 3);
    const imp = await createMt5Import(owner.id, { sourceSymbol: "XAUUSD", canonicalSymbol: "XAUUSD", nativeTimeframe: "1m", timeConvention: { kind: "UTC" }, candles: cs, quality: quality(cs), status: "READY" });

    const attackerResult = await deleteMt5Import(attacker.id, imp.id);
    expect(attackerResult.success).toBe(false);
    expect(await getMt5Import(owner.id, imp.id)).not.toBeNull(); // still there

    const ownerResult = await deleteMt5Import(owner.id, imp.id);
    expect(ownerResult.success).toBe(true);
    expect(await getMt5Import(owner.id, imp.id)).toBeNull();
  });

  it("a user's imports never appear in another user's list", async () => {
    const userA = await makeUser("list-a");
    const userB = await makeUser("list-b");
    const cs = candles(Date.UTC(2024, 0, 2), 3);
    await createMt5Import(userA.id, { sourceSymbol: "XAUUSD", canonicalSymbol: "XAUUSD", nativeTimeframe: "1m", timeConvention: { kind: "UTC" }, candles: cs, quality: quality(cs), status: "READY" });

    expect(await listMt5Imports(userB.id)).toEqual([]);
  });
});

describe("findOverlappingMt5Imports — Stage 21.3A §22", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  it("finds only imports whose range overlaps the requested window, newest first", async () => {
    const user = await makeUser("overlap");
    const jan = candles(Date.UTC(2024, 0, 1), 3);
    const june = candles(Date.UTC(2024, 5, 1), 3);
    await createMt5Import(user.id, { sourceSymbol: "XAUUSD", canonicalSymbol: "XAUUSD", nativeTimeframe: "1m", timeConvention: { kind: "UTC" }, candles: jan, quality: quality(jan), status: "READY" });
    await new Promise((r) => setTimeout(r, 5));
    await createMt5Import(user.id, { sourceSymbol: "XAUUSD", canonicalSymbol: "XAUUSD", nativeTimeframe: "1m", timeConvention: { kind: "UTC" }, candles: june, quality: quality(june), status: "READY" });

    const overlapping = await findOverlappingMt5Imports(user.id, "XAUUSD", "1m", Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 31));
    expect(overlapping).toHaveLength(1);
    expect(overlapping[0].rangeFrom).toBe(new Date(jan[0].timestamp).toISOString());
  });

  it("never mixes imports across different canonical symbols or timeframes", async () => {
    const user = await makeUser("overlap-scope");
    const cs = candles(Date.UTC(2024, 0, 1), 3);
    await createMt5Import(user.id, { sourceSymbol: "EURUSD", canonicalSymbol: "EURUSD", nativeTimeframe: "1m", timeConvention: { kind: "UTC" }, candles: cs, quality: quality(cs), status: "READY" });

    expect(await findOverlappingMt5Imports(user.id, "XAUUSD", "1m", Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 31))).toEqual([]);
    expect(await findOverlappingMt5Imports(user.id, "EURUSD", "5m", Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 31))).toEqual([]);
  });
});
