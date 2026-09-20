import { describe, expect, it } from "vitest";

import { isAssetCompatible } from "./asset-compatibility";

describe("isAssetCompatible", () => {
  it("matches an exact display symbol", () => {
    expect(isAssetCompatible("XAUUSD", ["XAUUSD", "EURUSD"])).toBe(true);
  });

  it("matches case-insensitively and trims whitespace", () => {
    expect(isAssetCompatible("xauusd", [" XAUUSD "])).toBe(true);
  });

  it("rejects an asset not in the configured list", () => {
    expect(isAssetCompatible("GBPUSD", ["XAUUSD", "EURUSD"])).toBe(false);
  });

  it("never partially/fuzzily matches — a substring is not a match", () => {
    expect(isAssetCompatible("XAUUSDT", ["XAUUSD"])).toBe(false);
    expect(isAssetCompatible("XAU", ["XAUUSD"])).toBe(false);
  });

  it("an empty configured-assets list means no constraint — everything is compatible", () => {
    expect(isAssetCompatible("ANYTHING", [])).toBe(true);
  });
});
