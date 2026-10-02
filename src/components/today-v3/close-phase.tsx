import { DailyAnalyticsSection } from "@/components/today/daily-analytics-section";
import { CloseDayDialog } from "@/components/today/close-day-dialog";
import type { DailyAnalyticsDTO } from "@/types/today";

/**
 * Today V3 — Close phase (Phase 1). The end-of-day redesign (one Close
 * surface, reflections once, Close sets analyzedAt) is a later phase; until
 * then this hosts the existing Day Summary and Close Trading Day unchanged.
 */
export function ClosePhase({
  dateKey,
  analytics,
  archived,
}: {
  dateKey: string;
  analytics: DailyAnalyticsDTO;
  archived: boolean;
}) {
  return (
    <div className="space-y-4">
      <DailyAnalyticsSection dateKey={dateKey} analytics={analytics} />
      {!archived && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">Finished for today? Closing archives the day into your Journal.</p>
          <CloseDayDialog dateKey={dateKey} />
        </div>
      )}
    </div>
  );
}
