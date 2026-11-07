import { cn } from "@/lib/utils";
import type { ActiveGoalDTO, PersonalStreakDTO } from "@/types/goals";

/**
 * Personal totals across every goal. Consecutive progress (current streak)
 * and historical totals (successful days) are labelled apart on purpose:
 * one resets on a miss, the other never does.
 */
export function StreakOverview({ stats, active, className }: { stats: PersonalStreakDTO; active: ActiveGoalDTO | null; className?: string }) {
  const week = active?.thisWeek ?? null;
  const items = [
    { label: "Current streak", value: stats.current, unit: "days in a row", note: "Resets on a missed trading day" },
    { label: "Longest streak", value: stats.longest, unit: "days in a row", note: "Your record, across all goals" },
    { label: "Successful days", value: stats.successfulDays, unit: "in total", note: "Never lost to a miss" },
    {
      label: "This week",
      value: week && week.owed > 0 ? `${week.qualified}/${week.owed}` : "—",
      unit: "trading days qualified",
      note: active ? "Last 7 days of your goal" : "No active goal",
    },
    { label: "Goals completed", value: stats.goalsCompleted, unit: stats.goalsAbandoned ? `${stats.goalsAbandoned} abandoned` : "so far", note: null },
  ];
  return (
    <section aria-label="Streaks" className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5", className)}>
      {items.map((s) => (
        <div key={s.label} className="glass rounded-2xl p-4">
          <div className="text-xs text-muted-foreground">{s.label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</div>
          <div className="text-xs text-muted-foreground">{s.unit}</div>
          {s.note && <div className="mt-1 text-[11px] text-muted-foreground/80">{s.note}</div>}
        </div>
      ))}
    </section>
  );
}
