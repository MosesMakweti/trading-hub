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

export const LEAKAGE_TONE: Record<LeakageCategory, string> = {
  EXECUTION: "var(--chart-1)",
  BEHAVIORAL: "var(--warning)",
  RISK: "var(--danger)",
  STRATEGY_ADHERENCE: "var(--chart-2)",
  OPPORTUNITY: "var(--chart-3)",
};
