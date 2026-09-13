import { describe, expect, it } from "vitest";

import { weekStartKey, addDaysToKey, monthStartKey, monthEndKey } from "@/lib/date";

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

describe("monthStartKey / monthEndKey", () => {
  it("returns the first and last day of the month containing the key", () => {
    expect(monthStartKey("2026-08-17")).toBe("2026-08-01");
    expect(monthEndKey("2026-08-17")).toBe("2026-08-31");
  });

  it("handles a 30-day month and February correctly", () => {
    expect(monthEndKey("2026-04-05")).toBe("2026-04-30");
    expect(monthEndKey("2026-02-10")).toBe("2026-02-28"); // 2026 is not a leap year
    expect(monthEndKey("2028-02-10")).toBe("2028-02-29"); // 2028 is a leap year
  });

  it("is idempotent for the first/last day itself", () => {
    expect(monthStartKey("2026-08-01")).toBe("2026-08-01");
    expect(monthEndKey("2026-08-31")).toBe("2026-08-31");
  });
});
