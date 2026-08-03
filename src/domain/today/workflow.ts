/**
 * The Today workflow state machine (pure, unit-tested). The trading day advances
 * through a fixed ordered set of steps; each is `done`, the single `current`
 * step (the first not-yet-done one), or `upcoming`. Prep/Plan/Analyze are owned
 * by the TradingDay record; Trade/Review are derived from the day's trades. Both
 * the Today workspace and the Dashboard feed this the same booleans.
 */
export const WORKFLOW_ORDER = ["prep", "plan", "trade", "review", "analyze"] as const;
export type WorkflowStepKey = (typeof WORKFLOW_ORDER)[number];
export type WorkflowStepStatus = "done" | "current" | "upcoming";

export interface WorkflowDoneState {
  prep: boolean;
  plan: boolean;
  trade: boolean;
  review: boolean;
  analyze: boolean;
}

export function deriveWorkflowSteps(
  done: WorkflowDoneState,
): { key: WorkflowStepKey; status: WorkflowStepStatus }[] {
  let currentAssigned = false;
  return WORKFLOW_ORDER.map((key) => {
    if (done[key]) return { key, status: "done" as const };
    if (!currentAssigned) {
      currentAssigned = true;
      return { key, status: "current" as const };
    }
    return { key, status: "upcoming" as const };
  });
}
