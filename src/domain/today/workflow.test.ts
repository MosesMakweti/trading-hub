import { describe, expect, it } from "vitest";

import { deriveWorkflowSteps, type WorkflowDoneState } from "@/domain/today/workflow";

const none: WorkflowDoneState = {
  prep: false,
  plan: false,
  trade: false,
  review: false,
  analyze: false,
};

const statuses = (done: WorkflowDoneState) =>
  deriveWorkflowSteps(done).map((s) => `${s.key}:${s.status}`);

describe("deriveWorkflowSteps", () => {
  it("marks the first step current when nothing is done", () => {
    expect(statuses(none)).toEqual([
      "prep:current",
      "plan:upcoming",
      "trade:upcoming",
      "review:upcoming",
      "analyze:upcoming",
    ]);
  });

  it("advances current to the first not-done step", () => {
    expect(statuses({ ...none, prep: true, plan: true })).toEqual([
      "prep:done",
      "plan:done",
      "trade:current",
      "review:upcoming",
      "analyze:upcoming",
    ]);
  });

  it("everything done => no current step", () => {
    expect(statuses({ prep: true, plan: true, trade: true, review: true, analyze: true })).toEqual([
      "prep:done",
      "plan:done",
      "trade:done",
      "review:done",
      "analyze:done",
    ]);
  });

  it("a later done step doesn't skip the current pointer over an earlier gap", () => {
    // prep not done, but trade is: prep is still the current (first not-done).
    expect(statuses({ ...none, trade: true })).toEqual([
      "prep:current",
      "plan:upcoming",
      "trade:done",
      "review:upcoming",
      "analyze:upcoming",
    ]);
  });
});
