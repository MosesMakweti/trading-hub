import { describe, expect, it } from "vitest";

import { createReplayAnnotationSchema } from "@/lib/validation/replay";

/** Stage 18 §18 — geometry validation at the Zod boundary, per shape,
 *  before anything reaches the service/DB layer. */
describe("createReplayAnnotationSchema — geometry validated per type", () => {
  const base = { sessionId: "s1", assetSymbol: "XAUUSD" };

  it("accepts a valid HORIZONTAL_LINE ({price})", () => {
    const result = createReplayAnnotationSchema.safeParse({ ...base, type: "HORIZONTAL_LINE", geometry: { price: 2400 } });
    expect(result.success).toBe(true);
  });

  it("rejects a HORIZONTAL_LINE missing price", () => {
    const result = createReplayAnnotationSchema.safeParse({ ...base, type: "HORIZONTAL_LINE", geometry: {} });
    expect(result.success).toBe(false);
  });

  it("rejects a HORIZONTAL_LINE given two-point geometry instead of a single price", () => {
    const result = createReplayAnnotationSchema.safeParse({
      ...base,
      type: "HORIZONTAL_LINE",
      geometry: { p1: { time: 1, price: 1 }, p2: { time: 2, price: 2 } },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid TREND_LINE ({p1, p2})", () => {
    const result = createReplayAnnotationSchema.safeParse({
      ...base,
      type: "TREND_LINE",
      geometry: { p1: { time: 1000, price: 1.1 }, p2: { time: 2000, price: 1.2 } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a TREND_LINE with a negative time value", () => {
    const result = createReplayAnnotationSchema.safeParse({
      ...base,
      type: "TREND_LINE",
      geometry: { p1: { time: -1, price: 1.1 }, p2: { time: 2000, price: 1.2 } },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid RECTANGLE (same two-point shape as TREND_LINE)", () => {
    const result = createReplayAnnotationSchema.safeParse({
      ...base,
      type: "RECTANGLE",
      geometry: { p1: { time: 1000, price: 1.1 }, p2: { time: 2000, price: 1.2 } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid TEXT annotation and requires non-empty text", () => {
    const ok = createReplayAnnotationSchema.safeParse({ ...base, type: "TEXT", geometry: { time: 1000, price: 1.1 }, text: "note" });
    expect(ok.success).toBe(true);

    const missingText = createReplayAnnotationSchema.safeParse({ ...base, type: "TEXT", geometry: { time: 1000, price: 1.1 } });
    expect(missingText.success).toBe(false);
  });

  it("rejects an unknown annotation type", () => {
    const result = createReplayAnnotationSchema.safeParse({ ...base, type: "CIRCLE", geometry: { price: 1 } });
    expect(result.success).toBe(false);
  });
});
