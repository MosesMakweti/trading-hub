import { describe, expect, it } from "vitest";

import { deriveDayResultState } from "@/domain/trades/day-result-state";

describe("deriveDayResultState", () => {
  it("is NONE when there are no executed trades, regardless of stray R", () => {
    expect(deriveDayResultState(0, 0)).toBe("NONE");
    expect(deriveDayResultState(0, 5)).toBe("NONE");
  });

  it("is WIN when total realized R is positive", () => {
    expect(deriveDayResultState(2, 1.5)).toBe("WIN");
  });

  it("is LOSS when total realized R is negative", () => {
    expect(deriveDayResultState(1, -1)).toBe("LOSS");
  });

  it("is BREAKEVEN when total realized R is ~zero but trades were executed", () => {
    expect(deriveDayResultState(2, 0)).toBe("BREAKEVEN");
    expect(deriveDayResultState(1, 0.0001)).toBe("BREAKEVEN");
  });

  it("a cancelled-only day (0 executed trades) is never treated as a loss", () => {
    // Cancelled trades never count toward executedTradeCount (Stage 8/9) —
    // a day with only cancelled ideas must read as NONE, not BREAKEVEN/LOSS.
    expect(deriveDayResultState(0, 0)).toBe("NONE");
  });
});
