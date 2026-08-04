import { describe, expect, it } from "vitest";

import { weekStartKey, addDaysToKey } from "@/lib/date";

describe("weekStartKey", () => {
  it("returns the same day for a Monday", () => {
    // 2026-08-03 is a Monday
    expect(weekStartKey("2026-08-03")).toBe("2026-08-03");
  });

  it("snaps back to Monday from any weekday", () => {
    expect(weekStartKey("2026-08-04")).toBe("2026-08-03"); // Tue
    expect(weekStartKey("2026-08-06")).toBe("2026-08-03"); // Thu
    expect(weekStartKey("2026-08-09")).toBe("2026-08-03"); // Sun -> that week's Monday
  });

  it("the week is Monday..Sunday (start + 6 days)", () => {
    const start = weekStartKey("2026-08-06");
    expect(addDaysToKey(start, 6)).toBe("2026-08-09"); // Sunday
  });

  it("crosses month boundaries", () => {
    // 2026-09-01 is a Tuesday -> week Monday is 2026-08-31
    expect(weekStartKey("2026-09-01")).toBe("2026-08-31");
  });
});
