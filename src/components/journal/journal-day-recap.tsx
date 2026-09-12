import { CircleCheck, ListChecks } from "lucide-react";

import { WorkflowProgress, type WorkflowStep } from "@/components/dashboard/workflow-progress";
import { RoutineSnapshotView } from "@/components/routine/routine-snapshot-view";
import type { JournalDayRecapDTO } from "@/types/today";

function Card({ icon: Icon, title, children }: { icon: typeof ListChecks; title: string; children: React.ReactNode }) {
  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" />
        {title}
      </h3>
      {children}
    </div>
  );
}

/**
 * Read-only recap of a day's workflow stepper + frozen Pre-Session Routine.
 * Presentational (server component). Shown only when a TradingDay exists for
 * the day. The Plan/Daily-analytics summaries that used to live here now
 * come from DailyMarketPlanRecap and DayOverviewPanel (Stage 9/11) — reusing
 * Stage 8's getDayCloseSummary instead of a second, slightly different
 * calculation of the same numbers.
 */
export function JournalDayRecap({
  recap,
  steps,
}: {
  recap: JournalDayRecapDTO;
  steps: WorkflowStep[];
}) {
  const { routine } = recap;

  return (
    <section className="space-y-3">
      <WorkflowProgress steps={steps} title="Day workflow" />

      {routine.snapshot && routine.snapshot.sections.length > 0 && (
        <Card icon={ListChecks} title="Pre-Session Routine">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground tabular-nums">
              {routine.progress.completed}/{routine.progress.total} complete · {routine.progress.percent}%
            </span>
            {routine.readyAt && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                <CircleCheck className="size-3.5" />
                Confirmed ready to trade
              </span>
            )}
          </div>
          <RoutineSnapshotView snapshot={routine.snapshot} />
        </Card>
      )}
    </section>
  );
}
