import { describe, expect, it } from "vitest";

import { ratingForScore, scoreSetup, type SetupConfluence } from "./setup-score";

const c = (name: string, weight: number | null, mandatory = false): SetupConfluence => ({
  name,
  weight,
  mandatory,
});

// The spec's worked example: strategy weight 100, four present (HTF 30 + Liquidity 30
// + MSS 25 + Session 5 = 90), FVG (10) missing → 90/100 = 90 (A), setup valid.
const strategy: SetupConfluence[] = [
  c("HTF Bias", 30, true),
  c("Liquidity Sweep", 30, true),
  c("MSS", 25, true),
  c("Session", 5),
  c("FVG", 10),
];

describe("scoreSetup", () => {
  it("computes the weighted score + rating for a valid setup", () => {
    const r = scoreSetup(strategy, ["HTF Bias", "Liquidity Sweep", "MSS", "Session"]);
    expect(r.setupValid).toBe(true);
    expect(r.totalWeight).toBe(100);
    expect(r.completedWeight).toBe(90);
    expect(r.setupScore).toBe(90);
    expect(r.setupRating).toBe("A");
    expect(r.missingConfluences).toEqual(["FVG"]);
    expect(r.missingMandatory).toEqual([]);
  });

  it("flags an invalid setup when a mandatory confluence is missing", () => {
    const r = scoreSetup(strategy, ["HTF Bias", "Liquidity Sweep", "Session", "FVG"]);
    expect(r.setupValid).toBe(false);
    expect(r.missingMandatory).toEqual(["MSS"]);
    // score is still computed (data), but the UI treats it as invalid
    expect(r.setupScore).toBe(75);
  });

  it("is 100 / A+ when every confluence is present, case-insensitively", () => {
    const r = scoreSetup(strategy, ["htf bias", "liquidity sweep", "mss", "session", "fvg"]);
    expect(r.setupScore).toBe(100);
    expect(r.setupRating).toBe("A+");
    expect(r.setupValid).toBe(true);
    expect(r.missingConfluences).toEqual([]);
  });

  it("returns a null score when the strategy has no weights", () => {
    const r = scoreSetup([c("A", null, true), c("B", null)], ["A"]);
    expect(r.totalWeight).toBe(0);
    expect(r.setupScore).toBeNull();
    expect(r.setupRating).toBeNull();
    expect(r.setupValid).toBe(true); // mandatory A is present
  });
});

describe("ratingForScore", () => {
  it("maps scores to bands at the boundaries", () => {
    expect(ratingForScore(100)).toBe("A+");
    expect(ratingForScore(95)).toBe("A+");
    expect(ratingForScore(94)).toBe("A");
    expect(ratingForScore(85)).toBe("A");
    expect(ratingForScore(84)).toBe("B");
    expect(ratingForScore(75)).toBe("B");
    expect(ratingForScore(74)).toBe("C");
    expect(ratingForScore(65)).toBe("C");
    expect(ratingForScore(64)).toBe("LOW");
  });
});
