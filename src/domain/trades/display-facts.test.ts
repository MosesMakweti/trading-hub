import { describe, expect, it } from "vitest";

import { tradeBiasDisplay, tradeTimeDisplay } from "./display-facts";

describe("tradeBiasDisplay", () => {
  it("prefers the frozen daily Final Bias over compatibility HTF values", () => {
    expect(tradeBiasDisplay({ dailyBiasSnapshot: "SHORT", higherTimeframeBias: "BULLISH", biasConfidencePercent: 50 })).toEqual({
      label: "Today's bias",
      value: "Short",
    });
  });
  it("never presents the neutral 50% compatibility default as a decision", () => {
    expect(tradeBiasDisplay({ dailyBiasSnapshot: null, higherTimeframeBias: "BULLISH", biasConfidencePercent: 50 }).value).toBeNull();
  });
  it("keeps a legacy trade's genuinely recorded HTF bias, labelled as recorded", () => {
    expect(tradeBiasDisplay({ dailyBiasSnapshot: null, higherTimeframeBias: "BEARISH", biasConfidencePercent: 80 })).toEqual({
      label: "HTF bias (recorded)",
      value: "Bearish · 80%",
    });
  });
});

describe("tradeTimeDisplay", () => {
  it("labels an unentered idea's provisional time as idea-logged, never execution", () => {
    expect(tradeTimeDisplay({ executionMinutes: 615, hasActualEntry: false, hasLegacyResult: false })).toEqual({
      label: "Idea logged",
      time: "10:15",
      executed: false,
    });
  });
  it("shows the canonical entry time once entered, and a legacy result's execution time", () => {
    expect(tradeTimeDisplay({ executionMinutes: 600, hasActualEntry: true, hasLegacyResult: false })).toMatchObject({ label: "Entry time", executed: true });
    expect(tradeTimeDisplay({ executionMinutes: 600, hasActualEntry: false, hasLegacyResult: true })).toMatchObject({ label: "Execution time", executed: true });
  });
});
