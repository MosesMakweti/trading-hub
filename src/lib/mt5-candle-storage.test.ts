import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoSuchKey } from "@aws-sdk/client-s3";

import { deleteImportChunks, monthKeysForRange, readCandleChunksInRange, writeCandleChunks } from "@/lib/mt5-candle-storage";
import type { Candle } from "@/domain/market-data/candle";

const sendMock = vi.fn();
vi.mock("@/lib/r2", () => ({
  getR2: vi.fn(() => ({ client: { send: sendMock }, bucket: "test-bucket" })),
}));

function candle(ms: number): Candle {
  return { timestamp: ms, open: 100, high: 101, low: 99, close: 100.5, volume: null };
}

function bodyOf(obj: unknown) {
  return { Body: { transformToString: async () => JSON.stringify(obj) } };
}

beforeEach(() => {
  sendMock.mockReset();
});

describe("monthKeysForRange — Stage 21.3A §19", () => {
  it("returns a single key for a range fully inside one month", () => {
    expect(monthKeysForRange(Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 31))).toEqual(["2024-01"]);
  });

  it("returns every month a range spans, inclusive", () => {
    expect(monthKeysForRange(Date.UTC(2024, 0, 15), Date.UTC(2024, 2, 5))).toEqual(["2024-01", "2024-02", "2024-03"]);
  });

  it("correctly crosses a year boundary", () => {
    expect(monthKeysForRange(Date.UTC(2024, 11, 20), Date.UTC(2025, 0, 5))).toEqual(["2024-12", "2025-01"]);
  });

  it("returns an empty array for an inverted range", () => {
    expect(monthKeysForRange(Date.UTC(2024, 5, 1), Date.UTC(2024, 0, 1))).toEqual([]);
  });
});

describe("writeCandleChunks / readCandleChunksInRange — Stage 21.3A §18-19 (R2 transport mocked)", () => {
  it("groups candles by calendar month and writes one PutObject per month touched", async () => {
    sendMock.mockResolvedValue({});
    const candles = [candle(Date.UTC(2024, 0, 15)), candle(Date.UTC(2024, 0, 20)), candle(Date.UTC(2024, 1, 3))];
    const result = await writeCandleChunks("user1", "import1", candles);
    expect(result.chunksWritten).toBe(2); // Jan + Feb
    expect(sendMock).toHaveBeenCalledTimes(2);
    const keys = sendMock.mock.calls.map((c) => c[0].input.Key).sort();
    expect(keys).toEqual(["market-data-imports/user1/import1/2024-01.json", "market-data-imports/user1/import1/2024-02.json"]);
  });

  it("reads back only the candles within the requested range, sorted ascending", async () => {
    const janCandles = [candle(Date.UTC(2024, 0, 10)), candle(Date.UTC(2024, 0, 20))];
    sendMock.mockResolvedValueOnce(bodyOf(janCandles));
    const from = Date.UTC(2024, 0, 15);
    const to = Date.UTC(2024, 0, 31);
    const result = await readCandleChunksInRange("user1", "import1", from, to);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(Date.UTC(2024, 0, 20)); // the Jan 10 candle is outside [from,to]
  });

  it("skips a missing month chunk (NoSuchKey) rather than throwing", async () => {
    sendMock.mockRejectedValueOnce(new NoSuchKey({ message: "not found", $metadata: {} }));
    const result = await readCandleChunksInRange("user1", "import1", Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 31));
    expect(result).toEqual([]);
  });

  it("only requests the month objects actually overlapping the range — never the whole import", async () => {
    sendMock.mockResolvedValue(bodyOf([]));
    await readCandleChunksInRange("user1", "import1", Date.UTC(2024, 5, 1), Date.UTC(2024, 5, 30));
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input.Key).toBe("market-data-imports/user1/import1/2024-06.json");
  });
});

describe("deleteImportChunks — Stage 21.3A §22", () => {
  it("lists by the import's own prefix and deletes every object found", async () => {
    sendMock
      .mockResolvedValueOnce({ Contents: [{ Key: "market-data-imports/user1/import1/2024-01.json" }, { Key: "market-data-imports/user1/import1/2024-02.json" }] })
      .mockResolvedValue({});
    await deleteImportChunks("user1", "import1");
    expect(sendMock).toHaveBeenCalledTimes(3); // 1 list + 2 deletes
  });

  it("does nothing beyond the list call when the import has no chunks", async () => {
    sendMock.mockResolvedValueOnce({ Contents: [] });
    await deleteImportChunks("user1", "import1");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
