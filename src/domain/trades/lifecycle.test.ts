import { describe, expect, it } from "vitest";

import {
  executedAtFromTrade,
  nextClosedAt,
  nextReviewedAt,
} from "@/domain/trades/lifecycle";

const NOW = new Date("2026-08-03T10:00:00.000Z");
const EARLIER = new Date("2026-08-01T09:00:00.000Z");

describe("nextClosedAt", () => {
  it("stamps now the first time a result exists", () => {
    expect(nextClosedAt(null, true, NOW)).toEqual(NOW);
  });

  it("preserves the original close time on later edits", () => {
    expect(nextClosedAt(EARLIER, true, NOW)).toEqual(EARLIER);
  });

  it("stays null while the trade is still open", () => {
    expect(nextClosedAt(null, false, NOW)).toBeNull();
  });

  it("clears the stamp if the result is removed (reopened)", () => {
    expect(nextClosedAt(EARLIER, false, NOW)).toBeNull();
  });
});

describe("nextReviewedAt", () => {
  it("stamps now the first time review content appears", () => {
    expect(nextReviewedAt(null, true, NOW)).toEqual(NOW);
  });

  it("preserves the original review time on later edits", () => {
    expect(nextReviewedAt(EARLIER, true, NOW)).toEqual(EARLIER);
  });

  it("never auto-clears once reviewed, even if content is removed", () => {
    expect(nextReviewedAt(EARLIER, false, NOW)).toEqual(EARLIER);
  });

  it("stays null when there is no review content yet", () => {
    expect(nextReviewedAt(null, false, NOW)).toBeNull();
  });
});

describe("executedAtFromTrade", () => {
  it("adds execution minutes to the date-only trade date (UTC)", () => {
    // 2026-08-03 00:00 UTC + 570 min (09:30) => 09:30 UTC
    const executed = executedAtFromTrade(new Date("2026-08-03T00:00:00.000Z"), 570);
    expect(executed.toISOString()).toBe("2026-08-03T09:30:00.000Z");
  });

  it("handles midnight (0 minutes)", () => {
    const executed = executedAtFromTrade(new Date("2026-08-03T00:00:00.000Z"), 0);
    expect(executed.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });
});
