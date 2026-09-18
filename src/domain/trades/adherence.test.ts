import { describe, expect, it } from "vitest";

import {
  ADHERENCE_QUESTIONS,
  sanitizeAdherenceAnswers,
  scoreAdherence,
} from "@/domain/trades/adherence";

describe("scoreAdherence", () => {
  it("is null percent with no answers", () => {
    expect(scoreAdherence(null)).toMatchObject({ percent: null, answeredCount: 0, total: 4 });
    expect(scoreAdherence({})).toMatchObject({ percent: null, answeredCount: 0 });
  });

  it("scores over answered questions only", () => {
    // 2 answered, 1 yes => 50%, not 25% of the full four.
    const s = scoreAdherence({ followedStrategy: true, remainedPatient: false });
    expect(s).toMatchObject({ yesCount: 1, answeredCount: 2, percent: 50 });
  });

  it("is 100% when every answered question is yes", () => {
    const all = Object.fromEntries(ADHERENCE_QUESTIONS.map((q) => [q.key, true]));
    expect(scoreAdherence(all)).toMatchObject({ percent: 100, answeredCount: 4, yesCount: 4 });
  });

  it("rounds to the nearest percent", () => {
    // 2 of 3 answered yes => 66.67 -> 67
    const s = scoreAdherence({ followedStrategy: true, followedEntryModel: true, remainedPatient: false });
    expect(s.percent).toBe(67);
  });

  it("ignores unknown keys and non-boolean values", () => {
    const s = scoreAdherence({ followedStrategy: true, bogus: true, remainedPatient: "yes" } as never);
    expect(s).toMatchObject({ answeredCount: 1, yesCount: 1, percent: 100 });
  });
});

describe("sanitizeAdherenceAnswers", () => {
  it("keeps only known boolean keys", () => {
    const clean = sanitizeAdherenceAnswers({
      followedStrategy: true,
      followedTradeManagement: false,
      bogus: true,
      remainedPatient: "nope",
    });
    expect(clean).toEqual({ followedStrategy: true, followedTradeManagement: false });
  });

  it("returns an empty object for junk input", () => {
    expect(sanitizeAdherenceAnswers(null)).toEqual({});
    expect(sanitizeAdherenceAnswers("x")).toEqual({});
  });

  // Today V2 Phase 2 §13 — a historical trade may still carry an
  // `executedToPlan` answer from before the question was removed; a future
  // save must drop it like any other unrecognized key, never reject the
  // whole patch or resurrect it as a live question.
  it("drops a legacy executedToPlan answer like any other unknown key", () => {
    const clean = sanitizeAdherenceAnswers({ followedStrategy: true, executedToPlan: true });
    expect(clean).toEqual({ followedStrategy: true });
  });
});
