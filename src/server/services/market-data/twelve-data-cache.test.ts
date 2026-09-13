import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoSuchKey } from "@aws-sdk/client-s3";

import {
  isDayFullyClosed,
  isTwelveDataR2CacheEnabled,
  purgeAllTwelveDataCache,
  readCachedDay,
  TWELVE_DATA_CACHE_PREFIX,
  writeCachedDay,
} from "@/server/services/market-data/twelve-data-cache";

const sendMock = vi.fn();

vi.mock("@/lib/r2", () => ({
  isR2Configured: vi.fn(() => true),
  getR2: vi.fn(() => ({ client: { send: sendMock }, bucket: "test-bucket" })),
}));

function validEnvelope(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    provider: "twelvedata",
    priceBasis: "AGGREGATED",
    providerSymbol: "EUR/USD",
    dateKey: "2026-08-03",
    cachedAt: new Date().toISOString(),
    candles: [{ timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }],
    ...overrides,
  };
}

function bodyOf(obj: unknown) {
  return { Body: { transformToString: async () => JSON.stringify(obj) } };
}

describe("twelve-data-cache — R2 L2 cache (Stage 17C.2 §22-25)", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("isTwelveDataR2CacheEnabled", () => {
    it("is false when the flag is unset (default OFF)", () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "");
      expect(isTwelveDataR2CacheEnabled()).toBe(false);
    });

    it('is true only when the flag is exactly "true" AND R2 is configured', () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      expect(isTwelveDataR2CacheEnabled()).toBe(true);
    });

    it("rejects a truthy-looking but non-exact value", () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "1");
      expect(isTwelveDataR2CacheEnabled()).toBe(false);
    });
  });

  describe("isDayFullyClosed (reused from the Databento cache module — provider-agnostic)", () => {
    it("is false for today", () => {
      const now = Date.UTC(2026, 7, 5, 12, 0, 0);
      expect(isDayFullyClosed(Date.UTC(2026, 7, 5), now)).toBe(false);
    });

    it("is true for a day two or more full days in the past", () => {
      const now = Date.UTC(2026, 7, 5, 12, 0, 0);
      expect(isDayFullyClosed(Date.UTC(2026, 7, 3), now)).toBe(true);
    });
  });

  describe("readCachedDay", () => {
    it("is a no-op (returns null, never calls R2) when the cache is disabled", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "");
      const result = await readCachedDay("AGGREGATED", "EUR/USD", "2026-08-03");
      expect(result).toBeNull();
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("returns the cached candles on a valid hit, using the documented key shape (§22 — priceBasis participates)", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce(bodyOf(validEnvelope()));
      const result = await readCachedDay("AGGREGATED", "EUR/USD", "2026-08-03");
      expect(result).toEqual(validEnvelope().candles);
      const command = sendMock.mock.calls[0][0];
      expect(command.input.Key).toBe("market-data/twelvedata/AGGREGATED/EUR_USD/1m/2026-08-03.json");
    });

    it("sanitizes a slash-containing provider symbol into the key (no unpredictable extra nesting)", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce(bodyOf(validEnvelope({ providerSymbol: "XAU/USD" })));
      await readCachedDay("AGGREGATED", "XAU/USD", "2026-08-03");
      const command = sendMock.mock.calls[0][0];
      expect(command.input.Key).toBe("market-data/twelvedata/AGGREGATED/XAU_USD/1m/2026-08-03.json");
      expect(command.input.Key).not.toContain("XAU/USD");
    });

    it("treats a missing key as a plain cache miss (NoSuchKey), never an error", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      sendMock.mockRejectedValueOnce(new NoSuchKey({ message: "not found", $metadata: {} }));
      const result = await readCachedDay("AGGREGATED", "EUR/USD", "2026-08-03");
      expect(result).toBeNull();
    });

    it("discards an entry with a mismatched provider/symbol/basis rather than trusting it", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce(bodyOf(validEnvelope({ providerSymbol: "GBP/USD" })));
      const result = await readCachedDay("AGGREGATED", "EUR/USD", "2026-08-03");
      expect(result).toBeNull();
    });

    it('discards an entry whose "provider" field is not "twelvedata"', async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce(bodyOf(validEnvelope({ provider: "databento" })));
      const result = await readCachedDay("AGGREGATED", "EUR/USD", "2026-08-03");
      expect(result).toBeNull();
    });

    it("discards an entry with a stale schema version", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce(bodyOf(validEnvelope({ schemaVersion: 99 })));
      const result = await readCachedDay("AGGREGATED", "EUR/USD", "2026-08-03");
      expect(result).toBeNull();
    });

    it("discards an entry with duplicate/out-of-order timestamps rather than serving bad data", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce(
        bodyOf(
          validEnvelope({
            candles: [
              { timestamp: 2000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
              { timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
            ],
          }),
        ),
      );
      const result = await readCachedDay("AGGREGATED", "EUR/USD", "2026-08-03");
      expect(result).toBeNull();
    });

    it("discards unparseable JSON without throwing", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce({ Body: { transformToString: async () => "{not json" } });
      const result = await readCachedDay("AGGREGATED", "EUR/USD", "2026-08-03");
      expect(result).toBeNull();
    });
  });

  describe("writeCachedDay", () => {
    it("is a no-op when the cache is disabled", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "");
      await writeCachedDay("AGGREGATED", "EUR/USD", "2026-08-03", []);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("writes an envelope under the documented key shape when enabled", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce({});
      const candles = [{ timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }];
      await writeCachedDay("AGGREGATED", "EUR/USD", "2026-08-03", candles);
      expect(sendMock).toHaveBeenCalledTimes(1);
      const command = sendMock.mock.calls[0][0];
      expect(command.input.Key).toBe("market-data/twelvedata/AGGREGATED/EUR_USD/1m/2026-08-03.json");
      const written = JSON.parse(command.input.Body);
      expect(written.schemaVersion).toBe(1);
      expect(written.provider).toBe("twelvedata");
      expect(written.candles).toEqual(candles);
    });

    it("never throws when the underlying write fails (non-fatal)", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      sendMock.mockRejectedValueOnce(new Error("network down"));
      await expect(writeCachedDay("AGGREGATED", "EUR/USD", "2026-08-03", [])).resolves.toBeUndefined();
    });
  });

  describe("EURUSD and XAUUSD never collide (Stage 17C.2 §42)", () => {
    it("write/read for two different symbols on the same date+basis produce completely independent keys", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce({});
      sendMock.mockResolvedValueOnce({});
      await writeCachedDay("AGGREGATED", "EUR/USD", "2026-08-03", [{ timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
      await writeCachedDay("AGGREGATED", "XAU/USD", "2026-08-03", [{ timestamp: 1000, open: 2400, high: 2401, low: 2399, close: 2400.5, volume: 1 }]);

      const keys = sendMock.mock.calls.map((call) => call[0].input.Key);
      expect(keys[0]).toBe("market-data/twelvedata/AGGREGATED/EUR_USD/1m/2026-08-03.json");
      expect(keys[1]).toBe("market-data/twelvedata/AGGREGATED/XAU_USD/1m/2026-08-03.json");
      expect(keys[0]).not.toBe(keys[1]);
    });

    it("price basis participates in cache identity — MID and a hypothetical different basis never collide", async () => {
      vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce({});
      sendMock.mockResolvedValueOnce({});
      await writeCachedDay("AGGREGATED", "EUR/USD", "2026-08-03", []);
      await writeCachedDay("BID", "EUR/USD", "2026-08-03", []);
      const keys = sendMock.mock.calls.map((call) => call[0].input.Key);
      expect(keys[0]).toBe("market-data/twelvedata/AGGREGATED/EUR_USD/1m/2026-08-03.json");
      expect(keys[1]).toBe("market-data/twelvedata/BID/EUR_USD/1m/2026-08-03.json");
    });
  });

  describe("purgeAllTwelveDataCache (Stage 17C.2 §24/§25)", () => {
    it("refuses to run without the exact confirmation string", async () => {
      await expect(purgeAllTwelveDataCache("yes")).rejects.toThrow(/PURGE-TWELVEDATA-CACHE/);
      await expect(purgeAllTwelveDataCache("")).rejects.toThrow();
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("lists and deletes ONLY objects under the Twelve Data prefix — Databento's prefix is never listed (§42)", async () => {
      sendMock
        .mockResolvedValueOnce({
          Contents: [{ Key: `${TWELVE_DATA_CACHE_PREFIX}AGGREGATED/EUR_USD/1m/2026-08-03.json` }, { Key: `${TWELVE_DATA_CACHE_PREFIX}AGGREGATED/XAU_USD/1m/2026-08-03.json` }],
          IsTruncated: false,
        })
        .mockResolvedValueOnce({});

      const result = await purgeAllTwelveDataCache("PURGE-TWELVEDATA-CACHE");
      expect(result.deletedCount).toBe(2);

      const listCommand = sendMock.mock.calls[0][0];
      expect(listCommand.input.Prefix).toBe(TWELVE_DATA_CACHE_PREFIX);
      expect(listCommand.input.Prefix).not.toContain("databento");

      const deleteCommand = sendMock.mock.calls[1][0];
      const deletedKeys = deleteCommand.input.Delete.Objects.map((o: { Key: string }) => o.Key);
      expect(deletedKeys.every((k: string) => k.startsWith(TWELVE_DATA_CACHE_PREFIX))).toBe(true);
      expect(deletedKeys.some((k: string) => k.includes("databento"))).toBe(false);
    });

    it("paginates through a truncated listing and deletes every page", async () => {
      sendMock
        .mockResolvedValueOnce({ Contents: [{ Key: `${TWELVE_DATA_CACHE_PREFIX}a.json` }], IsTruncated: true, NextContinuationToken: "tok1" })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Contents: [{ Key: `${TWELVE_DATA_CACHE_PREFIX}b.json` }], IsTruncated: false })
        .mockResolvedValueOnce({});

      const result = await purgeAllTwelveDataCache("PURGE-TWELVEDATA-CACHE");
      expect(result.deletedCount).toBe(2);
      expect(sendMock).toHaveBeenCalledTimes(4); // list, delete, list, delete
    });

    it("does nothing (no delete call) when there are no matching objects", async () => {
      sendMock.mockResolvedValueOnce({ Contents: [], IsTruncated: false });
      const result = await purgeAllTwelveDataCache("PURGE-TWELVEDATA-CACHE");
      expect(result.deletedCount).toBe(0);
      expect(sendMock).toHaveBeenCalledTimes(1); // list only, no delete
    });
  });
});
