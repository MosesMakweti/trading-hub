import { describe, expect, it } from "vitest";

import {
  computePsychologyPercent,
  computeRawScore,
  gradeFromPercent,
  scorePsychology,
  type PsychologyAnswer,
} from "./scoring";

const ELITE_DISCIPLINE_ANSWERS: PsychologyAnswer[] = [
  { key: "fomo", value: "no" },
  { key: "riskManaged", value: "yes" },
  { key: "followedExitPlan", value: "yes" },
  { key: "alignedWithBias", value: "yes" },
  { key: "influencedBySomeoneElseProfit", value: "no" },
  { key: "influencedByOnlineOpinion", value: "no" },
  { key: "outcomeWillInfluenceNext", value: "no" },
  { key: "monitoringObsession", value: 10 },
];

const POOR_DISCIPLINE_ANSWERS: PsychologyAnswer[] = [
  { key: "fomo", value: "yes" },
  { key: "riskManaged", value: "no" },
  { key: "followedExitPlan", value: "no" },
  { key: "alignedWithBias", value: "no" },
  { key: "influencedBySomeoneElseProfit", value: "yes" },
  { key: "influencedByOnlineOpinion", value: "yes" },
  { key: "outcomeWillInfluenceNext", value: "yes" },
  { key: "monitoringObsession", value: 90 },
];

describe("computePsychologyPercent", () => {
  // Worked examples straight from the product spec.
  it.each([
    [8, 100],
    [6, 87.5],
    [4, 75],
    [0, 50],
    [-4, 25],
    [-8, 0],
  ])("maps raw score %i to %i%%", (rawScore, expectedPercent) => {
    expect(computePsychologyPercent(rawScore)).toBeCloseTo(expectedPercent);
  });
});

describe("gradeFromPercent", () => {
  it("grades A for 90-100%", () => {
    expect(gradeFromPercent(100)).toBe("A");
    expect(gradeFromPercent(90)).toBe("A");
  });

  it("grades B for 80-89%", () => {
    expect(gradeFromPercent(89.9)).toBe("B");
    expect(gradeFromPercent(80)).toBe("B");
  });

  it("grades C for 70-79%", () => {
    expect(gradeFromPercent(79.9)).toBe("C");
    expect(gradeFromPercent(70)).toBe("C");
  });

  it("grades D for 60-69%", () => {
    expect(gradeFromPercent(69.9)).toBe("D");
    expect(gradeFromPercent(60)).toBe("D");
  });

  it("grades F below 60%", () => {
    expect(gradeFromPercent(59.9)).toBe("F");
    expect(gradeFromPercent(0)).toBe("F");
  });
});

describe("computeRawScore", () => {
  it("scores +8 for maximally disciplined answers", () => {
    expect(computeRawScore(ELITE_DISCIPLINE_ANSWERS)).toBe(8);
  });

  it("scores -8 for maximally undisciplined answers", () => {
    expect(computeRawScore(POOR_DISCIPLINE_ANSWERS)).toBe(-8);
  });

  it("scores 'maybe' the same as 'yes' for the next-trade-influence question", () => {
    const answers = ELITE_DISCIPLINE_ANSWERS.map((a) =>
      a.key === "outcomeWillInfluenceNext" ? { ...a, value: "maybe" } : a,
    );
    expect(computeRawScore(answers)).toBe(6);
  });

  it("scores 0 for the middle monitoring-obsession band (26-50)", () => {
    const answers = ELITE_DISCIPLINE_ANSWERS.map((a) =>
      a.key === "monitoringObsession" ? { ...a, value: 40 } : a,
    );
    expect(computeRawScore(answers)).toBe(7);
  });

  it("throws when an answer is missing", () => {
    const answers = ELITE_DISCIPLINE_ANSWERS.slice(0, 7);
    expect(() => computeRawScore(answers)).toThrow(/Missing answer/);
  });

  it("throws when a choice answer is invalid", () => {
    const answers = ELITE_DISCIPLINE_ANSWERS.map((a) =>
      a.key === "fomo" ? { ...a, value: "maybe" } : a,
    );
    expect(() => computeRawScore(answers)).toThrow(/Invalid answer/);
  });

  it("throws when the scale answer is out of range", () => {
    const answers = ELITE_DISCIPLINE_ANSWERS.map((a) =>
      a.key === "monitoringObsession" ? { ...a, value: 101 } : a,
    );
    expect(() => computeRawScore(answers)).toThrow(/Invalid answer/);
  });
});

describe("scorePsychology", () => {
  it("matches the spec's worked example: +6 raw -> 87.5% -> grade B", () => {
    const answers = ELITE_DISCIPLINE_ANSWERS.map((a) =>
      a.key === "outcomeWillInfluenceNext" ? { ...a, value: "maybe" } : a,
    );
    const result = scorePsychology(answers);
    expect(result.rawScore).toBe(6);
    expect(result.percent).toBeCloseTo(87.5);
    expect(result.grade).toBe("B");
  });

  it("composes to 100% / A for elite discipline", () => {
    const result = scorePsychology(ELITE_DISCIPLINE_ANSWERS);
    expect(result).toEqual({ rawScore: 8, percent: 100, grade: "A" });
  });

  it("composes to 0% / F for poor discipline", () => {
    const result = scorePsychology(POOR_DISCIPLINE_ANSWERS);
    expect(result).toEqual({ rawScore: -8, percent: 0, grade: "F" });
  });
});
