import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoSuchKey } from "@aws-sdk/client-s3";

import {
  isDayFullyClosed,
  isMarketDataR2CacheEnabled,
  readCachedDay,
  writeCachedDay,
} from "@/server/services/market-data-cache";

const DAY_MS = 86_400_000;

const sendMock = vi.fn();

vi.mock("@/lib/r2", () => ({
  isR2Configured: vi.fn(() => true),
  getR2: vi.fn(() => ({ client: { send: sendMock }, bucket: "test-bucket" })),
}));

function validEnvelope(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    datasetId: "GLBX.MDP3",
    contractSymbol: "ESU6",
    dateKey: "2026-08-03",
    cachedAt: new Date().toISOString(),
    candles: [{ timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }],
    ...overrides,
  };
}

function bodyOf(obj: unknown) {
  return { Body: { transformToString: async () => JSON.stringify(obj) } };
}

describe("market-data-cache — R2 L2 cache (Stage 17B §21)", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("isMarketDataR2CacheEnabled", () => {
    it("is false when the flag is unset (default OFF pending licensing confirmation)", () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "");
      expect(isMarketDataR2CacheEnabled()).toBe(false);
    });

    it("is true only when the flag is exactly \"true\" AND R2 is configured", () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "true");
      expect(isMarketDataR2CacheEnabled()).toBe(true);
    });

    it("rejects a truthy-looking but non-exact value", () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "1");
      expect(isMarketDataR2CacheEnabled()).toBe(false);
    });
  });

  describe("isDayFullyClosed", () => {
    it("is false for today", () => {
      const now = Date.UTC(2026, 7, 5, 12, 0, 0);
      const today = Date.UTC(2026, 7, 5);
      expect(isDayFullyClosed(today, now)).toBe(false);
    });

    it("is false for yesterday (Databento's ~T+1 publication lag buffer)", () => {
      const now = Date.UTC(2026, 7, 5, 12, 0, 0);
      const yesterday = Date.UTC(2026, 7, 4);
      expect(isDayFullyClosed(yesterday, now)).toBe(false);
    });

    it("is true for a day two or more full days in the past", () => {
      const now = Date.UTC(2026, 7, 5, 12, 0, 0);
      const twoDaysAgo = Date.UTC(2026, 7, 3);
      expect(isDayFullyClosed(twoDaysAgo, now)).toBe(true);
    });
  });

  describe("readCachedDay", () => {
    it("is a no-op (returns null, never calls R2) when the cache is disabled", async () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "");
      const result = await readCachedDay("GLBX.MDP3", "ESU6", "2026-08-03");
      expect(result).toBeNull();
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("returns the cached candles on a valid hit, using the exact documented key shape", async () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce(bodyOf(validEnvelope()));
      const result = await readCachedDay("GLBX.MDP3", "ESU6", "2026-08-03");
      expect(result).toEqual(validEnvelope().candles);
      const command = sendMock.mock.calls[0][0];
      expect(command.input.Key).toBe("market-data/databento/GLBX.MDP3/ESU6/1m/2026-08-03.json");
    });

    it("treats a missing key as a plain cache miss (NoSuchKey), never an error", async () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "true");
      sendMock.mockRejectedValueOnce(new NoSuchKey({ message: "not found", $metadata: {} }));
      const result = await readCachedDay("GLBX.MDP3", "ESU6", "2026-08-03");
      expect(result).toBeNull();
    });

    it("discards an entry with a mismatched contract/date rather than trusting it", async () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce(bodyOf(validEnvelope({ contractSymbol: "ESZ6" })));
      const result = await readCachedDay("GLBX.MDP3", "ESU6", "2026-08-03");
      expect(result).toBeNull();
    });

    it("discards an entry with a stale schema version", async () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce(bodyOf(validEnvelope({ schemaVersion: 99 })));
      const result = await readCachedDay("GLBX.MDP3", "ESU6", "2026-08-03");
      expect(result).toBeNull();
    });

    it("discards an entry whose candles are out of order (corrupt) rather than serving bad data", async () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "true");
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
      const result = await readCachedDay("GLBX.MDP3", "ESU6", "2026-08-03");
      expect(result).toBeNull();
    });

    it("discards an entry with duplicate timestamps", async () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce(
        bodyOf(
          validEnvelope({
            candles: [
              { timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
              { timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
            ],
          }),
        ),
      );
      const result = await readCachedDay("GLBX.MDP3", "ESU6", "2026-08-03");
      expect(result).toBeNull();
    });

    it("discards unparseable JSON without throwing", async () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce({ Body: { transformToString: async () => "{not json" } });
      const result = await readCachedDay("GLBX.MDP3", "ESU6", "2026-08-03");
      expect(result).toBeNull();
    });
  });

  describe("writeCachedDay", () => {
    it("is a no-op when the cache is disabled", async () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "");
      await writeCachedDay("GLBX.MDP3", "ESU6", "2026-08-03", []);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("writes an envelope under the documented key shape when enabled", async () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce({});
      const candles = [{ timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }];
      await writeCachedDay("GLBX.MDP3", "ESU6", "2026-08-03", candles);
      expect(sendMock).toHaveBeenCalledTimes(1);
      const command = sendMock.mock.calls[0][0];
      expect(command.input.Key).toBe("market-data/databento/GLBX.MDP3/ESU6/1m/2026-08-03.json");
      const written = JSON.parse(command.input.Body);
      expect(written.schemaVersion).toBe(1);
      expect(written.candles).toEqual(candles);
    });

    it("never throws when the underlying write fails (non-fatal)", async () => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "true");
      sendMock.mockRejectedValueOnce(new Error("network down"));
      await expect(writeCachedDay("GLBX.MDP3", "ESU6", "2026-08-03", [])).resolves.toBeUndefined();
    });
  });

  describe("micro/full-size contract keys never collide (Stage 17B.1 §18)", () => {
    it.each([
      ["GC", "GCQ6", "MGC", "MGCQ6"],
      ["ES", "ESU6", "MES", "MESU6"],
      ["NQ", "NQU6", "MNQ", "MNQU6"],
    ])("%s (%s) and %s (%s) on the same date write/read completely independent keys", async (_full, fullContract, _micro, microContract) => {
      vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "true");
      sendMock.mockResolvedValueOnce({});
      sendMock.mockResolvedValueOnce({});
      await writeCachedDay("GLBX.MDP3", fullContract, "2026-08-03", [{ timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
      await writeCachedDay("GLBX.MDP3", microContract, "2026-08-03", [{ timestamp: 1000, open: 9, high: 9, low: 9, close: 9, volume: 1 }]);

      const keys = sendMock.mock.calls.map((call) => call[0].input.Key);
      expect(keys[0]).toBe(`market-data/databento/GLBX.MDP3/${fullContract}/1m/2026-08-03.json`);
      expect(keys[1]).toBe(`market-data/databento/GLBX.MDP3/${microContract}/1m/2026-08-03.json`);
      expect(keys[0]).not.toBe(keys[1]);

      // A read for the micro's key must never be satisfied by the full-size envelope, and vice versa.
      sendMock.mockReset();
      sendMock.mockResolvedValueOnce(bodyOf(validEnvelope({ contractSymbol: fullContract })));
      const crossRead = await readCachedDay("GLBX.MDP3", microContract, "2026-08-03");
      expect(crossRead).toBeNull(); // envelope's contractSymbol (full) mismatches the requested key (micro)
    });
  });
});

void DAY_MS;
