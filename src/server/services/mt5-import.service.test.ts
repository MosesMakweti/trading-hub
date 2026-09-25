import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import {
  confirmMt5Upload,
  createMt5Import,
  deleteMt5Import,
  findOverlappingMt5Imports,
  getMt5Import,
  listMt5Imports,
  readMt5ImportCandles,
  previewMt5Upload,
} from "@/server/services/mt5-import.service";
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

describe("previewMt5Upload / confirmMt5Upload — Edge Review Replay Data Source §8-13", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  function mt5Csv(rows: number): string {
    const lines: string[] = [];
    for (let i = 0; i < rows; i += 1) {
      const minute = String(i).padStart(2, "0");
      lines.push(`2026.01.05,00:${minute},4200.0,4201.0,4199.0,4200.5,10`);
    }
    return lines.join("\n");
  }
  function base64Of(text: string): string {
    return Buffer.from(text, "utf-8").toString("base64");
  }

  it("previewMt5Upload resolves a valid file to READY with the real symbol/range/quality", () => {
    const preview = previewMt5Upload({
      fileContentBase64: base64Of(mt5Csv(5)),
      sourceSymbol: "XAUUSD.a",
      timeframeHint: "1m",
      timeConvention: { kind: "UTC" },
    });
    expect(preview.state).toBe("READY");
    expect(preview.symbol.canonicalSymbol).toBe("XAUUSD");
    expect(preview.rowCounts.valid).toBe(5);
  });

  it("previewMt5Upload comes back NEEDS_USER_INPUT rather than guessing a missing time convention", () => {
    const preview = previewMt5Upload({
      fileContentBase64: base64Of(mt5Csv(5)),
      sourceSymbol: "XAUUSD.a",
      timeframeHint: "1m",
      timeConvention: null,
    });
    expect(preview.state).toBe("NEEDS_USER_INPUT");
  });

  it("previewMt5Upload comes back INVALID for unparseable content, with a real reason", () => {
    const preview = previewMt5Upload({
      fileContentBase64: base64Of("this is not a bar-history file at all"),
      sourceSymbol: null,
      timeframeHint: null,
      timeConvention: null,
    });
    expect(preview.state).toBe("INVALID");
    expect(preview.issues[0]).toBeTruthy();
  });

  it("confirmMt5Upload persists a real, selectable import for a READY file", async () => {
    const user = await makeUser("confirm-ready");
    const result = await confirmMt5Upload(user.id, {
      fileContentBase64: base64Of(mt5Csv(5)),
      fileName: "XAUUSD_M1.csv",
      sourceSymbol: "XAUUSD.a",
      timeframeHint: "1m",
      timeConvention: { kind: "UTC" },
      canonicalSymbol: "XAUUSD",
    });
    expect(result.status).toBe("IMPORTED");
    if (result.status !== "IMPORTED") return;
    expect(result.import.canonicalSymbol).toBe("XAUUSD");
    expect(result.import.candleCount).toBe(5);

    const listed = await listMt5Imports(user.id);
    expect(listed.some((i) => i.id === result.import.id)).toBe(true);
  });

  it("confirmMt5Upload refuses a canonicalSymbol that doesn't match the file's own resolution", async () => {
    const user = await makeUser("confirm-mismatch");
    const result = await confirmMt5Upload(user.id, {
      fileContentBase64: base64Of(mt5Csv(5)),
      fileName: "XAUUSD_M1.csv",
      sourceSymbol: "XAUUSD.a",
      timeframeHint: "1m",
      timeConvention: { kind: "UTC" },
      canonicalSymbol: "EURUSD",
    });
    expect(result.status).toBe("ERROR");
  });

  it("confirmMt5Upload warns on overlap instead of silently duplicating coverage, then imports once accepted (§13)", async () => {
    const user = await makeUser("confirm-overlap");
    const first = await confirmMt5Upload(user.id, {
      fileContentBase64: base64Of(mt5Csv(5)),
      fileName: "XAUUSD_M1.csv",
      sourceSymbol: "XAUUSD.a",
      timeframeHint: "1m",
      timeConvention: { kind: "UTC" },
      canonicalSymbol: "XAUUSD",
    });
    expect(first.status).toBe("IMPORTED");

    const second = await confirmMt5Upload(user.id, {
      fileContentBase64: base64Of(mt5Csv(5)),
      fileName: "XAUUSD_M1_again.csv",
      sourceSymbol: "XAUUSD.a",
      timeframeHint: "1m",
      timeConvention: { kind: "UTC" },
      canonicalSymbol: "XAUUSD",
    });
    expect(second.status).toBe("OVERLAP_CONFIRMATION_REQUIRED");

    const third = await confirmMt5Upload(user.id, {
      fileContentBase64: base64Of(mt5Csv(5)),
      fileName: "XAUUSD_M1_again.csv",
      sourceSymbol: "XAUUSD.a",
      timeframeHint: "1m",
      timeConvention: { kind: "UTC" },
      canonicalSymbol: "XAUUSD",
      allowOverlap: true,
    });
    expect(third.status).toBe("IMPORTED");

    const listed = await listMt5Imports(user.id);
    expect(listed.filter((i) => i.canonicalSymbol === "XAUUSD")).toHaveLength(2);
  });
});

describe("full round trip with realistic fixtures — R2 chunk serialization exercised for real (§7 hardening)", () => {
  // A REAL in-memory R2 (read+write), unlike the write-only `sendMock`
  // default this file otherwise uses (the tests above only ever verify a
  // write happened, never read back) — this block overrides it locally so
  // `readMt5ImportCandles` exercises the exact same chunking/serialization
  // code production uses, not a stub.
  const store = new Map<string, string>();
  beforeEach(async () => {
    const { PutObjectCommand, GetObjectCommand, NoSuchKey } = await import("@aws-sdk/client-s3");
    store.clear();
    sendMock.mockReset();
    sendMock.mockImplementation(async (command: unknown) => {
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
  });

  const FIXTURES_DIR = join(__dirname, "..", "..", "domain", "mt5-import", "__fixtures__");
  function readFixture(name: string): string {
    return readFileSync(join(FIXTURES_DIR, name), "utf-8");
  }
  function base64Of(text: string): string {
    return Buffer.from(text, "utf-8").toString("base64");
  }

  it("EURUSD fixture: candles read back from R2 are byte-equivalent to what was imported", async () => {
    const user = await makeUser("roundtrip-eurusd");
    const text = readFixture("eurusd-m1-tab.txt");
    const result = await confirmMt5Upload(user.id, {
      fileContentBase64: base64Of(text),
      fileName: "eurusd-m1-tab.txt",
      sourceSymbol: "EURUSD",
      timeframeHint: "M1",
      timeConvention: { kind: "UTC" },
      canonicalSymbol: "EURUSD",
    });
    expect(result.status).toBe("IMPORTED");
    if (result.status !== "IMPORTED") return;
    expect(result.import.candleCount).toBe(40);

    const from = new Date(result.import.rangeFrom).getTime();
    const to = new Date(result.import.rangeTo).getTime();
    const readBack = await readMt5ImportCandles(user.id, result.import.id, from, to);
    expect(readBack).toHaveLength(40);
    // Exact equivalence — no precision loss, no reordering, no duplication
    // across the R2 chunk write/read boundary.
    expect(readBack[0]).toEqual({ timestamp: from, open: 1.173, high: 1.17311, low: 1.17286, close: 1.17303, volume: 0 });
    for (let i = 1; i < readBack.length; i++) expect(readBack[i].timestamp - readBack[i - 1].timestamp).toBe(60_000);
  });

  it("XAUUSD fixture: candles read back from R2 preserve exact 2-decimal precision", async () => {
    const user = await makeUser("roundtrip-xauusd");
    const text = readFixture("xauusd-m1-comma.csv");
    const result = await confirmMt5Upload(user.id, {
      fileContentBase64: base64Of(text),
      fileName: "xauusd-m1-comma.csv",
      sourceSymbol: "XAUUSD",
      timeframeHint: "M1",
      timeConvention: { kind: "UTC" },
      canonicalSymbol: "XAUUSD",
    });
    expect(result.status).toBe("IMPORTED");
    if (result.status !== "IMPORTED") return;

    const from = new Date(result.import.rangeFrom).getTime();
    const to = new Date(result.import.rangeTo).getTime();
    const readBack = await readMt5ImportCandles(user.id, result.import.id, from, to);
    expect(readBack).toHaveLength(40);
    expect(readBack[0].open).toBe(3748.12);
    expect(readBack[0].high).toBe(3748.29);
    expect(readBack[0].low).toBe(3747.24);
    expect(readBack[0].close).toBe(3747.39);
  });

  it("chunk boundary spanning two calendar months round-trips correctly (writeCandleChunks' own month-keying exercised for real)", async () => {
    const user = await makeUser("roundtrip-month-boundary");
    // 10 candles either side of a real month boundary (Jan 31 -> Feb 1).
    const cs: Candle[] = [];
    const start = Date.UTC(2026, 0, 31, 23, 55);
    for (let i = 0; i < 20; i++) {
      cs.push({ timestamp: start + i * 60_000, open: 1.1, high: 1.11, low: 1.09, close: 1.1 + i * 0.0001, volume: null });
    }
    const q = analyzeMarketDataQuality(cs, "1m", cs[0].timestamp, cs[cs.length - 1].timestamp);
    const created = await createMt5Import(user.id, {
      sourceSymbol: "EURUSD",
      canonicalSymbol: "EURUSD",
      nativeTimeframe: "1m",
      timeConvention: { kind: "UTC" },
      candles: cs,
      quality: q,
      status: "READY",
    });

    const readBack = await readMt5ImportCandles(user.id, created.id, cs[0].timestamp, cs[cs.length - 1].timestamp);
    expect(readBack).toHaveLength(20);
    expect(readBack).toEqual(cs);
  });
});
