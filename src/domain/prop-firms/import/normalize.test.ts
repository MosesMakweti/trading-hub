import { describe, expect, it } from "vitest";

import {
  computeExecutionFingerprint,
  computeTransactionFingerprint,
  dedupeKeyForExecution,
  dedupeKeyForTransaction,
  localWallClockToUtc,
  normalizeSide,
  normalizeSymbol,
  parseGenericDateTime,
  parseLocaleNumber,
  parseMtDateTime,
} from "./normalize";

describe("parseLocaleNumber", () => {
  it("parses plain dot-decimal numbers", () => {
    expect(parseLocaleNumber("1234.56")).toBe("1234.56");
  });

  it("parses comma-decimal numbers with dot-thousands", () => {
    expect(parseLocaleNumber("1.234.567,89")).toBe("1234567.89");
  });

  it("parses dot-decimal numbers with comma-thousands", () => {
    expect(parseLocaleNumber("1,234,567.89")).toBe("1234567.89");
  });

  it("treats a lone comma as decimal (no thousands grouping)", () => {
    expect(parseLocaleNumber("1234,56")).toBe("1234.56");
  });

  it("handles a leading minus sign", () => {
    expect(parseLocaleNumber("-1234.56")).toBe("-1234.56");
  });

  it("handles a trailing minus sign", () => {
    expect(parseLocaleNumber("1234.56-")).toBe("-1234.56");
  });

  it("handles parenthesized negatives", () => {
    expect(parseLocaleNumber("(1234.56)")).toBe("-1234.56");
  });

  it("strips currency symbols and whitespace", () => {
    expect(parseLocaleNumber("$ 1,234.56")).toBe("1234.56");
  });

  it("throws on an empty value", () => {
    expect(() => parseLocaleNumber("")).toThrow();
    expect(() => parseLocaleNumber("   ")).toThrow();
  });
});

describe("normalizeSide", () => {
  it("maps buy variants to LONG", () => {
    expect(normalizeSide("Buy")).toBe("LONG");
    expect(normalizeSide("buy limit")).toBe("LONG");
    expect(normalizeSide("BOUGHT")).toBe("LONG");
  });

  it("maps sell variants to SHORT", () => {
    expect(normalizeSide("Sell")).toBe("SHORT");
    expect(normalizeSide("sell stop")).toBe("SHORT");
  });

  it("returns null for an unrecognized label", () => {
    expect(normalizeSide("balance")).toBeNull();
  });
});

describe("normalizeSymbol", () => {
  it("uppercases and strips a known broker suffix", () => {
    expect(normalizeSymbol("eurusd.a")).toBe("EURUSD");
    expect(normalizeSymbol("EURUSD_i")).toBe("EURUSD");
  });

  it("never touches a futures contract code", () => {
    expect(normalizeSymbol("ESZ25")).toBe("ESZ25");
    expect(normalizeSymbol("MESH24")).toBe("MESH24");
  });

  it("leaves an already-plain symbol unchanged (uppercased)", () => {
    expect(normalizeSymbol("gbpjpy")).toBe("GBPJPY");
  });
});

describe("localWallClockToUtc", () => {
  it("converts a fixed-offset zone correctly", () => {
    // Etc/GMT-2 is UTC+2 (POSIX sign is inverted for this zone family).
    const result = localWallClockToUtc(2026, 6, 15, 14, 30, 0, "Etc/GMT-2");
    expect(result.toISOString()).toBe("2026-06-15T12:30:00.000Z");
  });

  it("round-trips UTC itself", () => {
    const result = localWallClockToUtc(2026, 1, 1, 0, 0, 0, "UTC");
    expect(result.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("handles a DST-observing zone in summer", () => {
    // America/New_York is UTC-4 in summer (EDT).
    const result = localWallClockToUtc(2026, 7, 1, 9, 0, 0, "America/New_York");
    expect(result.toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("handles the same zone in winter (different offset)", () => {
    // America/New_York is UTC-5 in winter (EST).
    const result = localWallClockToUtc(2026, 1, 1, 9, 0, 0, "America/New_York");
    expect(result.toISOString()).toBe("2026-01-01T14:00:00.000Z");
  });
});

describe("parseMtDateTime", () => {
  it("parses the standard MT4/MT5 dot-separated format", () => {
    const result = parseMtDateTime("2026.06.15 14:30:00", "UTC");
    expect(result.toISOString()).toBe("2026-06-15T14:30:00.000Z");
  });

  it("parses without seconds", () => {
    const result = parseMtDateTime("2026.06.15 14:30", "UTC");
    expect(result.toISOString()).toBe("2026-06-15T14:30:00.000Z");
  });

  it("throws on garbage input", () => {
    expect(() => parseMtDateTime("not a date", "UTC")).toThrow();
  });
});

describe("parseGenericDateTime", () => {
  it("parses ISO-style datetimes", () => {
    const result = parseGenericDateTime("2026-06-15 14:30:00", "UTC");
    expect(result.toISOString()).toBe("2026-06-15T14:30:00.000Z");
  });

  it("parses US-style datetimes with AM/PM", () => {
    const result = parseGenericDateTime("6/15/2026 2:30:00 PM", "UTC");
    expect(result.toISOString()).toBe("2026-06-15T14:30:00.000Z");
  });

  it("falls back to the MT pattern", () => {
    const result = parseGenericDateTime("2026.06.15 14:30:00", "UTC");
    expect(result.toISOString()).toBe("2026-06-15T14:30:00.000Z");
  });
});

describe("fingerprints and dedupe keys", () => {
  const baseExecution = {
    accountId: "acct-1",
    instrumentNormalized: "EURUSD",
    direction: "LONG" as const,
    quantity: "1.00",
    price: "1.10500",
    executedAt: new Date("2026-06-15T14:30:00.000Z"),
    currency: "USD",
  };

  it("produces the same execution fingerprint for identical input", () => {
    expect(computeExecutionFingerprint(baseExecution)).toBe(computeExecutionFingerprint({ ...baseExecution }));
  });

  it("produces a different execution fingerprint when any field differs", () => {
    const fp1 = computeExecutionFingerprint(baseExecution);
    const fp2 = computeExecutionFingerprint({ ...baseExecution, price: "1.10600" });
    expect(fp1).not.toBe(fp2);
  });

  it("normalizes decimal formatting before hashing (1.1 === 1.10)", () => {
    const fp1 = computeExecutionFingerprint({ ...baseExecution, quantity: "1.0" });
    const fp2 = computeExecutionFingerprint({ ...baseExecution, quantity: "1.00" });
    expect(fp1).toBe(fp2);
  });

  it("prefers a platform id over the fingerprint for the execution dedupe key", () => {
    const fp = computeExecutionFingerprint(baseExecution);
    const key = dedupeKeyForExecution({ executionId: "12345", orderId: null, dealId: null }, fp);
    expect(key).toBe("exec:id:12345");
  });

  it("falls back to the fingerprint when no platform id exists", () => {
    const fp = computeExecutionFingerprint(baseExecution);
    const key = dedupeKeyForExecution({ executionId: null, orderId: null, dealId: null }, fp);
    expect(key).toBe(`exec:fp:${fp}`);
  });

  it("computes a stable transaction fingerprint", () => {
    const input = { accountId: "acct-1", rawType: "Withdrawal", amount: "-500.00", currency: "USD", occurredAt: new Date("2026-06-15T00:00:00.000Z") };
    expect(computeTransactionFingerprint(input)).toBe(computeTransactionFingerprint({ ...input }));
  });

  it("prefers a platform transaction id for the transaction dedupe key", () => {
    const fp = computeTransactionFingerprint({
      accountId: "acct-1",
      rawType: "Withdrawal",
      amount: "-500.00",
      currency: "USD",
      occurredAt: new Date("2026-06-15T00:00:00.000Z"),
    });
    expect(dedupeKeyForTransaction("999", fp)).toBe("txn:id:999");
    expect(dedupeKeyForTransaction(null, fp)).toBe(`txn:fp:${fp}`);
  });
});
