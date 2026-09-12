import { CalendarDays } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DaySummaryGrid } from "@/components/journal/day-summary-widgets";
import type { DayCloseSummaryDTO } from "@/server/services/close-day.service";

/**
 * Journal rebuild (Stage 9 §3) — the day's historical overview, entirely
 * from Stage 8's getDayCloseSummary. No calculations are re-derived here.
 */
export function DayOverviewPanel({ summary }: { summary: DayCloseSummaryDTO }) {
  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarDays className="size-4 text-muted-foreground" />
          Day Overview
        </h3>
        <Badge variant={summary.dayStatus === "ARCHIVED" ? "secondary" : "success"}>
          {summary.dayStatus === "ARCHIVED" ? "Archived" : "Active"}
        </Badge>
      </div>
      <DaySummaryGrid summary={summary} />
    </div>
  );
}
