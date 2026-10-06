/**
 * Trader Discipline — design direction only (not built yet).
 *
 * Each discipline component scores one day of PROCESS, never outcome:
 * Preparation is component #1. A future overall Trader Discipline Score is
 * the weighted average of the components that APPLY to a day (a component
 * that doesn't apply — e.g. execution on a no-trade day — is excluded, never
 * zeroed), so a correctly flat day can score at the top. PnL, win/loss and
 * trade count are never components.
 */
export type DisciplineComponent = "PREPARATION";

export interface DailyComponentScore {
  component: DisciplineComponent;
  dateKey: string;
  applicable: boolean;
  points: number;
  max: number;
  status: string;
  scoringVersion: number;
}
