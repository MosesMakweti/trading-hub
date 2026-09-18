/**
 * The Today workflow state machine (pure, unit-tested). The trading day
 * advances through a fixed ordered set of steps; each is `done`, the single
 * `current` step (the first not-yet-done one), or `upcoming`. None of this
 * is persisted as its own state (Today V2 Final Phase §5) — every boolean is
 * derived fresh from existing canonical facts each render: preSession/
 * todaysPlan/daySummary from the TradingDay record, tradeIdea/execution/
 * review from the day's trades. Both the Today workspace and the Dashboard
 * feed this the same booleans.
 *
 * Six steps, matching the Today V2 mental model (Pre-Session -> Today's Plan
 * -> Trade Idea -> Execution -> Review -> Day Summary) — previously a
 * coarser five-step prep/plan/trade/review/analyze model that conflated
 * planning, executing, and reviewing a trade into one "trade" step.
 */
export const WORKFLOW_ORDER = ["preSession", "todaysPlan", "tradeIdea", "execution", "review", "daySummary"] as const;
export type WorkflowStepKey = (typeof WORKFLOW_ORDER)[number];
export type WorkflowStepStatus = "done" | "current" | "upcoming";

export interface WorkflowDoneState {
  preSession: boolean;
  todaysPlan: boolean;
  tradeIdea: boolean;
  execution: boolean;
  review: boolean;
  daySummary: boolean;
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
