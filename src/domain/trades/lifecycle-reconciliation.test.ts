import { describe, expect, it } from "vitest";

import { reconcileTradeLifecycle } from "@/domain/trades/lifecycle-reconciliation";

const NOW = new Date("2026-01-05T20:00:00Z");

describe("reconcileTradeLifecycle", () => {
  it("FULLY_CLOSED stamps closedAt the first time and reports CLOSED (not REVIEWED, no reflection yet)", () => {
    const result = reconcileTradeLifecycle({
      closedAt: null,
      reviewedAt: null,
      reviewLifecycleStatus: "FULLY_CLOSED",
      now: NOW,
    });
    expect(result.closedAt).toEqual(NOW);
    expect(result.status).toBe("CLOSED");
  });

  it("FULLY_CLOSED never rewrites an already-stamped closedAt (sticky)", () => {
    const original = new Date("2026-01-05T15:00:00Z");
    const result = reconcileTradeLifecycle({
      closedAt: original,
      reviewedAt: null,
      reviewLifecycleStatus: "FULLY_CLOSED",
      now: NOW,
    });
    expect(result.closedAt).toEqual(original);
  });

  it("FULLY_CLOSED reports REVIEWED when reflection content already stamped reviewedAt", () => {
    const reviewedAt = new Date("2026-01-05T16:00:00Z");
    const result = reconcileTradeLifecycle({
      closedAt: null,
      reviewedAt,
      reviewLifecycleStatus: "FULLY_CLOSED",
      now: NOW,
    });
    expect(result.status).toBe("REVIEWED");
  });

  it("PARTIALLY_CLOSED never sets a fake closedAt and stays OPEN", () => {
    const result = reconcileTradeLifecycle({
      closedAt: null,
      reviewedAt: null,
      reviewLifecycleStatus: "PARTIALLY_CLOSED",
      now: NOW,
    });
    expect(result.closedAt).toBeNull();
    expect(result.status).toBe("OPEN");
  });

  it("STILL_HOLDING never sets a fake closedAt and stays OPEN", () => {
    const result = reconcileTradeLifecycle({
      closedAt: null,
      reviewedAt: null,
      reviewLifecycleStatus: "STILL_HOLDING",
      now: NOW,
    });
    expect(result.closedAt).toBeNull();
    expect(result.status).toBe("OPEN");
  });

  it("CANCELLED_NEVER_TRIGGERED is never forced into a closed/win-loss state", () => {
    const result = reconcileTradeLifecycle({
      closedAt: null,
      reviewedAt: null,
      reviewLifecycleStatus: "CANCELLED_NEVER_TRIGGERED",
      now: NOW,
    });
    expect(result.closedAt).toBeNull();
    expect(result.status).toBe("OPEN");
  });

  it("null (not yet reviewed) leaves closedAt/status exactly as they already were", () => {
    const existingClosedAt = new Date("2026-01-04T10:00:00Z");
    const result = reconcileTradeLifecycle({
      closedAt: existingClosedAt,
      reviewedAt: null,
      reviewLifecycleStatus: null,
      now: NOW,
    });
    expect(result.closedAt).toEqual(existingClosedAt);
    expect(result.status).toBe("CLOSED");
  });
});
