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

describe("micro/full-size futures identity (Stage 17B.1 §1-3) — never collapsed", () => {
  it("MGC stays MGC — never resolves to GC's canonicalSymbol", () => {
    expect(lookupInstrument("MGC")?.canonicalSymbol).toBe("MGC");
    expect(parseSymbol("MGC").spec?.canonicalSymbol).toBe("MGC");
  });

  it("GC stays GC", () => {
    expect(lookupInstrument("GC")?.canonicalSymbol).toBe("GC");
  });

  it("MES stays MES — never resolves to ES's canonicalSymbol", () => {
    expect(lookupInstrument("MES")?.canonicalSymbol).toBe("MES");
    expect(parseSymbol("MES").spec?.canonicalSymbol).toBe("MES");
  });

  it("ES stays ES", () => {
    expect(lookupInstrument("ES")?.canonicalSymbol).toBe("ES");
  });

  it("MNQ stays MNQ — never resolves to NQ's canonicalSymbol", () => {
    expect(lookupInstrument("MNQ")?.canonicalSymbol).toBe("MNQ");
    expect(parseSymbol("MNQ").spec?.canonicalSymbol).toBe("MNQ");
  });

  it("NQ stays NQ", () => {
    expect(lookupInstrument("NQ")?.canonicalSymbol).toBe("NQ");
  });

  it("each micro/full pair has independent, non-equal contract economics (tick value)", () => {
    expect(lookupInstrument("MGC")?.tickValue).not.toBe(lookupInstrument("GC")?.tickValue);
    expect(lookupInstrument("MES")?.tickValue).not.toBe(lookupInstrument("ES")?.tickValue);
    expect(lookupInstrument("MNQ")?.tickValue).not.toBe(lookupInstrument("NQ")?.tickValue);
  });

  it("each micro/full pair shares the same instrumentFamily (grouping only, never identity)", () => {
    expect(lookupInstrument("MGC")?.instrumentFamily).toBe(lookupInstrument("GC")?.instrumentFamily);
    expect(lookupInstrument("MES")?.instrumentFamily).toBe(lookupInstrument("ES")?.instrumentFamily);
    expect(lookupInstrument("MNQ")?.instrumentFamily).toBe(lookupInstrument("NQ")?.instrumentFamily);
  });

  it("resolves each micro's own TradingView continuous-contract suffix independently of its full-size sibling", () => {
    expect(parseSymbol("MES1!").spec?.canonicalSymbol).toBe("MES");
    expect(parseSymbol("MNQ1!").spec?.canonicalSymbol).toBe("MNQ");
    expect(parseSymbol("MGC1!").spec?.canonicalSymbol).toBe("MGC");
  });
});

describe("broker suffix normalization for OTC symbols (Stage 17C.2 §9/§10) — cosmetic wrapper, never a fuzzy matcher", () => {
  it("strips a dot-delimited account-tier suffix (XAUUSD.a -> XAUUSD)", () => {
    expect(parseSymbol("XAUUSD.a").spec?.canonicalSymbol).toBe("XAUUSD");
  });

  it("strips an Exness-style bare trailing micro-account marker (XAUUSDm -> XAUUSD)", () => {
    expect(parseSymbol("XAUUSDm").spec?.canonicalSymbol).toBe("XAUUSD");
  });

  it("strips a .raw suffix (EURUSD.raw -> EURUSD)", () => {
    expect(parseSymbol("EURUSD.raw").spec?.canonicalSymbol).toBe("EURUSD");
  });

  it("strips a bare 'm' suffix from EURUSD and GBPUSD independently, never cross-mapping", () => {
    expect(parseSymbol("EURUSDm").spec?.canonicalSymbol).toBe("EURUSD");
    expect(parseSymbol("GBPUSDm").spec?.canonicalSymbol).toBe("GBPUSD");
  });

  it("never invents a mapping for a suffix on a symbol that isn't already in the catalog", () => {
    const result = parseSymbol("NOTAREALSYMBOL.a");
    expect(result.spec).toBeNull();
  });

  it("preserves the raw original symbol verbatim even when a broker suffix was stripped", () => {
    const result = parseSymbol("XAUUSD.a");
    expect(result.originalSymbol).toBe("XAUUSD.a");
    expect(result.spec?.canonicalSymbol).toBe("XAUUSD");
  });

  it("a direct/alias match always wins over broker-suffix stripping — the fallback never overrides a successful direct lookup", () => {
    // "GOLD" already resolves via ALIASES directly; confirm the ordinary
    // alias path still wins (this also implicitly proves the fallback is
    // only ever consulted after a direct lookup fails, never instead of it).
    expect(parseSymbol("GOLD").spec?.canonicalSymbol).toBe("XAUUSD");
  });

  it("XAGUSD and XAUUSD each resolve their own broker-suffixed forms independently, never cross-mapping", () => {
    expect(parseSymbol("XAGUSD.a").spec?.canonicalSymbol).toBe("XAGUSD");
    expect(parseSymbol("XAUUSD.a").spec?.canonicalSymbol).toBe("XAUUSD");
  });
});
