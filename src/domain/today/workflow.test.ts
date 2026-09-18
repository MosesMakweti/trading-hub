import { describe, expect, it } from "vitest";

import { deriveWorkflowSteps, type WorkflowDoneState } from "@/domain/today/workflow";

const none: WorkflowDoneState = {
  preSession: false,
  todaysPlan: false,
  tradeIdea: false,
  execution: false,
  review: false,
  daySummary: false,
};

const statuses = (done: WorkflowDoneState) =>
  deriveWorkflowSteps(done).map((s) => `${s.key}:${s.status}`);

describe("deriveWorkflowSteps", () => {
  it("marks the first step current when nothing is done", () => {
    expect(statuses(none)).toEqual([
      "preSession:current",
      "todaysPlan:upcoming",
      "tradeIdea:upcoming",
      "execution:upcoming",
      "review:upcoming",
      "daySummary:upcoming",
    ]);
  });

  it("advances current to the first not-done step", () => {
    expect(statuses({ ...none, preSession: true, todaysPlan: true })).toEqual([
      "preSession:done",
      "todaysPlan:done",
      "tradeIdea:current",
      "execution:upcoming",
      "review:upcoming",
      "daySummary:upcoming",
    ]);
  });

  it("everything done => no current step", () => {
    expect(
      statuses({ preSession: true, todaysPlan: true, tradeIdea: true, execution: true, review: true, daySummary: true }),
    ).toEqual([
      "preSession:done",
      "todaysPlan:done",
      "tradeIdea:done",
      "execution:done",
      "review:done",
      "daySummary:done",
    ]);
  });

  it("a later done step doesn't skip the current pointer over an earlier gap", () => {
    // preSession not done, but tradeIdea is: preSession is still current (first not-done).
    expect(statuses({ ...none, tradeIdea: true })).toEqual([
      "preSession:current",
      "todaysPlan:upcoming",
      "tradeIdea:done",
      "execution:upcoming",
      "review:upcoming",
      "daySummary:upcoming",
    ]);
  });

  it("execution can be current while a trade idea exists but hasn't been executed yet", () => {
    expect(statuses({ ...none, preSession: true, todaysPlan: true, tradeIdea: true })).toEqual([
      "preSession:done",
      "todaysPlan:done",
      "tradeIdea:done",
      "execution:current",
      "review:upcoming",
      "daySummary:upcoming",
    ]);
  });
});
