import { describe, expect, it } from "vitest";

import { computeReviewPeriod, validateReviewPeriod } from "@/domain/replay/review-period";

describe("validateReviewPeriod", () => {
  it("accepts a valid Monday-Sunday weekly range", () => {
    expect(validateReviewPeriod("WEEKLY", "2026-08-03", "2026-08-09")).toEqual({ valid: true });
  });

  it("rejects a weekly range that doesn't start on Monday", () => {
    const r = validateReviewPeriod("WEEKLY", "2026-08-04", "2026-08-10");
    expect(r.valid).toBe(false);
  });

  it("rejects a weekly range shorter or longer than 7 days", () => {
    expect(validateReviewPeriod("WEEKLY", "2026-08-03", "2026-08-08").valid).toBe(false);
    expect(validateReviewPeriod("WEEKLY", "2026-08-03", "2026-08-10").valid).toBe(false);
  });

  it("accepts a valid full calendar month", () => {
    expect(validateReviewPeriod("MONTHLY", "2026-08-01", "2026-08-31")).toEqual({ valid: true });
  });

  it("rejects a monthly range that doesn't start on the 1st", () => {
    expect(validateReviewPeriod("MONTHLY", "2026-08-02", "2026-08-31").valid).toBe(false);
  });

  it("rejects a monthly range that doesn't span the full month", () => {
    expect(validateReviewPeriod("MONTHLY", "2026-08-01", "2026-08-30").valid).toBe(false);
    expect(validateReviewPeriod("MONTHLY", "2026-08-01", "2026-09-01").valid).toBe(false);
  });

  it("rejects an end date before the start date", () => {
    expect(validateReviewPeriod("WEEKLY", "2026-08-09", "2026-08-03").valid).toBe(false);
  });

  it("rejects malformed dates", () => {
    expect(validateReviewPeriod("WEEKLY", "not-a-date", "2026-08-09").valid).toBe(false);
  });
});

describe("computeReviewPeriod", () => {
  it("always returns an already-valid weekly range for any anchor date", () => {
    const { startDate, endDate } = computeReviewPeriod("WEEKLY", "2026-08-06");
    expect(validateReviewPeriod("WEEKLY", startDate, endDate).valid).toBe(true);
  });

  it("always returns an already-valid monthly range for any anchor date", () => {
    const { startDate, endDate } = computeReviewPeriod("MONTHLY", "2026-02-14");
    expect(startDate).toBe("2026-02-01");
    expect(endDate).toBe("2026-02-28");
    expect(validateReviewPeriod("MONTHLY", startDate, endDate).valid).toBe(true);
  });
});
