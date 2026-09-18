import { describe, expect, it } from "vitest";

import { tradeWorkspaceSectionSchema } from "@/lib/validation/trades";

// The Trade Workspace inline autosave sends one (or a few) fields at a time.
// These tests lock the transform pipeline that Phase 2 introduced: prices
// coerce and reject bad input, notes trim, empty means "clear to null", and a
// patch must carry at least one field.
describe("tradeWorkspaceSectionSchema", () => {
  it("coerces a price string to a number", () => {
    const parsed = tradeWorkspaceSectionSchema.parse({ actualEntry: "1.2345" });
    expect(parsed.actualEntry).toBe(1.2345);
  });

  it("treats an empty price as null (cleared)", () => {
    const parsed = tradeWorkspaceSectionSchema.parse({ actualExit: "  " });
    expect(parsed.actualExit).toBeNull();
  });

  it("rejects a negative price", () => {
    const result = tradeWorkspaceSectionSchema.safeParse({ actualStopLoss: "-5" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric price", () => {
    const result = tradeWorkspaceSectionSchema.safeParse({ actualEntry: "abc" });
    expect(result.success).toBe(false);
  });

  // Today V2 Phase 2 §1 — plannedEntry/plannedStopLoss/plannedTarget were
  // removed from this schema entirely: TradePlanVersion (savePlan) is now the
  // only writer of a trade's plan, so a locked plan can no longer be silently
  // rewritten through a plain workspace-section patch (see the schema's own
  // doc comment in trades.ts).
  it("silently drops a legacy plannedEntry/plannedStopLoss/plannedTarget key rather than writing it", () => {
    const result = tradeWorkspaceSectionSchema.safeParse({ plannedEntry: "1.2345", plannedStopLoss: "1.2", plannedTarget: "1.3" });
    expect(result.success).toBe(false); // stripped down to nothing left to update
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
