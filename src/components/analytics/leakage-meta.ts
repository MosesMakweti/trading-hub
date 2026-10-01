import type { LeakageCategory } from "@/domain/analytics/counterfactual-engine";

/** Short human labels + a distinct token color per leakage category. Shared by the
 *  Counterfactual gap chart, the dashboard card, and the "Why is there a gap?" panel
 *  so a category always reads the same everywhere. */
export const CATEGORY_LABEL: Record<LeakageCategory, string> = {
  EXECUTION: "Execution",
  BEHAVIORAL: "Behavioral",
  RISK: "Risk",
  STRATEGY_ADHERENCE: "Strategy",
  OPPORTUNITY: "Opportunity",
};

// Categories are identities, not statuses: identity slots in their fixed
// declared order, starting at slot 2 — slot 1 is the "Actual" equity line the
// categories are drawn beside (docs/ANALYTICS_VISUALIZATION.md §2).
export const LEAKAGE_TONE: Record<LeakageCategory, string> = {
  EXECUTION: "var(--viz-2)",
  BEHAVIORAL: "var(--viz-3)",
  RISK: "var(--viz-4)",
  STRATEGY_ADHERENCE: "var(--viz-5)",
  OPPORTUNITY: "var(--viz-6)",
};
