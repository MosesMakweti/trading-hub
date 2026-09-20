import { describe, expect, it } from "vitest";

import { parseTradingViewSymbol } from "./symbol-parser";

describe("parseTradingViewSymbol", () => {
  it("splits a common forex EXCHANGE:SYMBOL pair", () => {
    expect(parseTradingViewSymbol("OANDA:XAUUSD")).toEqual({ raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" });
  });

  it("splits an FX-prefixed pair", () => {
    expect(parseTradingViewSymbol("FX:EURUSD")).toEqual({ raw: "FX:EURUSD", display: "EURUSD", exchange: "FX" });
  });

  it("preserves a continuous-futures contract suffix as part of the display symbol, not the exchange", () => {
    expect(parseTradingViewSymbol("CME_MINI:ES1!")).toEqual({ raw: "CME_MINI:ES1!", display: "ES1!", exchange: "CME_MINI" });
  });

  it("preserves a COMEX futures contract unchanged", () => {
    expect(parseTradingViewSymbol("COMEX:GC1!")).toEqual({ raw: "COMEX:GC1!", display: "GC1!", exchange: "COMEX" });
  });

  it("treats a bare symbol with no exchange prefix as display == raw, exchange null", () => {
    expect(parseTradingViewSymbol("XAUUSD")).toEqual({ raw: "XAUUSD", display: "XAUUSD", exchange: null });
  });

  it("trims surrounding whitespace", () => {
    expect(parseTradingViewSymbol("  OANDA:XAUUSD  ")).toEqual({ raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" });
  });

  it("degrades a malformed 'EXCHANGE:' with nothing after the colon to a bare symbol, never an empty display", () => {
    expect(parseTradingViewSymbol("OANDA:")).toEqual({ raw: "OANDA:", display: "OANDA:", exchange: null });
  });

  it("degrades a malformed ':SYMBOL' with nothing before the colon to a bare symbol, never an invented exchange", () => {
    expect(parseTradingViewSymbol(":XAUUSD")).toEqual({ raw: ":XAUUSD", display: ":XAUUSD", exchange: null });
  });

  it("only splits on the FIRST colon", () => {
    expect(parseTradingViewSymbol("OANDA:XAU:USD")).toEqual({ raw: "OANDA:XAU:USD", display: "XAU:USD", exchange: "OANDA" });
  });
});
