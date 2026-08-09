import { describe, expect, it } from "vitest";

import { missOutcomeSchema } from "./opportunity";

const parse = (over: Record<string, unknown>) =>
  missOutcomeSchema.safeParse({ missReason: "FEAR", missNote: null, ...over });

describe("missOutcomeSchema — trader-entered outcome, kept internally consistent", () => {
  it("nulls the realized R for an UNDETERMINED outcome (excluded from R cost)", () => {
    const r = parse({ missedOutcome: "MISSED_UNDETERMINED", missedRealizedR: 4 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.missedRealizedR).toBeNull();
  });

  it("forces breakeven to exactly 0", () => {
    const r = parse({ missedOutcome: "MISSED_BREAKEVEN", missedRealizedR: 1.5 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.missedRealizedR).toBe(0);
  });

  it("rejects a missed win with a non-positive R", () => {
    expect(parse({ missedOutcome: "MISSED_WIN", missedRealizedR: -1 }).success).toBe(false);
    expect(parse({ missedOutcome: "MISSED_WIN", missedRealizedR: null }).success).toBe(false);
  });

  it("rejects a missed loss with a non-negative R", () => {
    expect(parse({ missedOutcome: "MISSED_LOSS", missedRealizedR: 1 }).success).toBe(false);
    expect(parse({ missedOutcome: "MISSED_LOSS", missedRealizedR: 0 }).success).toBe(false);
  });

  it("accepts a consistent missed win / loss", () => {
    expect(parse({ missedOutcome: "MISSED_WIN", missedRealizedR: 3 }).success).toBe(true);
    expect(parse({ missedOutcome: "MISSED_LOSS", missedRealizedR: -1 }).success).toBe(true);
  });
});
