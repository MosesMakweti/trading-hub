import { describe, expect, it } from "vitest";

import { lookupInstrument, parseSymbol } from "@/domain/trade-plan/instrument-catalog";

describe("parseSymbol", () => {
  it("resolves a broker-prefixed forex symbol", () => {
    const result = parseSymbol("OANDA:EURUSD");
    expect(result.dataSource).toBe("OANDA");
    expect(result.cleanedSymbol).toBe("EURUSD");
    expect(result.spec?.canonicalSymbol).toBe("EURUSD");
    expect(result.spec?.assetClass).toBe("FOREX");
  });

  it("resolves an unprefixed symbol", () => {
    const result = parseSymbol("FX:EURUSD");
    expect(result.dataSource).toBe("FX");
    expect(result.spec?.canonicalSymbol).toBe("EURUSD");
  });

  it("strips a TradingView perpetual-swap suffix", () => {
    const result = parseSymbol("EURUSD.P");
    expect(result.cleanedSymbol).toBe("EURUSD");
    expect(result.spec?.canonicalSymbol).toBe("EURUSD");
  });

  it("maps a broker-specific alias (CAPITALCOM:GOLD -> XAUUSD)", () => {
    const result = parseSymbol("CAPITALCOM:GOLD");
    expect(result.spec?.canonicalSymbol).toBe("XAUUSD");
    expect(result.spec?.assetClass).toBe("METALS");
  });

  it("resolves a bare index alias (US100 -> NAS100)", () => {
    const result = parseSymbol("US100");
    expect(result.spec?.canonicalSymbol).toBe("NAS100");
  });

  it("strips a continuous-futures suffix and resolves the root (NQ1! -> NQ)", () => {
    const result = parseSymbol("NQ1!");
    expect(result.cleanedSymbol).toBe("NQ");
    expect(result.spec?.canonicalSymbol).toBe("NQ");
    expect(result.spec?.assetClass).toBe("FUTURES");
  });

  it("resolves an exchange-prefixed continuous future (CME_MINI:NQ1!)", () => {
    const result = parseSymbol("CME_MINI:NQ1!");
    expect(result.dataSource).toBe("CME_MINI");
    expect(result.spec?.canonicalSymbol).toBe("NQ");
  });

  it("returns a null spec for an unmapped symbol instead of guessing", () => {
    const result = parseSymbol("SOMEWEIRDTICKER");
    expect(result.spec).toBeNull();
    expect(result.originalSymbol).toBe("SOMEWEIRDTICKER");
    expect(result.cleanedSymbol).toBe("SOMEWEIRDTICKER");
  });

  it("preserves the original raw symbol verbatim even when mapped", () => {
    const result = parseSymbol("  oanda:eurusd  ");
    expect(result.originalSymbol).toBe("  oanda:eurusd  ");
  });
});

describe("lookupInstrument", () => {
  it("finds a canonical symbol case-insensitively", () => {
    expect(lookupInstrument("eurusd")?.canonicalSymbol).toBe("EURUSD");
  });

  it("returns null for an unknown symbol", () => {
    expect(lookupInstrument("NOTREAL")).toBeNull();
  });
});
