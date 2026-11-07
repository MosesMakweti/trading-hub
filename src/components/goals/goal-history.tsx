import { CheckCircle2, CircleSlash } from "lucide-react";

import { formatDateKeyLong } from "@/lib/date";
import type { GoalHistoryDTO } from "@/types/goals";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Completed and abandoned goals, most recent first. Their days stay on record. */
export function GoalHistory({ goals }: { goals: GoalHistoryDTO[] }) {
  if (goals.length === 0) {
    return <p className="text-sm text-muted-foreground">Completed and abandoned goals will appear here, with every day they recorded.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {goals.map((g) => {
        const done = g.status === "COMPLETED";
        const Icon = done ? CheckCircle2 : CircleSlash;
        return (
          <li key={g.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
            <Icon className={done ? "mt-0.5 size-4 shrink-0 text-success" : "mt-0.5 size-4 shrink-0 text-muted-foreground"} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">{g.name}</span>
                <span className="text-xs text-muted-foreground">
                  {done ? "Completed" : "Abandoned"} {formatDateKeyLong(g.endedOn)}
                </span>
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">
                {g.targetDays}-day goal · longest streak {g.longestStreak} · {plural(g.successfulDays, "successful day")} · {plural(g.missedDays, "missed day")} ·{" "}
                {plural(Math.max(g.attempts, 1), "attempt")} · started {formatDateKeyLong(g.startDate)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
