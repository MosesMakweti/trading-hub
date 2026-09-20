import { describe, expect, it } from "vitest";

import { hashRequestBody } from "@/server/api-idempotency";

describe("hashRequestBody", () => {
  it("is deterministic regardless of key order", () => {
    const a = hashRequestBody({ trade: { assetSymbol: "XAUUSD", direction: "LONG" } });
    const b = hashRequestBody({ trade: { direction: "LONG", assetSymbol: "XAUUSD" } });
    expect(a).toBe(b);
  });

  it("differs for genuinely different payloads", () => {
    const a = hashRequestBody({ trade: { assetSymbol: "XAUUSD" } });
    const b = hashRequestBody({ trade: { assetSymbol: "EURUSD" } });
    expect(a).not.toBe(b);
  });

  it("is a sha256 hex digest", () => {
    expect(hashRequestBody({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
