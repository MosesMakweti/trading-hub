import { BookOpenCheck } from "lucide-react";

import { NoteBlock } from "@/components/journal/workspace/workspace-ui";
import { DayBehaviourRecap } from "@/components/journal/day-summary-widgets";
import type { DayCloseSummaryDTO } from "@/server/services/close-day.service";

/**
 * Journal rebuild (Stage 9 §6) — the Stage 8 end-of-session reflection, plus
 * the behaviour-label recap derived from the day's trades (Stage 7 labels,
 * not a second day-level tagging system — see close-day.service.ts).
 */
export function DailyReflectionRecap({ summary }: { summary: DayCloseSummaryDTO }) {
  const { reflection } = summary;
  const hasReflection =
    reflection.dayWentWell || reflection.dayToImprove || reflection.dayMainLesson || reflection.dayCarryForward;

  if (!hasReflection && summary.behaviourLabels.length === 0) return null;

  return (
    <div className="glass space-y-4 rounded-2xl p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <BookOpenCheck className="size-4 text-muted-foreground" />
        Daily Reflection
      </h3>

      {hasReflection && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NoteBlock label="What went well today?" text={reflection.dayWentWell} />
          <NoteBlock label="What needs improvement?" text={reflection.dayToImprove} />
          <NoteBlock label="Main lesson" text={reflection.dayMainLesson} />
          <NoteBlock label="Carry forward into next session" text={reflection.dayCarryForward} />
        </div>
      )}

      <DayBehaviourRecap summary={summary} />
    </div>
  );
}
