import { describe, expect, it } from "vitest";

import {
  canonicalDecimal,
  classifyDealType,
  isBalanceOperation,
  normalizeDeal,
  normalizeOrder,
  parseDealEntry,
  payloadHash,
  stopField,
} from "./deal-classification";

describe("classifyDealType", () => {
  it("maps trade and balance deal types", () => {
    expect(classifyDealType("DEAL_TYPE_BUY")).toEqual({ category: "TRADE", side: "BUY" });
    expect(classifyDealType("DEAL_TYPE_SELL")).toEqual({ category: "TRADE", side: "SELL" });
    expect(classifyDealType("DEAL_TYPE_BALANCE").category).toBe("BALANCE");
    expect(classifyDealType("DEAL_TYPE_CREDIT").category).toBe("CREDIT");
    expect(classifyDealType("DEAL_TYPE_CHARGE").category).toBe("CHARGE");
    expect(classifyDealType("DEAL_TYPE_COMMISSION_DAILY").category).toBe("COMMISSION");
    expect(classifyDealType("DEAL_TYPE_SELL_CANCELED")).toEqual({ category: "TRADE_CANCELED", side: "SELL" });
    expect(classifyDealType("DEAL_TAX").category).toBe("TAX");
  });

  it("never guesses an unknown type", () => {
    expect(classifyDealType("DEAL_TYPE_SOMETHING_NEW")).toEqual({ category: "UNKNOWN", side: null });
  });

  it("balance operations vs trades", () => {
    expect(isBalanceOperation("BALANCE")).toBe(true);
    expect(isBalanceOperation("CREDIT")).toBe(true);
    expect(isBalanceOperation("TRADE")).toBe(false);
    expect(isBalanceOperation("UNKNOWN")).toBe(false);
  });

  it("parses entries", () => {
    expect(parseDealEntry("DEAL_ENTRY_IN")).toBe("IN");
    expect(parseDealEntry("DEAL_ENTRY_OUT_BY")).toBe("OUT_BY");
    expect(parseDealEntry("DEAL_ENTRY_STATE")).toBeNull();
    expect(parseDealEntry(undefined)).toBeNull();
  });
});

describe("decimals", () => {
  it("canonicalizes without float conversion", () => {
    expect(canonicalDecimal("0010.2500")).toBe("10.25");
    expect(canonicalDecimal("-0.000")).toBe("0");
    expect(canonicalDecimal("123456789012345678.123456789012")).toBe("123456789012345678.123456789012");
    expect(() => canonicalDecimal("1e5")).toThrow();
    expect(() => canonicalDecimal("1,5")).toThrow();
  });

  it("stop fields: 0 means explicitly none, empty means absent", () => {
    expect(stopField("0.00000")).toEqual({ state: "NONE", level: null });
    expect(stopField(null)).toEqual({ state: "ABSENT", level: null });
    expect(stopField("1.08500")).toEqual({ state: "SET", level: "1.085" });
  });
});

describe("normalizeDeal", () => {
  const base = { ticket: "123", order: "456", positionId: "456", timeMsc: "1700000000123", symbol: "XAUUSD", volume: "0.10", price: "1950.55" };

  it("normalizes a trade deal and keeps string tickets", () => {
    const r = normalizeDeal({ ...base, type: "DEAL_TYPE_BUY", entry: "DEAL_ENTRY_IN", commission: "-0.70" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.timeMsc).toBe(BigInt("1700000000123"));
    expect(r.value.ticket).toBe("123");
    expect(r.value.commission).toBe("-0.7");
    expect(r.value.profit).toBe("0");
    expect(r.value.side).toBe("BUY");
  });

  it("keeps ulong-sized tickets exactly", () => {
    const r = normalizeDeal({ ...base, ticket: "18446744073709551615", type: "DEAL_TYPE_BALANCE", positionId: "0", symbol: "", volume: null, price: null, profit: "100" });
    expect(r.ok && r.value.ticket).toBe("18446744073709551615");
  });

  it("balance deals carry no position", () => {
    const r = normalizeDeal({ ticket: "9", timeMsc: 1, type: "DEAL_TYPE_BALANCE", positionId: "0", profit: "5000.00", comment: "Deposit" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.category).toBe("BALANCE");
    expect(r.value.positionId).toBeNull();
    expect(r.value.profit).toBe("5000");
  });

  it("rejects trade deals that would force a guess", () => {
    expect(normalizeDeal({ ...base, type: "DEAL_TYPE_BUY" }).ok).toBe(false); // no entry
    expect(normalizeDeal({ ...base, type: "DEAL_TYPE_BUY", entry: "DEAL_ENTRY_IN", positionId: "0" }).ok).toBe(false);
    expect(normalizeDeal({ ...base, type: "DEAL_TYPE_BUY", entry: "DEAL_ENTRY_IN", volume: "0" }).ok).toBe(false);
  });

  it("payload hash ignores key order", () => {
    expect(payloadHash({ a: 1, b: "2" })).toBe(payloadHash({ b: "2", a: 1 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });
});

describe("normalizeOrder", () => {
  it("normalizes a history order", () => {
    const r = normalizeOrder({ ticket: "456", positionId: "456", type: "ORDER_TYPE_BUY", state: "ORDER_STATE_FILLED", timeSetupMsc: 1, timeDoneMsc: "2", sl: "1950.0", volumeInitial: "0.10" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stopLoss).toBe("1950");
    expect(r.value.timeDoneMsc).toBe(BigInt(2));
  });
});
