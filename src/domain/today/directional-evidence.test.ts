import { describe, expect, it } from "vitest";

import {
  compareSuggestedToFinalBias,
  summarizeDirectionalEvidence,
  type DirectionalEvidenceItemInput,
} from "@/domain/today/directional-evidence";

const item = (direction: "BULLISH" | "BEARISH", checked = true): DirectionalEvidenceItemInput => ({
  direction,
  checked,
});

describe("summarizeDirectionalEvidence", () => {
  it("counts bullish and bearish evidence separately", () => {
    const summary = summarizeDirectionalEvidence([
      item("BULLISH"),
      item("BULLISH"),
      item("BULLISH"),
      item("BULLISH"),
      item("BEARISH"),
      item("BEARISH"),
    ]);
    expect(summary.bullishCount).toBe(4);
    expect(summary.bearishCount).toBe(2);
  });

  it("bullish leading suggests LONG", () => {
    const summary = summarizeDirectionalEvidence([item("BULLISH"), item("BULLISH"), item("BEARISH")]);
    expect(summary.leadingDirection).toBe("BULLISH");
    expect(summary.suggestedBias).toBe("LONG");
  });

  it("bearish leading suggests SHORT", () => {
    const summary = summarizeDirectionalEvidence([item("BEARISH"), item("BEARISH"), item("BULLISH")]);
    expect(summary.leadingDirection).toBe("BEARISH");
    expect(summary.suggestedBias).toBe("SHORT");
  });

  it("a tie produces no leader and no suggested bias — never an arbitrary pick", () => {
    const summary = summarizeDirectionalEvidence([item("BULLISH"), item("BULLISH"), item("BEARISH"), item("BEARISH")]);
    expect(summary.leadingDirection).toBe("BALANCED");
    expect(summary.suggestedBias).toBeNull();
  });

  it("no evidence at all produces no leader and no suggested bias", () => {
    const summary = summarizeDirectionalEvidence([]);
    expect(summary.bullishCount).toBe(0);
    expect(summary.bearishCount).toBe(0);
    expect(summary.leadingDirection).toBe("NONE");
    expect(summary.suggestedBias).toBeNull();
  });

  it("unchecked items don't count toward the tally", () => {
    const summary = summarizeDirectionalEvidence([item("BULLISH", false), item("BULLISH", false), item("BEARISH", true)]);
    expect(summary.bullishCount).toBe(0);
    expect(summary.bearishCount).toBe(1);
    expect(summary.leadingDirection).toBe("BEARISH");
  });

  it("this is evidence, not probability — never returns a percentage field", () => {
    const summary = summarizeDirectionalEvidence([item("BULLISH")]);
    expect(summary).not.toHaveProperty("probability");
    expect(summary).not.toHaveProperty("percent");
  });
});

describe("compareSuggestedToFinalBias", () => {
  it("is ALIGNED when the manual final bias matches the suggestion", () => {
    expect(compareSuggestedToFinalBias("LONG", "LONG")).toBe("ALIGNED");
  });

  it("is CONFLICT when the manual final bias disagrees — but this never blocks the trader", () => {
    expect(compareSuggestedToFinalBias("LONG", "SHORT")).toBe("CONFLICT");
  });

  it("is NONE when there's no suggestion (balanced/no evidence)", () => {
    expect(compareSuggestedToFinalBias(null, "LONG")).toBe("NONE");
  });

  it("is NONE when there's no final bias yet", () => {
    expect(compareSuggestedToFinalBias("LONG", null)).toBe("NONE");
  });

  it("is NONE when the final bias is NEUTRAL — not treated as a disagreement", () => {
    expect(compareSuggestedToFinalBias("LONG", "NEUTRAL")).toBe("NONE");
  });
});
