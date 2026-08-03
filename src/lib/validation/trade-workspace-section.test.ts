import { describe, expect, it } from "vitest";

import { tradeWorkspaceSectionSchema } from "@/lib/validation/trades";

// The Trade Workspace inline autosave sends one (or a few) fields at a time.
// These tests lock the transform pipeline that Phase 2 introduced: prices
// coerce and reject bad input, notes trim, empty means "clear to null", and a
// patch must carry at least one field.
describe("tradeWorkspaceSectionSchema", () => {
  it("coerces a price string to a number", () => {
    const parsed = tradeWorkspaceSectionSchema.parse({ plannedEntry: "1.2345" });
    expect(parsed.plannedEntry).toBe(1.2345);
  });

  it("treats an empty price as null (cleared)", () => {
    const parsed = tradeWorkspaceSectionSchema.parse({ actualExit: "  " });
    expect(parsed.actualExit).toBeNull();
  });

  it("rejects a negative price", () => {
    const result = tradeWorkspaceSectionSchema.safeParse({ plannedStopLoss: "-5" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric price", () => {
    const result = tradeWorkspaceSectionSchema.safeParse({ plannedTarget: "abc" });
    expect(result.success).toBe(false);
  });

  it("trims a note and keeps the text", () => {
    const parsed = tradeWorkspaceSectionSchema.parse({ marketContext: "  ranging  " });
    expect(parsed.marketContext).toBe("ranging");
  });

  it("treats an empty note as null (cleared)", () => {
    const parsed = tradeWorkspaceSectionSchema.parse({ reasonForTrade: "" });
    expect(parsed.reasonForTrade).toBeNull();
  });

  it("accepts a tri-state decision of true / false / null", () => {
    expect(tradeWorkspaceSectionSchema.parse({ wouldTakeAgain: true }).wouldTakeAgain).toBe(true);
    expect(tradeWorkspaceSectionSchema.parse({ wouldTakeAgain: false }).wouldTakeAgain).toBe(false);
    expect(tradeWorkspaceSectionSchema.parse({ wouldTakeAgain: null }).wouldTakeAgain).toBeNull();
  });

  it("writes only the keys present (a single field can save alone)", () => {
    const parsed = tradeWorkspaceSectionSchema.parse({ whatWentWell: "good entry" });
    expect(Object.keys(parsed)).toEqual(["whatWentWell"]);
  });

  it("rejects an empty patch (nothing to update)", () => {
    const result = tradeWorkspaceSectionSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
